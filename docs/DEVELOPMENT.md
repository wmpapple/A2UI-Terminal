# 开发指南

## 固定环境

- Node.js 22 LTS，见 `.nvmrc`
- npm 10 或 11
- Rust stable + rustfmt + clippy，见 `rust-toolchain.toml`
- Windows C++ Build Tools 与 Windows SDK

本机 Node 24 可用于辅助开发，但正式验证与 CI 使用 Node 22。

## 安装与启动

```bash
npm ci
npm run dev
```

```powershell
npm run desktop:dev
```

`desktop:dev` 优先使用 `D:\A2UI\.tooling` 中的隔离 Rust；不存在时使用系统 PATH。

## 测试命令

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
```

首次运行 Playwright：

```bash
npm run test:e2e:install
npm run test:e2e
```

Rust/Tauri：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
npm run tauri build
```

关键纯逻辑模块的 statements、branches、functions、lines 覆盖率门槛均为 70%。Playwright 只测试 Web Mock，确保 CI 不访问开发者真实文件或凭据。

## 数据与安全边界

- Web Mock 不调用 Tauri IPC、文件系统或真实 Provider。
- Desktop 真实文件访问必须来自系统选择器授予的工作区/文件，Rust 会再次规范化路径。
- API Key 只能通过设置页写入 Windows Credential Manager。
- 文件 Patch 必须先过 Rust 校验和 Diff 审阅；A2UI 只渲染固定 Catalog。
- `.env`、`.key`、`.pem`、`.pfx`、数据库、诊断文件和构建产物不得提交。

## 发布开发

内部安装包可执行：

```powershell
npm run tauri build
./scripts/verify-release.ps1
./scripts/smoke-desktop.ps1 -BinaryPath ./src-tauri/target/release/a2ui-terminal.exe
```

不要在本地伪造或提交 `src-tauri/tauri.release.conf.json`；它由正式 GitHub Actions 使用 environment variables/secrets 临时生成。正式版本流程见 [RELEASE.md](RELEASE.md)。

## 提交要求

- 保留用户工作区中的无关修改，不使用破坏性 Git 重置。
- TypeScript 新代码保持严格类型，UI 文案同时加入中英文资源。
- 新 Tauri command 必须同时注册到 `build.rs`、`lib.rs`、Capability，并扩展命令注册测试。
- 新高风险动作必须由 Rust 默认拒绝或显式确认，并具有测试和审计记录。
