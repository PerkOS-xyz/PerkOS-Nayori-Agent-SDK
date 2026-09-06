import { mkdtempSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QuickstartJournal, checkpointedTransaction, intentHash } from "../examples/testnet-journal.js";
const txid = "0x" + "11".repeat(32);
const intent = intentHash({ job: 7, step: "fund" });

describe("External quickstart transaction checkpoints", () => {
  it("resumes the same txid across a restart without signing twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nayori-journal-"));
    try {
      const path = join(dir, "journal.jsonl");
      const signer = vi.fn(async () => txid);
      const first = new QuickstartJournal(path);
      expect(await checkpointedTransaction(first, "fund:7", intent, signer)).toBe(txid);
      first.close();
      const second = new QuickstartJournal(path);
      expect(await checkpointedTransaction(second, "fund:7", intent, signer)).toBe(txid);
      expect(signer).toHaveBeenCalledOnce();
      await expect(checkpointedTransaction(second, "fund:7", intentHash({ job: 8 }), signer)).rejects.toThrow("intent_mismatch");
      second.close();
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("never retries an ambiguous signer failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nayori-journal-"));
    try {
      const journal = new QuickstartJournal(join(dir, "journal.jsonl"));
      const signer = vi.fn(async () => { throw new Error("connection lost after broadcast"); });
      await expect(checkpointedTransaction(journal, "submit:7", intent, signer)).rejects.toThrow();
      await expect(checkpointedTransaction(journal, "submit:7", intent, signer)).rejects.toThrow("ambiguous_attempt");
      expect(signer).toHaveBeenCalledOnce(); journal.close();
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("rejects malformed and world-readable journals", () => {
    const dir = mkdtempSync(join(tmpdir(), "nayori-journal-"));
    try {
      const path = join(dir, "journal.jsonl");
      writeFileSync(path, "{}\n", { mode: 0o600 });
      expect(() => new QuickstartJournal(path)).toThrow("reconciliation");
      chmodSync(path, 0o644);
      expect(() => new QuickstartJournal(path)).toThrow("unsafe_journal");
      expect(() => new QuickstartJournal("relative.json")).toThrow("absolute_path");
    } finally { rmSync(dir, { recursive: true }); }
  });
});
