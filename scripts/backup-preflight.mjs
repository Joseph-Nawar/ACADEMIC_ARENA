// Credential-free preflight for `scripts/db-backup.sh export linked`.
//   node scripts/backup-preflight.mjs <project-ref>
// Checks, without logging in or reading data:
//   1. the repository is linked to <project-ref> (supabase/.temp/project-ref);
//   2. the system resolver can resolve api.supabase.com (the CLI mints a
//      temporary login role there; this network's resolver has returned SERVFAIL);
//   3. the Management API answers over HTTPS;
//   4. the saved session-mode pooler (IPv4, port 5432) accepts TCP + Postgres SSL;
//   5. Docker is running (the CLI runs pg_dump in a container).
// Prints only host names, ports, and pass/fail; never a password or token.
import { execFileSync } from "node:child_process";
import { promises as dns } from "node:dns";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const root = path.resolve(import.meta.dirname, "..");
const ref = process.argv[2];
if (!/^[a-z0-9]{20}$/u.test(ref || "")) {
  console.error("usage: node scripts/backup-preflight.mjs <project-ref>");
  process.exit(2);
}
let failed = 0;
const report = (ok, label, hint = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && hint ? `\n     → ${hint}` : ""}`);
  if (!ok) failed += 1;
};
const read = (name) => { try { return readFileSync(path.join(root, "supabase/.temp", name), "utf8").trim(); } catch { return ""; } };

const linked = read("project-ref");
report(linked === ref, `repository linked to ${ref}`, `run: npx supabase link --project-ref ${ref}`);

try {
  await dns.lookup("api.supabase.com", { family: 4 });
  report(true, "system DNS resolves api.supabase.com");
} catch (error) {
  report(false, `system DNS resolves api.supabase.com (${error.code})`,
    "this resolver is failing; retry later, or use a network/resolver that works (e.g. a phone hotspot) for the backup");
}

try {
  const response = await fetch("https://api.supabase.com/v1/projects", { signal: AbortSignal.timeout(10_000) });
  report([200, 401, 403].includes(response.status), `Management API reachable (HTTP ${response.status})`);
} catch (error) {
  report(false, `Management API reachable (${error.cause?.code || error.name})`, "network or DNS problem; retry later");
}

// Only the host and port of the saved pooler URL are used; its user part is never printed.
let host = "";
let port = 5432;
let urlRef = "";
try {
  const url = new URL(read("pooler-url"));
  host = url.hostname;
  port = Number(url.port || 5432);
  urlRef = decodeURIComponent(url.username).split(".").pop(); // pooler user is postgres.<ref>; never printed
} catch { /* reported below */ }
report(urlRef === ref, "saved pooler URL belongs to this project", `stale link metadata; run: npx supabase link --project-ref ${ref}`);
if (!host || linked !== ref || urlRef !== ref) {
  report(false, "saved session-pooler URL for this project", `run: npx supabase link --project-ref ${ref}`);
} else {
  const result = await new Promise((resolve) => {
    const socket = net.connect({ host, port, family: 4, timeout: 10_000 });
    socket.on("connect", () => {
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4); // SSLRequest
      socket.write(request);
    });
    socket.once("data", (data) => {
      if (data[0] !== 0x53) { socket.destroy(); resolve("no SSL"); return; }
      const secure = tls.connect({ socket, servername: host, rejectUnauthorized: false }, () => { secure.destroy(); resolve("ok"); });
      secure.on("error", (error) => resolve(error.code || "tls error"));
    });
    socket.on("timeout", () => { socket.destroy(); resolve("timeout"); });
    socket.on("error", (error) => resolve(error.code || "error"));
  });
  report(result === "ok", `session pooler ${host}:${port} accepts TCP + Postgres SSL (IPv4) — ${result}`,
    "the pooler is blocked from this network; use another network");
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 });
  report(true, "Docker is running");
} catch {
  report(false, "Docker is running", "start Docker Desktop");
}

console.log(failed ? `${failed} check(s) failed: do not start the backup yet.` : "Ready: run scripts/db-backup.sh export linked <absolute path outside the repo>.");
process.exit(failed ? 1 : 0);
