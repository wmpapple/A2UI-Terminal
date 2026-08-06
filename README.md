# A2UI Terminal

A2UI Terminal 是一个本地优先、修改可审阅的 AI 工作台。Web 版本提供严格 TypeScript 的三栏 Mock 工作台；桌面版本已经支持受控打开真实工作区、文本文件编辑、Hash 冲突保护和崩溃草稿恢复。模型 Provider 与显式上下文将在下一阶段接入。

## 当前技术栈

- React 19 + TypeScript
- Vite 8
- Ant Design 6
- Zustand 5
- md-editor-rt
- Vitest + Testing Library
- Tauri 2 / Rust / SQLite

## 环境要求

- Node.js 22 LTS
- npm 10 或 11
- Rust stable（桌面端开发需要）
- Windows 10 22H2 或 Windows 11

## 本地开发

```bash
npm ci
npm run dev
```

桌面端（会优先使用工作区同级 `.tooling` 中的隔离 Rust）：

```powershell
npm run desktop:dev
```

质量检查：

```bash
npm run check
```

当前 Web 模式只使用 Mock 数据，不会读取或写入本地文件。

## 安全说明

- 不得将 API Key、证书或签名私钥写入仓库。
- `.env.example` 只能保存非敏感配置示例。
- 仓库历史曾跟踪 `.env`；其中使用过的真实 Key 必须轮换。
- AI 文件修改最终必须经过 Patch 校验和 Diff 审阅。

## 项目状态

| 阶段 | 状态     | 目标                                       |
| ---- | -------- | ------------------------------------------ |
| M0-A | 已通过   | 仓库、安全与工具链治理                     |
| M0-B | 已通过   | TypeScript、模块化与三栏 Web Mock          |
| M0-C | 已通过   | Tauri 2、最小权限和 SQLite 骨架            |
| M1-A | 等待验收 | 真实工作区、文件树、多 Tab、保存与冲突保护 |
| M1-B | 未开始   | Provider、会话与显式上下文                 |
| M1-C | 未开始   | Patch → Diff → 应用 → 撤销                 |

每个阶段都需要独立验收，未确认前不进入下一阶段。

## 文档

- [实施计划](docs/IMPLEMENTATION_PLAN.md)
- [前端架构](docs/ARCHITECTURE.md)
- [桌面端架构与安全边界](docs/DESKTOP_ARCHITECTURE.md)
- [Windows 构建、签名与更新](docs/RELEASE.md)
- [阶段 4 验收记录](docs/PHASE_4_VALIDATION.md)
- [安全响应说明](docs/SECURITY_RESPONSE.md)
- [开发环境说明](docs/DEVELOPMENT.md)

## 许可证

当前尚未指定开源许可证，正式发布或开放源码前需完成许可证决策。
