import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function run(command, args, label, env = process.env) {
  const result = await capture(command, args, env);
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}).`);
  return result.stdout;
}

function parseEnv(output) {
  const values = Object.create(null);
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const quote = rawValue[0];
    const value = (quote === "\"" || quote === "'") && rawValue.at(-1) === quote
      ? rawValue.slice(1, -1)
      : rawValue;
    values[key] = value;
  }
  return values;
}

try {
  await run(process.execPath, ["scripts/local-supabase.mjs", "start"], "Supabase start");
  await run("npx", ["--no-install", "supabase", "db", "reset"], "Supabase reset", {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  const statusText = await run("npx", ["--no-install", "supabase", "status", "--env", "--output-format", "text"], "Supabase status", {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  const status = parseEnv(statusText);
  const apiUrl = status.API_URL;
  const dbUrl = status.DB_URL;
  const anonKey = status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  const isLoopback = (hostname) => hostname === "127.0.0.1" || hostname === "[::1]";
  if (!apiUrl || !dbUrl || !anonKey || !serviceRoleKey ||
      !isLoopback(new URL(apiUrl).hostname) || !isLoopback(new URL(dbUrl).hostname)) {
    throw new Error("Local Supabase did not report complete loopback-only endpoints.");
  }
  const testFiles = (await readdir(path.join(root, "tests/m2")))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests/m2", name));
  if (testFiles.length === 0) throw new Error("No local M2 integration tests were found.");
  const testEnv = {
    ...process.env,
    AA_SUPABASE_URL: apiUrl,
    AA_SUPABASE_DB_URL: dbUrl,
    AA_SUPABASE_ANON_KEY: anonKey,
    AA_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  const result = await capture(process.execPath, ["--test", ...testFiles], testEnv);
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    process.stderr.write("M2 local integration tests failed. Local provider credentials were not emitted.\n");
    process.exitCode = result.code || 1;
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
