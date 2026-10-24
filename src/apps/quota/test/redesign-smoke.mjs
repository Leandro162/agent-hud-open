import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results/quota", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 360, height: 760 },
    deviceScaleFactor: 1.5,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const now = Date.now();
  const provider = (data) => ({
    data,
    status: "ok",
    error: null,
    updatedAt: new Date(now).toISOString(),
    attemptedAt: new Date(now).toISOString(),
  });
  const snapshot = {
    schemaVersion: 1,
    serverTime: new Date(now).toISOString(),
    providers: {
      codex: provider({
        windows: [
          {
            id: "primary",
            name: "Codex",
            slot: "primary",
            durationMinutes: 300,
            remainingPercent: 76,
            resetsAt: new Date(now + 7300000).toISOString(),
          },
          {
            id: "secondary",
            name: "Codex",
            slot: "secondary",
            durationMinutes: 10080,
            remainingPercent: 42,
            resetsAt: new Date(now + 290000000).toISOString(),
          },
        ],
      }),
      deepseek: provider({
        balances: [
          {
            currency: "CNY",
            total: "128.46",
            toppedUp: "120.00",
            granted: "8.46",
          },
        ],
      }),
    },
  };
  await page.route("**/api/**", (r) => r.fulfill({ json: snapshot }));
  await page.addInitScript(() => localStorage.setItem("quota-mode", "simple"));
  await page.goto("http://127.0.0.1:1421");
  await expect(page.locator("main")).toHaveClass("dynamic");
  await expect(
    page.getByRole("button", { name: /Simple|Dynamic/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("meter")).toHaveCount(2);
  for (const img of await page.locator(".provider-mark img").all())
    expect(await img.evaluate((e) => e.complete && e.naturalWidth > 0)).toBe(
      true,
    );
  await page.screenshot({
    path: "test-results/quota/redesign.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 760 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 760 });
  await page.route("**/api/**", (r) => r.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("连接中断 · 请检查安全隧道")).toBeVisible();
  await expect(page.getByRole("meter").first()).toHaveAttribute(
    "aria-valuenow",
    "76",
  );
  await page.screenshot({
    path: "test-results/quota/redesign-disconnected.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".brand span")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  expect(errors).toEqual([]);
  console.log(
    "PASS: dynamic only, legacy preference, official assets, settings, narrow layouts, stale retention, reduced motion. Synthetic preview data only.",
  );
} finally {
  await browser.close();
}
