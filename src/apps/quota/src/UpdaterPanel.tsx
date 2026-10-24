import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

export function UpdaterPanel({
  expanded,
  onAvailabilityChange,
}: {
  expanded: boolean;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [version, setVersion] = useState("");
  const [available, setAvailable] = useState<Update | null>(null);
  const [phase, setPhase] = useState<
    | "idle"
    | "checking"
    | "latest"
    | "available"
    | "downloading"
    | "installing"
    | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const operation = useRef(false);
  const current = useRef<Update | null>(null);
  const mounted = useRef(true);

  async function checkUpdate() {
    if (!isTauri() || operation.current) return;
    operation.current = true;
    setPhase("checking");
    setMessage("");
    try {
      const update = await check({ timeout: 20000 });
      if (!mounted.current) {
        await update?.close();
        return;
      }
      const previous = current.current;
      current.current = update;
      setAvailable(update);
      onAvailabilityChange?.(!!update);
      setLastChecked(new Date());
      await previous?.close().catch(() => {});
      setPhase(update ? "available" : "latest");
    } catch {
      if (mounted.current) {
        setPhase("error");
        setMessage("暂时无法检查更新，请检查网络后重试。当前版本可继续使用。");
      }
    } finally {
      operation.current = false;
    }
  }

  async function installUpdate() {
    const update = current.current;
    if (!update || operation.current) return;
    operation.current = true;
    setPhase("downloading");
    setProgress(null);
    setMessage("");
    let total: number | undefined;
    let received = 0;
    try {
      // download() verifies the embedded public-key signature before resolving.
      await update.download(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength;
            received = 0;
          }
          if (event.event === "Progress") received += event.data.chunkLength;
          if (total)
            setProgress(Math.min(100, Math.round((received / total) * 100)));
        },
        { timeout: 180000 },
      );
      setPhase("installing");
      await update.install({ restartAfterInstall: true });
    } catch {
      if (mounted.current) {
        setPhase("error");
        setMessage(
          "更新未完成：网络、签名校验或安装失败。当前版本已保留，可重试。",
        );
      }
    } finally {
      operation.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (!isTauri()) return;
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("未知"));
    const initial = window.setTimeout(() => void checkUpdate(), 8000);
    const periodic = window.setInterval(
      () => void checkUpdate(),
      6 * 60 * 60 * 1000,
    );
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(periodic);
      if (!operation.current) void current.current?.close().catch(() => {});
    };
  }, []);

  const locked =
    phase === "checking" || phase === "downloading" || phase === "installing";
  return (
    <div
      className="updater-panel"
      hidden={
        !expanded &&
        !available &&
        phase !== "downloading" &&
        phase !== "installing"
      }
    >
      <div className="row">
        <div>
          <strong className="update-title">软件更新</strong>
          <p className="muted">
            当前版本{" "}
            {version ? `v${version}` : isTauri() ? "读取中…" : "网页预览"}
          </p>
        </div>
        <button
          disabled={!isTauri() || locked}
          onClick={() => void checkUpdate()}
        >
          {phase === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>
      {phase === "latest" && (
        <p className="update-message" role="status">
          已是最新版本
        </p>
      )}
      {lastChecked && (
        <p className="muted">
          上次检查{" "}
          {lastChecked.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}
      {available && (
        <div className="update-release">
          <p>
            发现新版本 <strong>v{available.version}</strong>
          </p>
          <p className="update-notes">
            {available.body || "体验优化与稳定性改进。"}
          </p>
          <p className="muted">更新后自动重启，保留现有连接配置。</p>
          <button
            className="refresh-button"
            disabled={locked}
            onClick={() => void installUpdate()}
          >
            {phase === "downloading"
              ? `下载并校验中${progress === null ? "…" : ` ${progress}%`}`
              : phase === "installing"
                ? "正在安装并重启…"
                : "下载更新并重启"}
          </button>
        </div>
      )}
      {phase === "downloading" && (
        <progress
          aria-label="更新下载进度"
          max={100}
          value={progress ?? undefined}
        />
      )}
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {!isTauri() && <p className="muted">请在桌面程序中检查和安装更新。</p>}
    </div>
  );
}
