import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results/quota", { recursive: true });
const browser = await chromium.launch();
try {
  for (const scenario of [
    "latest",
    "available",
    "download-failure",
    "check-failure",
  ]) {
    const page = await browser.newPage({
      viewport: { width: 380, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ scenario }) => {
        window.isTauri = true;
        window.updateCalls = [];
        window.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (cmd, args = {}) => {
            window.updateCalls.push(cmd);
            if (cmd === "plugin:app|version") return "0.2.0";
            if (cmd === "quota_snapshot")
              return {
                schemaVersion: 1,
                serverTime: new Date().toISOString(),
                providers: {
                  codex: { data: { windows: [] }, status: "ok" },
                  deepseek: { data: { balances: [] }, status: "ok" },
                },
              };
            if (cmd === "plugin:updater|check") {
              if (scenario === "check-failure") throw Error("network");
              return scenario === "latest"
                ? null
                : {
                    rid: 1,
                    currentVersion: "0.2.0",
                    version: "0.2.1",
                    body: "界面优化\n更新通道验证",
                    rawJson: {},
                  };
            }
            if (cmd === "plugin:updater|download") {
              args.onEvent.onmessage({
                event: "Started",
                data: { contentLength: 100 },
              });
              args.onEvent.onmessage({
                event: "Progress",
                data: { chunkLength: 50 },
              });
              await new Promise((r) => setTimeout(r, 800));
              if (scenario === "download-failure")
                throw Error("signature mismatch");
              args.onEvent.onmessage({ event: "Finished" });
              return 2;
            }
            if (cmd === "plugin:updater|install") {
              window.installOptions = args;
              return;
            }
            if (cmd === "plugin:resources|close") return;
            throw Error("Unexpected IPC " + cmd);
          },
        };
      },
      { scenario },
    );
    await page.goto("http://127.0.0.1:1421");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByText("当前版本 v0.2.0")).toBeVisible();
    await page.getByRole("button", { name: "检查更新", exact: true }).click();
    if (scenario === "latest")
      await expect(page.getByText("已是最新版本")).toBeVisible();
    else if (scenario === "check-failure")
      await expect(page.getByRole("alert")).toContainText("暂时无法检查更新");
    else {
      await expect(page.getByText("发现新版本")).toBeVisible();
      expect(
        await page.evaluate(() =>
          window.updateCalls.includes("plugin:updater|install"),
        ),
      ).toBe(false);
      await page.screenshot({
        path: `test-results/quota/update-${scenario}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "下载更新并重启" }).click();
      await expect(
        page.getByRole("progressbar", { name: "更新下载进度" }),
      ).toHaveAttribute("value", "50");
      await expect(
        page.getByRole("button", { name: "检查更新", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await expect(page.locator(".updater-panel")).toBeVisible();
      if (scenario === "download-failure") {
        await expect(page.getByRole("alert")).toContainText("当前版本已保留");
        expect(
          await page.evaluate(() =>
            window.updateCalls.includes("plugin:updater|install"),
          ),
        ).toBe(false);
        await expect(
          page.getByRole("button", { name: "下载更新并重启" }),
        ).toBeEnabled();
      } else {
        await expect(
          page.getByRole("button", { name: "正在安装并重启…" }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => window.installOptions.restartAfterInstall),
        ).toBe(true);
      }
    }
    expect(errors).toEqual([]);
    await page.close();
  }
  console.log(
    "PASS updater UI with mocked IPC: latest, available, user consent, progress, single operation, persistence on settings close, network/signature failure, retry, restart request. Native installation is outside this mocked test.",
  );
} finally {
  await browser.close();
}
