import { spawn } from "node:child_process";
import { chmod, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startPagesPreview(port) {
  await run("npm", ["run", "build:production"], "production Pages build");
  const child = spawn("npx", [
    "--no-install", "wrangler", "pages", "dev", "dist",
    "--ip", "127.0.0.1", "--port", String(port),
  ], {
    cwd: root,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.setEncoding("utf8").on("data", (part) => { log += part; });
  child.stderr.setEncoding("utf8").on("data", (part) => { log += part; });
  child.once("error", () => {});
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      const safeLog = log
        .replace(/eyJ[A-Za-z0-9_.-]{20,}/gu, "[redacted-jwt]")
        .replace(/(SUPABASE_[A-Z_]+|SESSION_JWE_KEY|RATE_LIMIT_HMAC_KEY)=\S+/gu, "$1=[redacted]")
        .replace(/[A-Za-z0-9_-]{64,}/gu, "[redacted-value]")
        .slice(-1200);
      throw new Error(`Local Cloudflare Pages preview exited before becoming ready (${child.exitCode}): ${safeLog}`);
    }
    try {
      const response = await fetch(url, { redirect: "error" });
      if (response.ok) return { child, url };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Local Cloudflare Pages preview did not become ready.");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

let pagesProcess;
let supabaseStarted = false;
let testEnvironmentFile;
let previousDevVars;

try {
  const existingStack = await capture("npx", ["--no-install", "supabase", "status", "--env", "--output-format", "text"], {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  if (existingStack.code === 0) {
    throw new Error("A local Supabase stack is already running. Stop it before running this test command; the command resets its local database.");
  }
  await run(process.execPath, ["scripts/local-supabase.mjs", "start"], "Supabase start");
  supabaseStarted = true;
  await run("npx", ["--no-install", "supabase", "db", "reset"], "Supabase reset", {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  const databaseTests = await capture("npx", ["--no-install", "supabase", "test", "db"], {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  process.stdout.write(databaseTests.stdout);
  if (databaseTests.code !== 0) {
    process.stderr.write("Local Supabase pgTAP/RLS tests failed. Provider credentials were not emitted.\n");
    process.exitCode = databaseTests.code || 1;
    throw new Error("Local Supabase pgTAP/RLS tests failed.");
  }
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
    .filter((name) => name.endsWith(".test.mjs") && name !== "lifecycle-gate.integration.test.mjs")
    .sort()
    .map((name) => path.join("tests/m2", name));
  if (testFiles.length === 0) throw new Error("No local M2 integration tests were found.");
  const jweKey = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const rateLimitKey = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const port = await availableLoopbackPort();
  testEnvironmentFile = path.join(root, ".dev.vars");
  try {
    const [contents, metadata] = await Promise.all([readFile(testEnvironmentFile), stat(testEnvironmentFile)]);
    previousDevVars = { contents, mode: metadata.mode & 0o777 };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const envFile = [
    `SUPABASE_URL=${apiUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `SESSION_JWE_KEY=${jweKey}`,
    `RATE_LIMIT_HMAC_KEY=${rateLimitKey}`,
    "ENVIRONMENT=test",
    "",
  ].join("\n");
  await writeFile(testEnvironmentFile, envFile, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(testEnvironmentFile, 0o600);
  const pages = await startPagesPreview(port);
  pagesProcess = pages.child;
  const testEnv = {
    ...process.env,
    AA_SUPABASE_URL: apiUrl,
    AA_SUPABASE_DB_URL: dbUrl,
    AA_SUPABASE_ANON_KEY: anonKey,
    AA_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    AA_PAGES_URL: pages.url,
    AA_SESSION_JWE_KEY: jweKey,
    AA_RATE_LIMIT_HMAC_KEY: rateLimitKey,
  };
  const result = await capture(process.execPath, ["--test", ...testFiles], testEnv);
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    process.stderr.write("M2 local integration tests failed. Local provider credentials were not emitted.\n");
    process.exitCode = result.code || 1;
  }

  const disabledGate = await capture("npx", [
    "--no-install", "supabase", "db", "query", "--local",
    "update app_private.runtime_controls set allow_fictional_account_lifecycle = false where singleton",
  ], { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" });
  if (disabledGate.code !== 0) throw new Error("Could not disable the local lifecycle gate for direct PostgREST verification.");
  const lifecycleGate = await capture(process.execPath, ["--test", "tests/m2/lifecycle-gate.integration.test.mjs"], testEnv);
  process.stdout.write(lifecycleGate.stdout);
  if (lifecycleGate.code !== 0) {
    process.stderr.write("Direct local PostgREST lifecycle-gate tests failed. Provider credentials were not emitted.\n");
    process.exitCode = lifecycleGate.code || 1;
  }
} catch (error) {
  if (!process.exitCode) process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await stopProcess(pagesProcess);
  if (testEnvironmentFile) {
    if (previousDevVars) {
      await writeFile(testEnvironmentFile, previousDevVars.contents, { mode: previousDevVars.mode });
      await chmod(testEnvironmentFile, previousDevVars.mode);
    } else {
      await rm(testEnvironmentFile, { force: true });
    }
  }
  if (supabaseStarted) {
    try {
      await run("npx", [
        "--no-install", "supabase", "db", "query", "--local",
        "update app_private.runtime_controls set allow_fictional_account_lifecycle = true where singleton",
      ], "Lifecycle gate restore", { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" });
    } catch {
      process.stderr.write("Local lifecycle gate cleanup failed; reset the Supabase stack before using it.\n");
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
    }
    try {
      await run(process.execPath, ["scripts/local-supabase.mjs", "stop"], "Supabase stop", {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: "1",
      });
    } catch {
      process.stderr.write("Local Supabase cleanup failed; use npm run supabase:stop before continuing.\n");
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
    }
  }
}
