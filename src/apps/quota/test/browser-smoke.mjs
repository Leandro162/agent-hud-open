// Run with the quota Vite dev server and loopback reader already started.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

await mkdir("test-results/quota", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 360, height: 760 },
    deviceScaleFactor: 1.25,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1421");
  await expect(
    page.getByRole("heading", { name: "Codex 账户额度" }),
  ).toBeVisible();
  await expect(page.getByText("已连接服务器 · 自动刷新")).toBeVisible();
  await expect(page.getByText("未配置 DeepSeek API Key")).toBeVisible();
  await expect(page.getByRole("meter").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/quota/simple.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Dynamic 动态" }).click();
  await expect(page.locator("main")).toHaveClass("dynamic");
  await page.screenshot({
    path: "test-results/quota/dynamic.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("main")).toHaveClass("dynamic");
  await expect(page.getByRole("meter").first()).toBeVisible();
  const previous = await page
    .getByRole("meter")
    .first()
    .getAttribute("aria-valuenow");
  await page.route("**/api/**", (route) => route.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("连接中断 · 请检查安全隧道")).toBeVisible();
  await expect(page.getByRole("meter").first()).toHaveAttribute(
    "aria-valuenow",
    previous,
  );
  await expect(page.getByText("数据已过期 · 连接已中断").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/quota/disconnected.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".provider-mark")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  for (const width of [320, 360, 520]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
  console.log(
    "Browser checks passed: actual quotas, modes, saved preference, stale retention, reduced motion, 320/360/520px layouts.",
  );
} finally {
  await browser.close();
}
