import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { codexLimits, deepseekBalance } from "./model.mjs";

async function codexExecutable() {
  if (process.env.AGENT_HUD_CODEX_EXE) return process.env.AGENT_HUD_CODEX_EXE;
  if (process.platform === "win32") {
    const root = path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "WindowsApps",
    );
    try {
      const folders = (await readdir(root))
        .filter((name) => name.startsWith("OpenAI.Codex_"))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const folder of folders) {
        const executable = path.join(
          root,
          folder,
          "app",
          "resources",
          "codex.exe",
        );
        try {
          await access(executable);
          return executable;
        } catch {
          /* Try the next installed version. */
        }
      }
    } catch {
      /* CLI installations can still resolve from PATH. */
    }
  }
  return "codex";
}

export async function readCodex() {
  const executable = await codexExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let done = false;
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => finish(new Error("timeout")), 30000);
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    }
    function send(value) {
      if (!done) child.stdin.write(`${JSON.stringify(value)}\n`);
    }
    child.once("error", () => finish(new Error("codex_not_found")));
    child.once("exit", () => finish(new Error("read_failed")));
    child.stdin.on("error", () => finish(new Error("read_failed")));
    lines.on("line", (line) => {
      if (line.length > 1024 * 1024)
        return finish(new Error("invalid_response"));
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (![1, 2].includes(message.id)) return;
      if (message.error) {
        const code = message.error.code;
        return finish(
          new Error(code === -32601 ? "unsupported" : "auth_required"),
        );
      }
      if (!("result" in message)) return;
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read", params: {} });
      } else {
        if (
          !message.result ||
          !(
            "rateLimits" in message.result ||
            "rateLimitsByLimitId" in message.result
          )
        )
          return finish(new Error("invalid_response"));
        finish(null, codexLimits(message.result));
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "agent_hud_quota",
          title: "Agent HUD Quota",
          version: "0.1.0",
        },
      },
    });
  });
}

// DPAPI decryption stays in a child process and its private stdout pipe.
// There is no plaintext key in argv, environment, logs, or renderer state.
export function loadDeepseekKey() {
  if (process.platform !== "win32") throw new Error("decryption_unavailable");
  return new Promise((resolve, reject) => {
    const script = String.raw`$ErrorActionPreference='Stop'; $p='C:\Users\Wintools\credentials\agent-hud-deepseek.dpapi'; if(!(Test-Path -LiteralPath $p)){exit 3}; try {$s=Get-Content -Raw -LiteralPath $p | ConvertTo-SecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}} catch {exit 4}`;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let result = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("decryption_unavailable"));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      result += chunk;
      if (result.length > 16384) child.kill();
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("decryption_unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 3) reject(new Error("not_configured"));
      else if (
        code !== 0 ||
        !result ||
        /[\r\n\0]/.test(result) ||
        result.length > 16384
      )
        reject(new Error("decryption_unavailable"));
      else resolve(result);
      result = "";
    });
  });
}

export async function readDeepseek() {
  const key = await loadDeepseekKey();
  let response;
  try {
    response = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new Error("network_error");
  }
  if (response.status === 401) throw new Error("auth_required");
  if (response.status === 403) throw new Error("permission_denied");
  if (!response.ok) throw new Error("read_failed");
  try {
    return deepseekBalance(await response.json());
  } catch {
    throw new Error("invalid_response");
  }
}
