export async function waitForHttpReady(url, { child, timeoutMs = 60_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) return "exited";
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return "timeout";

    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, remainingMs))),
      });
      const ready = response.ok;
      if (response.body) void response.body.cancel().catch(() => {});
      if (ready) return "ready";
    } catch {}

    const waitMs = Math.min(intervalMs, deadline - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
