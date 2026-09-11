/** Copy into a clean npm consumer. No source checkout, signer, LLM or business-network calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PerkOSClient, parseConfirmationPolicy, prepareEvaluationJob, prepareEvaluationSubmission } from '@perkos/agent-sdk';

const sdkRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@perkos/agent-sdk'))));
const pkg = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
assert.equal(pkg.version, '0.8.0', 'Use the exact reviewed stable package');
const directory = mkdtempSync(join(tmpdir(), 'nayori-onboarding-smoke-'));
// PUBLIC FIXTURES ONLY: no private keys are supplied. Never fund or reuse these identities.
const profile = { network: 'testnet', role: 'client',
  client: 'ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5',
  provider: 'ST3QBWTA0XSA94YDXT13QFH3ZMSZSM1V4Z645YHT9',
  evaluator: 'STBTXHXFXFGMNPXST7A6XQ1WNGC0V6TB6CDDQZB4',
  treasury: 'ST1E7E64H8VSSSGE0RPWF90RRC91MQG7CRQRM1BFX' };
const criteria = [{ id: 'sum', requirement: 'Return 12', verification: 'Check arithmetic' }];
const base = { network: 'testnet', asset: 'sbtc',
  contract: profile.client + '.sbtc-commerce-v5', client: profile.client,
  evaluator: profile.evaluator, description: 'Compute 7 + 5', acceptanceCriteria: criteria };
const evidence = [{ id: 'result', uri: 'https://evaluator.qa.nayori.ai/qa-evidence/offline-fixture.txt',
  sha256: createHash('sha256').update('12').digest('hex'), mediaType: 'text/plain', sizeBytes: 2 }];
// The URI and hash are inert schema fixtures, never fetched, uploaded or submitted.
const checks = [];
const check = (label, fn) => { fn(); checks.push(label); };
function value(result) {
  assert.notEqual(result.isError, true);
  const text = result.content?.find(x => x.type === 'text')?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}
try {
  const sdk = new PerkOSClient({ network: 'testnet' });
  const plan = sdk.transactions.registerAgent({ name: 'Offline fixture',
    description: 'Unsigned plan only', wallet: profile.provider, endpoints: [] });
  check('unsigned registration plan, not a registered agent', () => {
    assert.equal(plan.network, 'testnet'); assert.equal(plan.functionName, 'register-agent');
    assert.equal(plan.contract, profile.client + '.agent-registry'); assert.equal(plan.functionArgs.length, 4);
  });
  check('new testnet policy 0/6; mainnet cannot use 0/6', () => {
    assert.deepEqual(parseConfirmationPolicy('testnet', { workflowBurnBlocks: 0, settlementBurnBlocks: 6 }),
      { workflowBurnBlocks: 0, settlementBurnBlocks: 6 });
    assert.throws(() => parseConfirmationPolicy('mainnet', { workflowBurnBlocks: 0, settlementBurnBlocks: 6 }));
  });
  for (const role of ['client', 'provider']) {
    const config = join(directory, role + '.json');
    writeFileSync(config, JSON.stringify({ ...profile, role }), { mode: 0o600, flag: 'wx' });
    const client = new Client({ name: 'nayori-offline-onboarding', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(sdkRoot, 'dist/mcp/cli.js'), '--config', config], env: {}, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', b => { stderr += String(b); });
    const timeout = setTimeout(() => { void client.close(); void transport.close(); }, 15000);
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map(x => x.name).sort();
      check(role + ': exact read/prepare tools, no execution or evaluation', () => assert.deepEqual(names,
        ['nayori_context', 'nayori_counts', 'nayori_get_agent', 'nayori_get_job', 'nayori_get_reputation',
          role === 'client' ? 'nayori_prepare_job' : 'nayori_prepare_submission'].sort()));
      const context = value(await client.callTool({ name: 'nayori_context', arguments: {} }));
      check(role + ': fixed network, role and no signing/x402', () => {
        assert.equal(context.network, 'testnet'); assert.equal(context.role, role);
        assert.equal(context.wallet, role === 'client' ? profile.client : profile.provider);
        assert.equal(context.contracts.sbtcCommerce, base.contract);
        assert.deepEqual(context.capabilities, { read: true, prepare: true, sign: false, broadcast: false, x402: false });
        // rc.2 retains the old distribution warning; never treat its text as authorization.
        assert.match(context.warning, /Preparation is not authorization/);
      });
      const name = role === 'client' ? 'nayori_prepare_job' : 'nayori_prepare_submission';
      const args = { asset: base.asset, description: base.description, acceptanceCriteria: criteria,
        ...(role === 'provider' ? { jobId: '1', evidence } : {}) };
      const prepared = value(await client.callTool({ name, arguments: args }));
      const expected = role === 'client' ? await prepareEvaluationJob(base)
        : await prepareEvaluationSubmission({ ...base, provider: profile.provider, jobId: '1', evidence });
      check(role + ': actual SDK commitment matches stdio result', () => {
        assert.equal(prepared.description, expected.description);
        if (role === 'provider') {
          assert.equal(prepared.deliverable, Buffer.from(expected.deliverable).toString('hex'));
          assert.equal(prepared.evidenceBytesVerified, false);
        }
        assert.equal(prepared.signed, false); assert.equal(prepared.broadcast, false);
      });
      const extra = await client.callTool({ name, arguments: { ...args, network: 'mainnet' } });
      const wrongRole = await client.callTool({ name: role === 'client' ? 'nayori_prepare_submission' : 'nayori_prepare_job', arguments: args });
      const execute = await client.callTool({ name: 'nayori_execute', arguments: { action: 'register' } });
      check(role + ': overrides, wrong role and execution denied', () => {
        assert.equal(extra.isError, true); assert.equal(wrongRole.isError, true); assert.equal(execute.isError, true);
      });
      check(role + ': no stderr diagnostics', () => assert.equal(stderr, ''));
    } finally { clearTimeout(timeout); await client.close(); await transport.close(); }
  }
  console.log(JSON.stringify({ result: 'PASS', sdkVersion: pkg.version, checks,
    scope: 'offline SDK and MCP stdio only; not a Hermes conversation, isolation proof or funded E2E',
    signatures: 0, broadcasts: 0, llmCalls: 0, agentRegistrations: 0 }, null, 2));
} finally {
  // Only this invocation's generated public-fixture directory; never operator files.
  rmSync(directory, { recursive: true, force: true });
}
