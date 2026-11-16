import { spawn } from "node:child_process";
import { chmod, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stopProcessTree } from "./process-cleanup.mjs";
import { waitForHttpReady } from "./http-readiness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function capture(command, args, env = process.env, timeoutMs = 5 * 60 * 1000) {
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
    }, timeoutMs);
    timeout.unref();
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut });
    });
  });
}

async function run(command, args, label, env = process.env, timeoutMs = 5 * 60 * 1000) {
  const result = await capture(command, args, env);
  if (result.code !== 0) {
    const detail = result.timedOut ? `timed out after ${timeoutMs / 1000} seconds` : `failed (exit ${result.code})`;
    throw new Error(`${label} ${detail}.`);
  }
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

async function startPagesPreview(port, secretsToRedact = []) {
  await run("npm", ["run", "build:production"], "production Pages build");
  const child = spawn("npx", [
    "--no-install", "wrangler", "pages", "dev", "dist",
    "--ip", "127.0.0.1", "--port", String(port),
  ], {
    cwd: root,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.setEncoding("utf8").on("data", (part) => { log += part; });
  child.stderr.setEncoding("utf8").on("data", (part) => { log += part; });
  child.once("error", () => {});
  const url = `http://127.0.0.1:${port}`;
  const sanitizedLog = () => {
    let safe = log;
    for (const secret of secretsToRedact) {
      if (secret?.length >= 12) safe = safe.split(secret).join("[redacted-generated-secret]");
    }
    return safe
      .replace(/eyJ[A-Za-z0-9_.-]{20,}/gu, "[redacted-jwt]")
      .replace(/(SUPABASE_[A-Z_]+|SESSION_JWE_KEY|RATE_LIMIT_HMAC_KEY)=\S+/gu, "$1=[redacted]")
      .replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted-value]")
      .slice(-1200);
  };
  const readiness = await waitForHttpReady(url, { child, timeoutMs: 60_000, intervalMs: 100 });
  if (readiness === "ready") return { child, url, safeLog: sanitizedLog };
  if (readiness === "exited") {
    await stopProcessTree(child);
    throw new Error(`Local Cloudflare Pages preview exited before becoming ready (${child.exitCode ?? child.signalCode}): ${sanitizedLog()}`);
  }
  await stopProcessTree(child);
  const safeLog = sanitizedLog();
  throw new Error(`Local Cloudflare Pages preview did not become ready.${safeLog ? ` ${safeLog}` : ""}`);
}

async function startProviderFaultProxy(targetUrl, port) {
  let pendingFailure;
  let pendingPause;
  let activePause;
  const providerRequestCounts = new Map();
  const providerRequestCompletionCounts = new Map();
  const testInstruction = (body) => {
    const instruction = JSON.parse(body.toString("utf8"));
    if (!/^[0-9a-f-]{36}$/iu.test(instruction.providerUserId) ||
        !["user-password-update", "mfa-factor-list"].includes(instruction.operation)) return null;
    return { providerUserId: instruction.providerUserId.toLowerCase(), operation: instruction.operation };
  };
  const server = createHttpServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", targetUrl);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    if (requestUrl.pathname === "/__local_test__/fail-next-provider-request" && request.method === "POST") {
      if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(request.socket.remoteAddress)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const instruction = JSON.parse(body.toString("utf8"));
        if (!/^[0-9a-f-]{36}$/iu.test(instruction.providerUserId) ||
            !["user-password-update", "mfa-factor-list"].includes(instruction.operation)) {
          response.writeHead(400).end();
          return;
        }
        pendingFailure = instruction;
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
      return;
    }

    if (requestUrl.pathname === "/__local_test__/pause-next-provider-request" && request.method === "POST") {
      if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(request.socket.remoteAddress)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const instruction = testInstruction(body);
        if (!instruction) {
          response.writeHead(400).end();
          return;
        }
        pendingPause = instruction;
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
      return;
    }

    if (requestUrl.pathname === "/__local_test__/provider-request-state" && request.method === "GET") {
      if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(request.socket.remoteAddress)) {
        response.writeHead(403).end();
        return;
      }
      const instruction = testInstruction(Buffer.from(JSON.stringify({
        providerUserId: requestUrl.searchParams.get("providerUserId"),
        operation: requestUrl.searchParams.get("operation"),
      })));
      if (!instruction) {
        response.writeHead(400).end();
        return;
      }
      const key = `${instruction.providerUserId}:${instruction.operation}`;
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({
          count: providerRequestCounts.get(key) || 0,
          completedCount: providerRequestCompletionCounts.get(key) || 0,
          paused: activePause?.providerUserId === instruction.providerUserId && activePause?.operation === instruction.operation,
        }));
      return;
    }

    if (requestUrl.pathname === "/__local_test__/release-provider-request" && request.method === "POST") {
      if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(request.socket.remoteAddress)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const instruction = testInstruction(body);
        if (!instruction || activePause?.providerUserId !== instruction.providerUserId ||
            activePause?.operation !== instruction.operation) {
          response.writeHead(409).end();
          return;
        }
        const pause = activePause;
        activePause = undefined;
        pause.release();
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
      return;
    }

    const userUpdateMatch = requestUrl.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/iu);
    const factorListMatch = requestUrl.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})\/factors$/iu);
    const shouldFailPassword = pendingFailure?.operation === "user-password-update" &&
      userUpdateMatch?.[1]?.toLowerCase() === pendingFailure.providerUserId.toLowerCase() &&
      ["PUT", "PATCH"].includes(request.method || "");
    const shouldFailFactors = pendingFailure?.operation === "mfa-factor-list" &&
      factorListMatch?.[1]?.toLowerCase() === pendingFailure.providerUserId.toLowerCase();
    if (shouldFailPassword || shouldFailFactors) {
      pendingFailure = undefined;
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ msg: "Injected one-time local provider failure." }));
      return;
    }

    const providerUserId = userUpdateMatch?.[1]?.toLowerCase() || factorListMatch?.[1]?.toLowerCase();
    const providerOperation = userUpdateMatch && ["PUT", "PATCH"].includes(request.method || "")
      ? "user-password-update"
      : factorListMatch ? "mfa-factor-list" : null;
    const operationKey = providerUserId && providerOperation ? `${providerUserId}:${providerOperation}` : null;
    if (operationKey) providerRequestCounts.set(operationKey, (providerRequestCounts.get(operationKey) || 0) + 1);
    if (pendingPause && providerUserId === pendingPause.providerUserId && providerOperation === pendingPause.operation) {
      const pause = pendingPause;
      pendingPause = undefined;
      activePause = pause;
      await new Promise((resolve) => { pause.release = resolve; });
      if (activePause === pause) activePause = undefined;
    }

    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (["host", "connection", "content-length"].includes(name) || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const upstream = await fetch(requestUrl, {
        method: request.method,
        headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
        redirect: "manual",
      });
      response.statusCode = upstream.status;
      for (const [name, value] of upstream.headers) {
        if (["connection", "content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(name)) continue;
        response.setHeader(name, value);
      }
      const cookies = upstream.headers.getSetCookie?.();
      if (cookies?.length) response.setHeader("set-cookie", cookies);
      const upstreamBody = request.method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer());
      if (operationKey) providerRequestCompletionCounts.set(operationKey, (providerRequestCompletionCounts.get(operationKey) || 0) + 1);
      response.end(upstreamBody);
    } catch {
      response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ msg: "Local provider proxy unavailable." }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  let timeout;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Provider test proxy did not close within 5 seconds.")), 5000);
        timeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

let pagesProcess;
let pagesSafeLog;
let providerProxy;
let supabaseStartAttempted = false;
let lifecycleGateAvailable = false;
let testEnvironmentFile;
let previousDevVars;

try {
  const existingStack = await capture("npx", ["--no-install", "supabase", "status", "--output-format", "json"], {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  if (existingStack.timedOut) {
    throw new Error("Could not verify the local Supabase stack state; refusing to start or reset an unknown stack.");
  }
  let stackStatus;
  try {
    stackStatus = JSON.parse(existingStack.stdout);
  } catch {
    throw new Error("Could not verify the local Supabase stack state; refusing to start or reset an unknown stack.");
  }
  if (existingStack.code !== 0) {
    if (stackStatus.error?.message !== "No managed stack exists for the selected project.") {
      throw new Error("Could not verify the local Supabase stack state; refusing to start or reset an unknown stack.");
    }
  } else {
    if (stackStatus.identity?.project_root !== root || !Array.isArray(stackStatus.services)) {
      throw new Error("Could not verify ownership of the local Supabase stack; refusing to start or reset it.");
    }
    const requiredServices = new Set(["database", "rest", "auth"]);
    const reportedServices = new Set(stackStatus.services.map((service) => service.service));
    if ([...requiredServices].some((service) => !reportedServices.has(service))) {
      throw new Error("Could not verify the required local Supabase services; refusing to start or reset an unknown stack.");
    }
    const stoppedStates = new Set(["unavailable", "stopped"]);
    if (stackStatus.services.some((service) => !stoppedStates.has(service.state))) {
      throw new Error("A local Supabase stack is already running or partially available. Stop it before running this test command; the command resets local data.");
    }
  }
  supabaseStartAttempted = true;
  await run(process.execPath, ["scripts/local-supabase.mjs", "start"], "Supabase start");
  await run("npx", ["--no-install", "supabase", "db", "reset"], "Supabase reset", {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
  });
  lifecycleGateAvailable = true;
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
  const proxyPort = await availableLoopbackPort();
  const proxy = await startProviderFaultProxy(apiUrl, proxyPort);
  providerProxy = proxy.server;
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
    `SUPABASE_URL=${proxy.url}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `SESSION_JWE_KEY=${jweKey}`,
    `RATE_LIMIT_HMAC_KEY=${rateLimitKey}`,
    "ENVIRONMENT=test",
    "",
  ].join("\n");
  await writeFile(testEnvironmentFile, envFile, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(testEnvironmentFile, 0o600);
  const pages = await startPagesPreview(port, [anonKey, serviceRoleKey, jweKey, rateLimitKey]);
  pagesProcess = pages.child;
  pagesSafeLog = pages.safeLog;
  const testEnv = {
    ...process.env,
    AA_SUPABASE_URL: proxy.url,
    AA_SUPABASE_TARGET_URL: apiUrl,
    AA_SUPABASE_DB_URL: dbUrl,
    AA_SUPABASE_ANON_KEY: anonKey,
    AA_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    AA_PAGES_URL: pages.url,
    AA_SESSION_JWE_KEY: jweKey,
    AA_RATE_LIMIT_HMAC_KEY: rateLimitKey,
  };
  const result = await capture(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], testEnv);
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    process.stderr.write("M2 local integration tests failed. Local provider credentials were not emitted.\n");
    const previewLog = pagesSafeLog?.();
    if (previewLog) process.stderr.write(`Local Pages preview log excerpt (sensitive values redacted): ${previewLog}\n`);
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
  process.stdout.write("Cleanup: stopping local Pages preview process group.\n");
  try {
    await stopProcessTree(pagesProcess);
  } catch {
    process.stderr.write("Local Pages preview process cleanup failed.\n");
    process.exitCode = 1;
  }
  process.stdout.write("Cleanup: closing local provider proxy.\n");
  try {
    await stopServer(providerProxy);
  } catch {
    process.stderr.write("Local provider proxy cleanup failed.\n");
    process.exitCode = 1;
  }
  if (testEnvironmentFile) {
    if (previousDevVars) {
      await writeFile(testEnvironmentFile, previousDevVars.contents, { mode: previousDevVars.mode });
      await chmod(testEnvironmentFile, previousDevVars.mode);
    } else {
      await rm(testEnvironmentFile, { force: true });
    }
  }
  if (lifecycleGateAvailable) {
    try {
      await run("npx", [
        "--no-install", "supabase", "db", "query", "--local",
        "update app_private.runtime_controls set allow_fictional_account_lifecycle = true where singleton",
      ], "Lifecycle gate restore", { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" });
    } catch {
      process.stderr.write("Local lifecycle gate cleanup failed; reset the Supabase stack before using it.\n");
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
    }
  }
  if (supabaseStartAttempted) {
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
