import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { waitForHttpReady } from "../../scripts/http-readiness.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("local readiness polling retries until the server responds", async (context) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(requests < 3 ? 503 : 200).end();
  });
  const port = await listen(server);
  context.after(() => close(server));

  assert.equal(await waitForHttpReady(`http://127.0.0.1:${port}`, { timeoutMs: 1000, intervalMs: 5 }), "ready");
  assert.equal(requests, 3);
});

test("a stalled local readiness request is aborted within the overall deadline", async (context) => {
  const server = createServer(() => {});
  const port = await listen(server);
  context.after(() => close(server));
  const startedAt = Date.now();
  let watchdog;

  const outcome = await Promise.race([
    waitForHttpReady(`http://127.0.0.1:${port}`, { timeoutMs: 250, intervalMs: 5 })
      .then((result) => ({ result })),
    new Promise((resolve) => { watchdog = setTimeout(() => resolve({ hung: true }), 1500); }),
  ]);
  clearTimeout(watchdog);

  assert.deepEqual(outcome, { result: "timeout" });
  assert.ok(Date.now() - startedAt >= 150, "readiness waits for the configured deadline before failing");
});
