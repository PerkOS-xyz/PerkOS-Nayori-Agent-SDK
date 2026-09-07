import { constants, openSync, closeSync, fstatSync, readFileSync, writeSync, fsyncSync,
  lstatSync, realpathSync, mkdirSync, rmdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { ACTIONS, guard, object, positive, type Action } from "./permit.js";

export function privateDirectory(path: string): void {
  guard(isAbsolute(path) && realpathSync(path) === path);
  const s = lstatSync(path);
  guard(s.isDirectory() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o700);
}
export function readPrivateFile(path: string, limit = 32768): string {
  guard(isAbsolute(path)); privateDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    guard(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.size <= limit);
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
export interface Entry {
  action: Action; intent: string; state: "reserved" | "signed" | "confirmed";
  txid: string | null; jobId: string | null;
}
export class Ledger {
  readonly entries: Entry[] = [];
  private readonly fd: number;
  private readonly lock: string;
  private closed = false;
  constructor(directory: string, readonly permitHash: string, wallet: string) {
    privateDirectory(directory); guard(/^[a-f0-9]{64}$/.test(permitHash) && /^ST[A-Z0-9]+$/.test(wallet));
    // Lock is wallet-scoped, not permit-scoped. Crash leaves it for operator reconciliation.
    this.lock = join(directory, wallet + ".lock"); mkdirSync(this.lock, { mode: 0o700 });
    try {
      const path = join(directory, wallet + ".jsonl");
      let created = false;
      try {
        this.fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        created = true;
      } catch (error) {
        guard((error as NodeJS.ErrnoException).code === "EEXIST");
        this.fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
      }
      try {
        const s = fstatSync(this.fd);
        guard(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.size <= 65536);
        const text = readFileSync(this.fd, "utf8");
        if (!text) { guard(created); this.appendRaw({ permitHash }); }
        else {
          guard(text.endsWith("\n")); const lines = text.trimEnd().split("\n");
          const header = object(JSON.parse(lines.shift()!), ["permitHash"]); guard(header.permitHash === permitHash);
          for (const line of lines) { const e = this.validate(JSON.parse(line)); this.entries.push(e); }
        }
      } catch (error) { closeSync(this.fd); throw error; }
    } catch (error) { rmdirSync(this.lock); throw error; }
  }
  private validate(value: unknown): Entry {
    const e = object(value, ["action", "intent", "state", "txid", "jobId"]);
    guard(ACTIONS.includes(e.action as Action) && typeof e.intent === "string" && /^[a-f0-9]{64}$/.test(e.intent));
    guard(e.txid === null || typeof e.txid === "string" && /^0x[a-f0-9]{64}$/.test(e.txid));
    guard(e.jobId === null || positive(e.jobId) > 0n);
    const previous = this.latest(e.action as Action);
    if (!previous) {
      guard(e.state === "reserved" && e.txid === null && e.jobId === null);
      guard(!this.entries.some(v => this.latest(v.action)?.state !== "confirmed"));
    } else {
      guard(e.intent === previous.intent);
      guard(previous.state === "reserved" ? e.state === "signed" && e.txid !== null && e.jobId === null
        : previous.state === "signed" && e.state === "confirmed" && e.txid === previous.txid &&
          (e.action === "create" ? e.jobId !== null : e.jobId === null));
    }
    return e as unknown as Entry;
  }
  latest(action: Action): Entry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.action === action) return this.entries[i];
    return undefined;
  }
  private appendRaw(value: unknown) {
    guard(!this.closed);
    const bytes = Buffer.from(JSON.stringify(value) + "\n"); let offset = 0;
    while (offset < bytes.length) offset += writeSync(this.fd, bytes, offset);
    fsyncSync(this.fd);
    // Persist directory entry as well as data before any signing/broadcast side effect.
    const dir = openSync(dirname(this.lock), constants.O_RDONLY);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  append(value: Entry): void { const e = this.validate(value); this.appendRaw(e); this.entries.push(e); }
  close(): void { if (!this.closed) { closeSync(this.fd); this.closed = true; rmdirSync(this.lock); } }
}
