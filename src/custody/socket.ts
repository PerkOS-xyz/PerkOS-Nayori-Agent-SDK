import { createServer, createConnection, type Server } from "node:net";
import { chmodSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { guard, object } from "./permit.js";
import type { CustodyEngine } from "./engine.js";
import type { HermesProfile } from "../mcp/server.js";

export interface CustodyPort {
  status(): Promise<unknown>;
  execute(request: unknown): Promise<unknown>;
}
const MAX = 32768;
function pathGuard(path: string) {
  guard(isAbsolute(path) && Buffer.byteLength(path) <= 100 && realpathSync(dirname(path)) === dirname(path));
}
/** No TCP listener. Parent must be signer-owned, group-traversable but not group-writable. */
export async function listenCustody(path: string, engine: CustodyEngine): Promise<Server> {
  pathGuard(path);
  const parent = lstatSync(dirname(path));
  guard(parent.isDirectory() && parent.uid === process.getuid?.() && (parent.mode & 0o777) === 0o710);
  const server = createServer(socket => {
    let bytes = Buffer.alloc(0), used = false;
    socket.setTimeout(30000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("data", async chunk => {
      if (used) { socket.destroy(); return; }
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > MAX) { socket.destroy(); return; }
      if (!bytes.includes(10)) return;
      used = true;
      try {
        guard(bytes.at(-1) === 10 && bytes.indexOf(10) === bytes.length - 1);
        const input = JSON.parse(bytes.toString("utf8"));
        const r = object(input, ["permitHash", "method", "request"]);
        guard(r.permitHash === engine.status().permitHash);
        let result: unknown;
        if (r.method === "status") { object(r.request, []); result = await engine.reconcile(); }
        else { guard(r.method === "execute"); result = await engine.execute(r.request); }
        socket.end(JSON.stringify({ ok: true, result }) + "\n");
      } catch {
        socket.end(JSON.stringify({ ok: false, error: "Reconcile custody status before retrying. An operation may already be signed or broadcast." }) + "\n");
      }
    });
  });
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    const error = (e: Error) => reject(e); server.once("error", error);
    server.listen(path, () => {
      try { chmodSync(path, 0o660); server.off("error", error); resolve(); }
      catch (e) { server.close(); reject(e); }
    });
  });
  return server;
}
export function custodyPort(path: string, permitHash: string, profile: Readonly<HermesProfile>): CustodyPort {
  pathGuard(path); guard(/^[a-f0-9]{64}$/.test(permitHash));
  async function call(method: "status" | "execute", request: unknown): Promise<unknown> {
    const message = JSON.stringify({ permitHash, method, request }) + "\n";
    guard(Buffer.byteLength(message) <= MAX);
    const result = await new Promise<unknown>((resolve, reject) => {
      const socket = createConnection(path); let bytes = Buffer.alloc(0), done = false;
      const fail = () => { if (!done) { done = true; socket.destroy(); reject(new Error("custody_unavailable_reconcile")); } };
      socket.setTimeout(30000, fail); socket.on("error", fail); socket.on("end", () => { if (!done) fail(); });
      socket.on("connect", () => socket.write(message));
      socket.on("data", chunk => {
        bytes = Buffer.concat([bytes, chunk]); if (bytes.length > MAX) return fail();
        if (!bytes.includes(10)) return;
        try {
          guard(bytes.at(-1) === 10 && bytes.indexOf(10) === bytes.length - 1);
          const data = JSON.parse(bytes.toString("utf8")) as { ok: boolean; result?: unknown };
          guard(data.ok === true && data.result); done = true; socket.destroy(); resolve(data.result);
        } catch { fail(); }
      });
    });
    const r = result as { permitHash: unknown; profile: Record<string, unknown> };
    guard(r.permitHash === permitHash && r.profile && Object.entries(profile).every(([k, v]) => r.profile[k] === v));
    return result;
  }
  return { status: () => call("status", {}), execute: async request => {
    // Verify role binding before sending a mutating request to the separate signer.
    await call("status", {}); return call("execute", request);
  } };
}
