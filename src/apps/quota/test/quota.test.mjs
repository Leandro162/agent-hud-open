import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import {
  codexLimits,
  deepseekBalance,
  ProviderCache,
} from "../server/model.mjs";
import { createQuotaServer } from "../server/http.mjs";

test("Codex uses authoritative multi-bucket data and discovers actual windows", () => {
  const result = codexLimits({
    rateLimits: { primary: { usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: {
        primary: {
          usedPercent: 28,
          windowDurationMins: 300,
          resetsAt: 2000000000,
        },
        secondary: { usedPercent: 100 },
      },
      review: {
        limitName: "Review",
        futureWindow: { usedPercent: 2, windowDurationMins: 1440 },
      },
    },
  });
  assert.equal(result.windows.length, 3);
  assert.equal(result.windows[0].remainingPercent, 72);
  assert.equal(result.windows[1].remainingPercent, 0);
  assert.equal(result.windows[1].resetsAt, null);
  assert.equal(result.windows[2].durationMinutes, 1440);
  assert.deepEqual(
    codexLimits({
      rateLimitsByLimitId: {},
      rateLimits: { primary: { usedPercent: 5 } },
    }),
    { windows: [] },
  );
});

test("missing, null, invalid and out-of-range quota fields remain unknown", () => {
  for (const usedPercent of [null, undefined, "10", -1, 101, NaN, Infinity]) {
    const result = codexLimits({
      rateLimits: {
        primary: { usedPercent, resetsAt: null, windowDurationMins: null },
      },
    });
    assert.equal(result.windows[0].remainingPercent, null);
    assert.equal(result.windows[0].resetsAt, null);
    assert.equal(result.windows[0].durationMinutes, null);
  }
});

test("DeepSeek preserves decimal strings and separate currencies without invented periods", () => {
  const result = deepseekBalance({
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "88.50",
        topped_up_balance: "80.00",
        granted_balance: "8.50",
      },
      {
        currency: "USD",
        total_balance: "0.00",
        topped_up_balance: null,
        granted_balance: "wrong",
      },
    ],
  });
  assert.equal(result.balances[0].total, "88.50");
  assert.equal(result.balances[1].total, "0.00");
  assert.equal(result.balances[1].toppedUp, null);
  assert.equal(result.balances[1].granted, null);
  assert.equal("resetsAt" in result.balances[0], false);
  assert.throws(() => deepseekBalance({}), /invalid_response/);
});

test("provider retries preserve old data, sanitize errors, and obey backoff", async () => {
  let now = 100000;
  let fail = false;
  let calls = 0;
  const cache = new ProviderCache(
    async () => {
      calls++;
      if (fail) throw new Error("secret-like provider payload");
      return { total: "9.00" };
    },
    { now: () => now },
  );
  await cache.refresh();
  const updatedAt = cache.state.updatedAt;
  now += 60001;
  fail = true;
  await cache.refresh();
  assert.equal(cache.state.status, "stale");
  assert.equal(cache.state.updatedAt, updatedAt);
  assert.equal(cache.state.error, "read_failed");
  assert.equal(cache.state.data.total, "9.00");
  await cache.refresh();
  assert.equal(calls, 2);
  now += 5001;
  await cache.refresh(true);
  assert.equal(calls, 3);
});

test("concurrent requests share one provider read and provider failures are independent", async () => {
  let calls = 0;
  const cache = new ProviderCache(async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { windows: [] };
  });
  const unconfigured = new ProviderCache(async () => {
    throw new Error("not_configured");
  });
  await Promise.all([
    cache.refresh(),
    cache.refresh(true),
    unconfigured.refresh(),
  ]);
  assert.equal(calls, 1);
  assert.equal(cache.state.status, "ok");
  assert.equal(unconfigured.state.data, null);
  assert.equal(unconfigured.state.error, "not_configured");
});

test("HTTP boundary blocks browser origins, bad hosts and arbitrary remote methods", async (t) => {
  const provider = new ProviderCache(async () => ({ windows: [] }));
  await provider.refresh();
  const server = createQuotaServer({ codex: provider, deepseek: provider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/refresh`, {
        method: "POST",
        headers: { Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  const badHost = await new Promise((resolve, reject) => {
    const req = request(
      `${base}/api/snapshot`,
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(badHost, 403);
  assert.equal(
    (await fetch(`${base}/api/execute`, { method: "POST" })).status,
    404,
  );
  const response = await fetch(`${base}/api/refresh`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
});
