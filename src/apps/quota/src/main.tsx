import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hudPalette } from "@agent-hud/hud/tokens";
import type { Provider, QuotaWindow, Snapshot } from "./types";
import "./style.css";
import openaiIcon from "./assets/openai-icon.svg";
import deepseekIcon from "./assets/deepseek.ico";

const messages: Record<string, string> = {
  not_configured: "未配置 DeepSeek API Key",
  decryption_unavailable: "无法解密凭据，请核对服务器运行账户",
  auth_required: "登录已失效或凭据不可用，请在服务器检查",
  permission_denied: "账户没有读取权限",
  network_error: "服务器连接官方接口失败",
  timeout: "读取超时",
  invalid_response: "接口数据无法识别",
  codex_not_found: "服务器未找到 Codex 程序",
  unsupported: "当前 Codex 版本不支持额度读取",
  read_failed: "读取失败",
};
function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未知";
}
function duration(minutes: number | null, slot: string) {
  if (minutes === null) return `${slot} 窗口`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}
function countdown(reset: string | null, now: number) {
  if (!reset) return "重置时间未知";
  const seconds = Math.ceil((Date.parse(reset) - now) / 1000);
  if (seconds <= 0) return "已到重置时间，等待重新读取";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days ? `${days}天 ` : ""}${hours}小时 ${mins}分 ${seconds % 60}秒后重置`;
}
function Status<T>({
  provider,
  disconnected,
  now,
}: {
  provider?: Provider<T>;
  disconnected: boolean;
  now: number;
}) {
  if (!provider)
    return (
      <p className="notice">
        {disconnected ? "无法连接服务器，请检查安全连接" : "正在读取…"}
      </p>
    );
  const stale =
    disconnected ||
    provider.status === "stale" ||
    (!!provider.updatedAt && now - Date.parse(provider.updatedAt) > 120000);
  return (
    <div className="provider-status" aria-live="polite">
      {(stale || provider.error) && (
        <p className="notice">
          {stale && provider.data ? "数据已过期 · " : ""}
          {disconnected
            ? "连接已中断"
            : (messages[provider.error ?? ""] ?? "等待更新")}
        </p>
      )}
      {provider.status === "loading" && <p className="muted">正在读取…</p>}
      <p className="muted">
        上次成功：
        {provider.updatedAt ? formatTime(provider.updatedAt) : "尚未获取"}
      </p>
    </div>
  );
}
function WindowRow({ value, now }: { value: QuotaWindow; now: number }) {
  const percent = value.remainingPercent;
  const tone =
    percent === null
      ? "unknown"
      : percent <= 10
        ? "critical"
        : percent <= 25
          ? "warning"
          : "ok";
  return (
    <div className={`quota-row ${tone}`}>
      <div className="row">
        <span>{duration(value.durationMinutes, value.slot)}</span>
        <strong>
          {percent === null ? "未知" : `${Number(percent.toFixed(1))}%`}
          <small> 剩余</small>
        </strong>
      </div>
      {percent !== null && (
        <div
          className="track"
          role="meter"
          aria-label={`${value.name} ${duration(value.durationMinutes, value.slot)}剩余额度`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="muted">
        {value.name} ·{" "}
        {percent === null
          ? "额度未知"
          : tone === "critical"
            ? "即将耗尽"
            : tone === "warning"
              ? "额度偏低"
              : "额度充足"}
      </p>
      <p>{countdown(value.resetsAt, now)}</p>
      <p className="muted">重置于 {formatTime(value.resetsAt)}</p>
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [settings, setSettings] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [nativeError, setNativeError] = useState("");
  const pending = useRef(false);
  const crossed = useRef(new Set<string>());
  const clockOffset = useRef(0);
  const palette = hudPalette({ light: true });

  async function refresh(manual = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      let value: Snapshot;
      if (isTauri())
        value = await invoke<Snapshot>("quota_snapshot", { refresh: manual });
      else {
        const response = await fetch(
          manual ? "/api/refresh" : "/api/snapshot",
          {
            method: manual ? "POST" : "GET",
            signal: AbortSignal.timeout(40000),
          },
        );
        if (!response.ok) throw new Error("connection");
        value = await response.json();
      }
      if (
        value.schemaVersion !== 1 ||
        !value.providers?.codex ||
        !value.providers?.deepseek ||
        !Number.isFinite(Date.parse(value.serverTime))
      )
        throw new Error("schema");
      clockOffset.current = Date.parse(value.serverTime) - Date.now();
      setSnapshot(value);
      setDisconnected(false);
    } catch {
      setDisconnected(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const clock = window.setInterval(
      () => setNow(Date.now() + clockOffset.current),
      1000,
    );
    // Poll cached state; only an explicit refresh asks the server to re-read.
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const hiddenPoll = window.setInterval(() => {
      if (document.hidden) void refresh();
    }, 120000);
    const resume = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      clearInterval(hiddenPoll);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);
  useEffect(() => {
    for (const window of snapshot?.providers.codex.data?.windows ?? []) {
      if (window.resetsAt && Date.parse(window.resetsAt) <= now) {
        const key = `${window.id}:${window.resetsAt}`;
        if (!crossed.current.has(key) && !pending.current) {
          crossed.current.add(key);
          void refresh(true);
        }
      }
    }
  }, [now, snapshot]);

  return (
    <main
      className="dynamic"
      style={
        {
          "--ok": palette.ok,
          "--warning": palette.warning,
          "--critical": palette.critical,
        } as React.CSSProperties
      }
    >
      <header data-tauri-drag-region>
        <div className="title" data-tauri-drag-region>
          <span className="brand" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span data-tauri-drag-region>
            Agent HUD <small>账户额度 · 实时概览</small>
          </span>
        </div>
        <div className="actions">
          <button
            className="refresh-button"
            disabled={busy}
            onClick={() => void refresh(true)}
          >
            <svg
              className={busy ? "refresh-icon spinning" : "refresh-icon"}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" />
            </svg>
            {busy ? "刷新中…" : "刷新"}
          </button>
          <button
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            设置
          </button>
          {isTauri() && (
            <button
              aria-label="收起到托盘"
              onClick={() => void getCurrentWindow().hide()}
            >
              −
            </button>
          )}
        </div>
      </header>
      {settings && (
        <aside>
          <p>通过安全隧道连接服务器。自动读取间隔 60 秒，失败后逐步退避。</p>
          {isTauri() && (
            <label>
              <input
                type="checkbox"
                checked={pinned}
                onChange={async (event) => {
                  const enabled = event.target.checked;
                  try {
                    await getCurrentWindow().setAlwaysOnTop(enabled);
                    setPinned(enabled);
                    setNativeError("");
                  } catch {
                    setNativeError("置顶设置失败");
                  }
                }}
              />
              窗口置顶
            </label>
          )}
          {nativeError && <p role="alert">{nativeError}</p>}
          <p className="muted">凭据和 Codex 登录仅保留在服务器。</p>
        </aside>
      )}
      <section aria-labelledby="codex-heading">
        <h2 id="codex-heading">
          <span className="provider-mark" aria-hidden="true">
            <img src={openaiIcon} alt="" />
          </span>
          Codex <small>账户额度</small>
        </h2>
        {snapshot?.providers.codex.data?.windows.map((value) => (
          <WindowRow key={value.id} value={value} now={now} />
        ))}
        {snapshot?.providers.codex.data?.windows.length === 0 && (
          <p className="muted">接口未返回额度窗口</p>
        )}
        {!snapshot?.providers.codex.data && (
          <p className="placeholder">额度：未获取</p>
        )}
        <Status
          provider={snapshot?.providers.codex}
          disconnected={disconnected}
          now={now}
        />
      </section>
      <section aria-labelledby="deepseek-heading">
        <h2 id="deepseek-heading">
          <span className="provider-mark deepseek" aria-hidden="true">
            <img src={deepseekIcon} alt="" />
          </span>
          DeepSeek <small>官方 API</small>
        </h2>
        {snapshot?.providers.deepseek.data?.balances.map((value, index) => (
          <div className="balance" key={`${value.currency}:${index}`}>
            <div className="row">
              <span>可用余额</span>
              <strong>
                {value.total ?? "未知"}{" "}
                <small>{value.currency ?? "币种未知"}</small>
              </strong>
            </div>
            <p>
              充值 {value.toppedUp ?? "未知"} · 赠送 {value.granted ?? "未知"}{" "}
              {value.currency}
            </p>
          </div>
        ))}
        {!snapshot?.providers.deepseek.data && (
          <p className="placeholder">余额：未获取</p>
        )}
        {snapshot?.providers.deepseek.data?.balances.length === 0 && (
          <p className="muted">接口未返回余额</p>
        )}
        <p className="muted">按量付费，无周期重置</p>
        <Status
          provider={snapshot?.providers.deepseek}
          disconnected={disconnected}
          now={now}
        />
      </section>
      <footer aria-live="polite">
        {disconnected
          ? "连接中断 · 请检查安全隧道"
          : snapshot
            ? "已连接服务器 · 自动刷新"
            : "正在连接服务器…"}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
