import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedServices = "realtime,storage,functions,studio,mail,analytics,pooler";
const runtime = process.env.AA_SUPABASE_RUNTIME || "native";
const commandTimeoutMs = 5 * 60 * 1000;

function capture(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; });
    child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 5000).unref();
    }, commandTimeoutMs);
    timeout.unref();
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut });
    });
  });
}

async function runSupabase(args) {
  const result = await capture("npx", ["--no-install", "supabase", ...args], {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  if (result.code !== 0) {
    // CLI errors can contain local API keys. Keep diagnostics credential-free.
    throw new Error(result.timedOut
      ? `Local Supabase command timed out (${args[0]}) after ${commandTimeoutMs / 1000} seconds.`
      : `Local Supabase command failed (${args[0]}).`);
  }
  return result.stdout;
}

async function start() {
  if (!["native", "docker", "auto"].includes(runtime)) throw new Error("AA_SUPABASE_RUNTIME must be native, docker, or auto.");
  await runSupabase(["start", "--runtime", runtime, "--exclude", excludedServices, "--eager"]);
  process.stdout.write(`Local Supabase stack started with runtime selection '${runtime}'; local keys were not printed.\n`);
}

async function reset() {
  await start();
  await runSupabase(["db", "reset"]);
  process.stdout.write("Local Supabase database reset from committed migrations and fictional-only seed data.\n");
}

async function stop() {
  await runSupabase(["stop"]);
  process.stdout.write("Local Supabase stopped; local database data was retained.\n");
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
