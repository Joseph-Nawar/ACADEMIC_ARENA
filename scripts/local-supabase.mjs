import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedServices = "realtime,storage,functions,studio,mail,analytics,pooler";

function capture(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; });
    child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function runSupabase(args) {
  const result = await capture("npx", ["--no-install", "supabase", ...args], {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  if (result.code !== 0) {
    // CLI errors can contain local API keys. Keep diagnostics credential-free.
    throw new Error(`Local Supabase command failed (${args[0]}).`);
  }
  return result.stdout;
}

async function start() {
  await runSupabase(["start", "--runtime", "native", "--exclude", excludedServices, "--eager"]);
  process.stdout.write("Local Supabase native stack started; local keys were not printed.\n");
}

async function reset() {
  await start();
  await runSupabase(["db", "reset"]);
  process.stdout.write("Local Supabase database reset from committed migrations and fictional-only seed data.\n");
}

async function stop() {
  await runSupabase(["stop"]);
  process.stdout.write("Local Supabase stopped; Docker volumes were retained for local development.\n");
}

const action = process.argv[2];
try {
  if (action === "start") await start();
  else if (action === "reset") await reset();
  else if (action === "stop") await stop();
  else throw new Error("Choose start, reset, or stop.");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
