import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

type Entry = { key: string; intent: string; state: "attempting" | "broadcast"; txid?: string };

/** Append-only journal; caller must hold its exclusive lock. Keep outside Git. */
export class QuickstartJournal {
  private readonly fd: number;
  private readonly entries: Entry[];
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("journal_absolute_path_required");
    this.fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const stat = fstatSync(this.fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 1_048_576 ||
        (process.getuid && stat.uid !== process.getuid())) {
      closeSync(this.fd); throw new Error("unsafe_journal");
    }
    try {
      this.entries = readFileSync(this.fd, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Entry);
      if (this.entries.some(item => !item || typeof item.key !== "string" || !/^[0-9a-f]{64}$/.test(item.intent) ||
          !["attempting", "broadcast"].includes(item.state) ||
          (item.state === "broadcast" && !/^0x[0-9a-f]{64}$/.test(item.txid ?? "")))) throw new Error("invalid_journal");
    } catch { closeSync(this.fd); throw new Error("journal_requires_reconciliation"); }
  }
  close() { closeSync(this.fd); }
  lookup(key: string, intent: string): Entry | undefined {
    const entries = this.entries.filter(item => item.key === key);
    if (entries.some(item => item.intent !== intent)) throw new Error("journal_intent_mismatch");
    return entries.at(-1);
  }
  append(entry: Entry) {
    const bytes = Buffer.from(JSON.stringify(entry) + "\n");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(this.fd, bytes, offset);
    fsyncSync(this.fd); this.entries.push(entry);
  }
}
export function intentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function checkpointedTransaction(
  journal: QuickstartJournal, key: string, intent: string, send: () => Promise<string>,
): Promise<string> {
  const prior = journal.lookup(key, intent);
  if (prior) {
    if (prior.state !== "broadcast" || !/^0x[0-9a-f]{64}$/.test(prior.txid ?? "")) {
      throw new Error("ambiguous_attempt_requires_reconciliation");
    }
    return prior.txid!;
  }
  journal.append({ key, intent, state: "attempting" });
  const txid = await send();
  if (!/^0x[0-9a-f]{64}$/.test(txid)) throw new Error("invalid_txid_requires_reconciliation");
  journal.append({ key, intent, state: "broadcast", txid });
  return txid;
}
