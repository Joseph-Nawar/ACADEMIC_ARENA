import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { stopProcessTree } from "../../scripts/process-cleanup.mjs";

test("local preview cleanup terminates descendant processes in its process group", { skip: process.platform === "win32" }, async (context) => {
  const source = [
    "const { spawn } = require('node:child_process');",
    "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
    "process.stdout.write(String(descendant.pid) + '\\n');",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const parent = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  context.after(async () => stopProcessTree(parent, { graceMs: 100, pollMs: 10 }));

  let output = "";
  const descendantPid = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("preview fixture did not start its child process")), 2000);
    parent.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      const match = output.match(/^(\d+)\n/u);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    parent.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  await stopProcessTree(parent, { graceMs: 100, pollMs: 10 });
  assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
});

test("local preview cleanup still terminates descendants after its leader exits", { skip: process.platform === "win32" }, async (context) => {
  const source = [
    "const { spawn } = require('node:child_process');",
    "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
    "process.stdout.write(String(descendant.pid) + '\\n');",
    "setImmediate(() => process.exit(0));",
  ].join("\n");
  const parent = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  context.after(async () => stopProcessTree(parent, { graceMs: 100, pollMs: 10 }));

  let output = "";
  const descendantPid = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("preview fixture did not start its child process")), 2000);
    parent.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      const match = output.match(/^(\d+)\n/u);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    parent.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  await new Promise((resolve, reject) => {
    if (parent.exitCode !== null || parent.signalCode !== null) return resolve();
    parent.once("exit", resolve).once("error", reject);
  });
  assert.doesNotThrow(() => process.kill(descendantPid, 0), "the fixture leaves a descendant after its leader exits");
  await stopProcessTree(parent, { graceMs: 100, pollMs: 10 });
  await waitForProcessExit(descendantPid);
});

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}
