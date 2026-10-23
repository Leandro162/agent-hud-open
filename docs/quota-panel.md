# 个人额度面板（独立入口）

部署目标已确认：服务器读取、本地 Windows 11 显示。原版 Agent HUD 入口保留。

## 数据与边界

- 服务器 Node.js 24+ 仅运行 `src/apps/quota/server/main.mjs`，仅监听 `127.0.0.1:17843`。
- Codex 使用当前服务器 Windows 用户的既有登录，启动短生命周期 `codex app-server --listen stdio://`，仅发送 initialize、initialized、account/rateLimits/read。不创建线程、不发送模型任务。
- 自动发现 Windows Codex Desktop 安装位置；可用非秘密环境变量 `AGENT_HUD_CODEX_EXE` 指定程序。`CODEX_HOME` 保持 CLI 原有行为。
- DeepSeek 仅 GET 官方 `/user/balance`，保留原币种和十进制字符串，不计算百分比、周期或倒计时。
- 接口只返回经过筛选的额度/余额和固定错误码，不返回账号标识、令牌、原始错误或会话。
- 每个提供方独立刷新、合并并发请求；默认 60 秒，失败指数退避至 15 分钟；手动刷新最短间隔 5 秒。缓存只在内存，服务重启显示未获取。
- 刷新失败保留上次成功值及时间；失联或超过 120 秒标注过期；未知不写成零。归零重新读取，不假设额度恢复。

## 服务器启动

```powershell
cd C:\Users\Wintools\agent-hud-open
node src/apps/quota/server/main.mjs
```

该进程必须在持有 Codex 登录和 DPAPI 凭据的 Windows 用户下运行。首次联通测试后再配置该用户的登录启动任务，不能改为 SYSTEM 账户。

没有 DeepSeek Key 时会独立显示未配置。配置时先检查 `C:\Users\Wintools\credentials\index.json` 及适用凭据管理器；已有适用凭据应先只读验证，不要重复索取。新增凭据可交互运行：

```powershell
powershell -NoProfile -File src/apps/quota/scripts/Save-DeepseekCredential.ps1
```

脚本隐藏输入、DPAPI CurrentUser 加密并回读比较、仅查询余额验证、合并非秘密索引。密文路径为 `C:\Users\Wintools\credentials\agent-hud-deepseek.dpapi`。DPAPI 绑定服务器当前 Windows 用户/电脑，不能复制到本地直接用。脚本尚未使用真实 Key 验证。

## 安全连接

首选实现使用 OpenSSH 本地端口转发：本地 `127.0.0.1:17843` → SSH → 服务器 `127.0.0.1:17843`。没有公网额度端口，不直接暴露 Codex app-server。SSH 只承载连接，面板不提供远程操作。

本地需已配置 OpenSSH alias、密钥登录和经过验证的 host key。推荐服务器使用专门的转发账户，并在 sshd/authorized_keys 中限定 `permitopen="127.0.0.1:17843"`、禁用 PTY/agent/X11 转发。没有实际 SSH 条件前，不自动安装 sshd、修改防火墙或宣称已联通。

```powershell
powershell -NoProfile -File .\Start-LocalTunnel.ps1 -SshAlias quota-server
```

脚本使用 StrictHostKeyChecking 和 BatchMode，失败明确退出。隧道需要持续运行；正式后台启动可使用隐藏窗口，但首次主机密钥核验需要交互。休眠/断网后隧道退出应重启；面板继续显示旧值和失联状态。

## 本地面板

独立 React + Tauri 2 应用，Rust 入口不依赖上游 Runtime，因此不会启用会话、hooks、审批或远程服务。本地原生端仅访问固定的回环隧道端点，禁用 HTTP 代理和重定向，不保存账号凭据。

- Simple 和 Dynamic 随时切换并记住模式；复用原仓库 HUD 色彩 token。
- 核心数字一直可见，窗口按服务实际数据生成。
- Dynamic 仅图标轻微呼吸和悬停位移，尊重系统减少动态效果设置。
- 手动刷新、自动更新、托盘显示/隐藏和退出、窗口置顶。
- 标准窗口标题栏拖动；开机启动尚未提供界面设置，可在完成本地验证后配置启动快捷方式。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @agent-hud/quota typecheck
pnpm --filter @agent-hud/quota test
pnpm --filter @agent-hud/quota build
pnpm --filter @agent-hud/quota tauri build
```

Windows 构建需要 Rust MSVC 和 Visual Studio C++ Build Tools。独立 Cargo workspace 隔离原版依赖。GitHub Actions `Quota Windows` 支持手动运行并上传 NSIS 安装程序；只有工作流成功并完成 Windows 11 本机安装、托盘、DPI、多屏、休眠与真实数据验证后才可称为可交付安装包。

官方协议参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[DeepSeek Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)。
