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
npm run tauri dev
```

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

复制 `.env.example` 只能用于设置非敏感开发默认值。不要在 `.env` 中长期保存生产 API Key。M0-C 完成后，API Key 将从应用设置页写入 Windows Credential Manager。
