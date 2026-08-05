# A2UI Terminal

A2UI Terminal 是一个面向科研人员、开发者和高级知识工作者的本地优先 AI 工作台。产品核心是让用户在明确选择上下文后，审阅 AI 生成的修改，再安全地写入真实项目文件。

当前仓库处于从演示原型迁移到 V1.0 MVP 的阶段。现有版本保留了 React 对话、Markdown 编辑、流式响应和受限组件渲染原型；真实文件工作区、Diff、版本历史、Provider 配置和 A2UI Runtime 将按照 [实施计划](docs/IMPLEMENTATION_PLAN.md) 分阶段完成。

## 当前技术栈

- React 19
- Vite 8
- Ant Design 6
- Zustand 5
- md-editor-rt
- Tauri 1.6 / Rust（将在 M0-C 升级到 Tauri 2）

## 环境要求

- Node.js 22 LTS
- npm 10 或 11
- Rust stable（桌面端开发需要）
- Windows 10 22H2 或 Windows 11（主要目标平台）

当前机器如果没有 Rust，可先运行 Web 原型；Tauri 构建需要先安装 Rust 工具链及 Windows C++ 构建工具。

## 本地开发

```bash
npm ci
npm run dev
```

运行桌面端：

```bash
npm run tauri dev
```

执行质量检查：

```bash
npm run check
```

也可以分别运行：

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## 安全说明

- 不要把 API Key、证书或签名私钥写入仓库。
- `.env` 只允许作为本地临时开发手段；生产版本将使用 Windows Credential Manager。
- `.env.example` 只能保存非敏感配置示例。
- 当前历史中曾跟踪过 `.env`。如果其中使用过真实 Key，应立即轮换。是否重写远端 Git 历史需要单独评估和授权。
- AI 生成的文件修改在 M1 完成后必须经过 Patch 校验和 Diff 审阅，禁止静默覆盖。

## 项目状态

| 阶段 | 状态     | 目标                                           |
| ---- | -------- | ---------------------------------------------- |
| M0-A | 等待验收 | 仓库、安全与工具链治理                         |
| M0-B | 未开始   | TypeScript、模块化与三栏 Web Mock              |
| M0-C | 未开始   | Tauri 2、最小权限和 SQLite 骨架                |
| M1   | 未开始   | 真实文件 → 上下文 → Patch → Diff → 应用 → 撤销 |

每个阶段都需要独立验收，未确认前不进入下一阶段。

## 相关文档

- [实施计划](docs/IMPLEMENTATION_PLAN.md)
- [安全响应说明](docs/SECURITY_RESPONSE.md)
- [开发环境说明](docs/DEVELOPMENT.md)

## 许可证

当前仓库尚未指定开源许可证。在正式发布或开放源码前必须补充许可证决策。
