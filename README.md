# A2UI Terminal

A2UI Terminal 是一个 Windows 优先、本地数据优先、文件修改必须审阅的 AI 工作台。桌面版支持真实工作区、显式上下文、持久化多会话、多个 AI Provider、语义 Patch、Diff、应用与撤销，以及受限 A2UI Runtime；Web 版只运行确定性 Mock，不访问真实文件、系统凭据或 Provider。

## 已实现能力

- 三栏工作台：文件树、编辑器/审阅/Surface、AI 助手。
- Markdown、TXT、JSON、TS/JS、Python、YAML 等常见文本文件的受控读取与保存。
- SiliconFlow、DeepSeek、OpenAI 和自定义 OpenAI-Compatible Endpoint。
- API Key 只存入 Windows Credential Manager；Endpoint、Model、Temperature 和代理可配置。
- 真实文件 → 显式上下文 → AI 语义 Patch → Diff → 应用 → 版本 → 撤销。
- A2UI Protocol V1、13 个白名单组件、严格 Schema、低风险 Action 和 Inspector。
- 会话永久保留、文档版本保留 30 天、崩溃草稿恢复、工作区级历史删除。
- 中英文界面、脱敏诊断导出、一键清除所有本地数据。
- Windows NSIS/MSI、GitHub Actions CI、签名发布和 Tauri 自动更新链路。

## 技术栈

- React 19、TypeScript、Vite 8、Ant Design 6、Zustand 5
- Vitest、Testing Library、Playwright
- Tauri 2、Rust、SQLite、Windows Credential Manager
- GitHub Actions、Tauri updater、Windows Authenticode

## 环境要求

- Node.js 22 LTS
- npm 10 或 11
- Rust stable（桌面端开发需要）
- Visual Studio Build Tools：使用 C++ 的桌面开发 + Windows SDK
- Windows 10 22H2 或 Windows 11

## 本地开发

```bash
npm ci
npm run dev
```

桌面端会优先使用工作区同级 `.tooling` 中的隔离 Rust：

```powershell
npm run desktop:dev
```

完整本地验证：

```bash
npm run check
npm run test:coverage
npm run test:e2e:install
npm run test:e2e
```

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

Web 模式只使用 Mock 数据，不会读取或写入本地文件。

## 安全与发布

- AI 不拥有文件写入能力；文件变化只能经 Rust 校验和用户确认后的 Diff 应用。
- 不得将 API Key、PFX、证书密码或 updater 私钥写入仓库、`.env` 或构建日志。
- 内部工作流只生成未签名验收包；正式 `v*` 标签必须通过受保护的 production environment 和签名门禁。
- 自动更新始终校验 Tauri updater 签名；签名不可关闭。
- 仓库历史曾跟踪 `.env`，其中使用过的真实 Key 必须轮换。

## 阶段状态

| 阶段 | 状态     | 目标                                   |
| ---- | -------- | -------------------------------------- |
| 1–3  | 已通过   | 工程治理、TypeScript、Tauri 2 与持久化 |
| 4–6  | 已通过   | 真实工作区、Provider、Patch/Diff/撤销  |
| 7    | 已通过   | A2UI Runtime、Schema、权限和 Inspector |
| 8    | 等待验收 | CI、E2E、诊断、签名发布与自动更新      |

阶段 8 未通过前不会进入后续阶段或正式发布。

## 文档

- [实施计划](docs/IMPLEMENTATION_PLAN.md)
- [架构说明](docs/ARCHITECTURE.md)
- [桌面端架构与安全边界](docs/DESKTOP_ARCHITECTURE.md)
- [开发指南](docs/DEVELOPMENT.md)
- [Windows 构建、签名与自动更新](docs/RELEASE.md)
- [隐私与本地数据](docs/PRIVACY.md)
- [A2UI Protocol V1](docs/A2UI_PROTOCOL_V1.md)
- [阶段 8 验收说明](docs/PHASE_8_VALIDATION.md)
- [安全响应说明](docs/SECURITY_RESPONSE.md)

## 许可证

当前尚未指定开源许可证，正式开放源码前需要完成许可证决策。
