const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs),
  ]);
}

export async function stopProcessTree(child, { graceMs = 5000, pollMs = 50 } = {}) {
  if (!child) return;

  if (process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await waitForChildExit(child, graceMs);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForChildExit(child, 1000);
    return;
  }

  if (!Number.isInteger(child.pid)) return;
  signalProcessGroup(child.pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processGroupExists(child.pid)) {
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  if (processGroupExists(child.pid)) signalProcessGroup(child.pid, "SIGKILL");
  await waitForChildExit(child, 1000);
}
