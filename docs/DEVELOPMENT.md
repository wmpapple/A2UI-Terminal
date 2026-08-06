# 开发环境说明

## 固定版本

- Node.js：22 LTS，见 `.nvmrc`
- npm：10 或 11
- Rust：stable，包含 rustfmt 与 clippy，见 `rust-toolchain.toml`

推荐使用 Node 22 执行正式验证。Node 24 可用于辅助开发，但不作为 CI 基线。

## 安装

```bash
npm ci
```

桌面端还需安装 Rust 和 Windows C++ Build Tools。安装后验证：

```bash
rustc --version
cargo --version
```

## 常用命令

```bash
npm run dev
npm run check
npm run desktop:dev
```

`desktop:dev` 优先使用项目工作区同级 `.tooling` 中的隔离 Rust；若不存在，则使用系统 PATH 中的 Cargo。

## 提交前检查

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Rust/Tauri 代码变化还需要：

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 本地配置

复制 `.env.example` 只能用于设置非敏感开发默认值。不要在 `.env` 中保存 API Key。API Key 只能通过桌面 IPC 写入 Windows Credential Manager；阶段 5 接入设置页，当前阶段仅提供受限的凭据服务边界。

## 桌面端验证

```bash
npm run tauri dev
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

Windows 桌面编译还需要 Visual Studio Build Tools 的“使用 C++ 的桌面开发”工作负载和 Windows SDK。缺少 MSVC `link.exe` 时，rustfmt 仍可运行，但 Clippy、Rust 测试和 Tauri 构建会在链接阶段失败。

Tauri 2 的 `Cargo.lock` 已由 Rust 1.97.1 重新生成，应随阶段 3 代码一并提交。
