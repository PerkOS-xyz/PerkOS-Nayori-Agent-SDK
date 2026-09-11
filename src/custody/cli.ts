#!/usr/bin/env node
import { parsePermit, guard, hash } from "./permit.js";
import { readPrivateFile, Ledger } from "./ledger.js";
import { testnetBackend } from "./backend.js";
import { CustodyEngine } from "./engine.js";
import { listenCustody } from "./socket.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("nayori-custody --permit /private/permit.json --state /private/state --socket /ipc/nayori.sock --key-file /private/key --hermes-uid UID [--enable-testnet-signing]\nLinux only; separate non-root OS identities required. Signing disabled by default."); return;
  }
  const enabled = args.at(-1) === "--enable-testnet-signing";
  if (enabled) args.pop();
  guard(args.length === 10 && args[0] === "--permit" && args[2] === "--state" &&
    args[4] === "--socket" && args[6] === "--key-file" && args[8] === "--hermes-uid");
  guard(process.platform === "linux" && process.getuid?.() !== 0 && /^\d+$/.test(args[9]!));
  guard(Number(args[9]) > 0 && Number(args[9]) !== process.getuid?.());
  const permit = await parsePermit(JSON.parse(readPrivateFile(args[1]!)));
  const ledger = new Ledger(args[3]!, hash(permit), permit.profile[permit.profile.role]);
  try {
    const engine = new CustodyEngine(permit, ledger, testnetBackend(args[7]!), enabled);
    const server = await listenCustody(args[5]!, engine);
    // Never close the wallet lock while an asynchronous signing request may still be running.
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
      if (stopping) return; stopping = true;
      void Promise.all([engine.shutdown(), new Promise<void>(resolve => server.close(() => resolve()))])
        .then(() => { ledger.close(); process.exit(0); });
    });
    console.error("Nayori custody ready; testnet only. Permit hash: " + hash(permit) + "; signing: " + enabled);
  } catch (error) { ledger.close(); throw error; }
}
main().catch(() => { console.error("Custody could not start. Check OS isolation, permissions and public permit; no raw diagnostics are exposed."); process.exitCode = 1; });
