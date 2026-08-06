# A2UI Terminal V1.0 实施计划

> 状态：阶段 4 已完成，等待产品负责人验收
> 基线日期：2026-08-05  
> 依据：`A2UI_Terminal_V1.0_PRD_and_Prototype.docx` 与当前仓库审计结果

## 1. 实施原则

1. 先完成 M0 工程治理，再进入 M1 业务闭环。
2. 保留现有可用能力：多会话、流式输出、停止生成、Markdown 编辑及受限组件渲染思路。
3. 允许重构目录、状态与通信边界，不继续扩展现有 610 行 `ChatPanel.jsx`。
4. AI 不能直接覆盖文件。所有文件修改必须经过结构化 Patch、Diff 审阅和用户确认。
5. 每个阶段完成后停止实施，提交验证结果，只有产品负责人明确确认后才进入下一阶段。
6. 密钥、签名私钥、更新私钥不得进入源码、构建日志或前端存储。

## 2. 已确认范围

### 产品与平台

- Windows 优先的 Tauri 2 桌面应用。
- Web 版本仅展示 Mock 数据，不访问真实文件系统和系统凭据。
- UI 按 PRD 原型改为三栏工作台：文件树、编辑器、AI 助手；Diff 作为可切换审阅视图。
- 支持中英文界面。

### M1 首条业务闭环

打开真实工作区 → 选择文本文件 → 明确选择上下文 → AI 返回语义块 Patch → Diff 审阅 → 应用文件 → 创建版本 → 撤销。

支持的首批文本类型：Markdown、TXT、JSON、TypeScript、JavaScript、Python、YAML/YML。二进制文件、超限文件和工作区外路径必须拒绝。

### Provider

- SiliconFlow
- DeepSeek 官方
- OpenAI 官方
- 自定义 OpenAI-Compatible Endpoint
- 可配置 Endpoint、Model、Temperature、代理地址
- API Key 存入 Windows Credential Manager；前端只能读取“是否已配置”状态

### 数据生命周期

- 会话永久保留，除非用户删除工作区或执行清除操作。
- 消息保存完整正文。
- 文档版本保留 30 天，由定期清理任务处理。
- 删除工作区时同步删除该工作区的数据库历史；真实项目文件不随之删除。
- 提供“一键清除所有本地数据”，执行前必须二次确认并明确保留/不保留真实项目文件。

### A2UI Basic Catalog 首批范围

- 布局：Row、Column、Stack
- 展示：Text、Card、Badge、Progress
- 输入：TextField、Select、Checkbox
- 交互：Button、Tabs、Form

A2UI Runtime、Schema、权限基础设施在 M1 之后单独验收，不与首条文件修改闭环混做。

## 3. 当前仓库基线

| 项目   | 当前状态                            | 目标状态                                    |
| ------ | ----------------------------------- | ------------------------------------------- |
| 前端   | React 19 + JavaScript + Vite        | React 19 + TypeScript + Vite                |
| 桌面端 | Tauri 1.6，`api-all`                | Tauri 2，Capabilities 最小权限              |
| 状态   | Zustand + localStorage 保存业务数据 | Zustand 仅保存 UI 状态，SQLite 保存业务数据 |
| AI     | SiliconFlow/DeepSeek 写死           | Provider 适配器与可配置连接                 |
| 密钥   | `.env`，且曾被 Git 跟踪             | Windows Credential Manager，仓库不保存密钥  |
| 工作区 | 单段内存文档                        | 授权目录、文件树、多 Tab、受控读写          |
| 修改   | 替换/追加/光标插入                  | 语义 Patch、Diff、冲突检测、版本与撤销      |
| A2UI   | 自定义 JSON + 宽松正则              | 带版本 Schema、Catalog 白名单、明确错误     |
| 测试   | 无有效测试基线                      | unit/component/E2E + Rust test              |
| CI/CD  | 旧版跨平台 release                  | Windows CI、签名构建、更新产物              |

已知环境限制：当前机器有 Node.js 24/npm 11，但没有可用的 Rust/Cargo。Rust 编译在安装工具链后本地验证，并从第一阶段起在 GitHub Actions 中强制验证。

## 4. 分阶段计划与验证门槛

## 阶段 0：计划确认

### 交付物

- 本实施计划。
- 当前代码与 PRD 差距说明。
- 阶段边界、数据约束和验收规则。

### 验收门槛

- 产品负责人确认本计划，或列出需要调整的条目。
- 未确认前不继续代码实施。

---

## 阶段 1：M0-A 仓库与安全治理

### 实施内容

- 删除误提交的 npm 缓存与备份源码目录。
- 从版本控制中移除 `.env`，加入 `.env*`、缓存、构建产物、数据库和密钥文件忽略规则，同时保留无密钥的 `.env.example`。
- 检查 Git 历史中的密钥风险，输出轮换提醒；不擅自修改远端历史。
- 修复 README 和源码中的乱码、默认项目名与无效模板资源。
- 固定 Node/npm/Rust 版本策略，增加 `.editorconfig` 与统一格式化配置。
- 清理 package scripts，建立 `lint`、`typecheck`、`test`、`test:e2e`、`build`、`check` 命令。

### 保留行为

- 原型在本阶段结束时仍能以 Web Mock 模式启动。
- 不修改真实用户文件，不接入真实 API Key。

### 验收门槛

- 仓库不再跟踪缓存、备份和 `.env`。
- Secret 扫描无当前有效密钥命中。
- `npm ci`、lint、基础 build 可运行。
- 提交变更清单及风险说明，等待负责人确认。

---

## 阶段 2：M0-B TypeScript 与前端模块化

### 目标目录

```text
src/
├── app/                 # 应用壳、错误边界、主题、i18n
├── features/
│   ├── workspace/       # 文件树、Tab、编辑器
│   ├── chat/            # 会话、输入、流式展示
│   ├── context/         # 上下文选择与敏感提示
│   ├── diff/            # Patch 与审阅
│   ├── a2ui/            # 协议、Catalog、Runtime
│   └── settings/        # Provider、安全、数据管理
├── stores/              # 仅 UI 临时状态
└── shared/              # 类型、组件、工具与平台适配
```

### 实施内容

- 将 JSX/JS 迁移为严格 TypeScript。
- 拆分 ChatPanel 的通信、解析、会话状态与展示职责。
- 静态样式迁移到 CSS Modules/Design Tokens，减少行内样式。
- 建立桌面/浏览器平台适配接口；Web 使用确定性 Mock。
- 建立中英文资源与语言切换。
- 建立错误边界、Toast 规范、空状态和可访问性基础。

### 验收门槛

- `tsc --noEmit`、ESLint、单元测试、生产 build 全部通过。
- 关键业务组件建议不超过 250 行。
- Web Mock 可演示三栏工作台与保留的聊天/编辑功能。
- 产品负责人验证 UI 方向后才进入 Tauri 迁移。

---

## 阶段 3：M0-C Tauri 2、安全边界与持久化骨架

### Rust 目标目录

```text
src-tauri/src/
├── commands/
├── ai/
├── workspace/
├── storage/
├── security/
├── a2ui/
└── error.rs
```

### 实施内容

- 升级 Tauri 2，移除 `api-all`。
- 配置最小 Capabilities 与严格 CSP。
- 建立规范化路径和工作区授权边界。
- 引入 SQLite 迁移框架和 PRD 核心表。
- 建立 Windows Credential Manager 凭据服务抽象。
- 建立统一错误码、脱敏日志和审计结构。
- Rust Command 仅返回必要数据，不向前端暴露密钥与任意路径访问。

### 验收门槛

- CI 中 `cargo fmt --check`、`cargo clippy`、`cargo test`、Tauri build 通过。
- 配置中不存在 allow-all；CSP 不允许任意远程脚本。
- 路径穿越、工作区越权和密钥读取用例通过。
- 数据库迁移可重复执行。
- 产品负责人验证桌面安装包能启动后才进入 M1。

---

## 阶段 4：M1-A 真实工作区与编辑器

### 实施内容

- 目录选择、最近项目、文件树和授权恢复。
- 支持约定的文本扩展名、忽略规则、文件大小限制和 UTF-8 检测。
- 多文件 Tab、脏状态、1 秒自动保存与崩溃草稿恢复。
- 保存前计算内容 Hash，防止覆盖外部变更。
- 删除工作区记录不删除磁盘项目文件。

### 验收门槛

- 可打开包含 1,000 个文本文件的测试项目。
- 切换 Tab 不丢内容，越权路径被拒绝。
- 外部修改冲突不会被静默覆盖。
- 产品负责人完成真实目录操作验收。

---

## 阶段 5：M1-B Provider、会话与显式上下文

### 实施内容

- Provider 统一接口及 SiliconFlow、DeepSeek、OpenAI、自定义兼容端点实现。
- Endpoint、Model、Temperature、代理和连接测试设置。
- API Key 写入系统凭据库；配置表仅保存 `secret_ref`。
- 每工作区多会话、流式响应、停止、重试和错误状态。
- 上下文选择器支持选区、当前文件、选定项目文件、最近对话。
- 请求前显示来源、字符数/Token 估算、敏感信息提示和最终发送清单。
- 默认排除 `.env`、证书、私钥和 `secrets/**`。

### 验收门槛

- 未勾选内容不会进入请求快照。
- Key 不出现在 SQLite、localStorage、日志、诊断包和前端响应。
- 停止请求后 500ms 内停止 UI 更新。
- 三类官方 Provider 与自定义 Endpoint 均有适配测试；真实联网验证由负责人提供测试 Key 后执行。

---

## 阶段 6：M1-C 语义 Patch、Diff、应用与撤销

### Patch V1 草案

```json
{
  "version": "1.0",
  "type": "document_patch",
  "workspaceId": "workspace-id",
  "baseRevision": "sha256",
  "summary": "修改说明",
  "changes": [
    {
      "id": "change-id",
      "path": "src/example.ts",
      "operation": "replace",
      "anchor": {
        "before": "唯一的原始文本",
        "beforeHash": "sha256"
      },
      "content": "替换后的文本",
      "reason": "修改理由",
      "risk": "medium"
    }
  ]
}
```

最终 Schema 会补充新增文件、删除保护、大小/数量限制和版本兼容字段。前端只展示经过 Rust/Schema 校验的 Patch。

### 实施内容

- 结构化输出校验；失败时重试或降级为普通文本。
- 将语义块转换为确定性文本修改。
- 按块接受/拒绝、接受已选、全部拒绝。
- 应用前校验工作区、路径、基础 Hash 和锚点唯一性。
- 文件已变化时禁止直接应用并进入冲突提示。
- 事务式保存修改前后版本、会话和摘要。
- 撤销通过新版本恢复，不破坏历史链。
- 自动清理超过 30 天的版本。

### 验收门槛

- 不存在绕过 Diff 的 AI 写文件路径。
- 拒绝 Patch 后文件无变化。
- 应用后立即创建版本且可撤销。
- 冲突、越权、重复锚点、非法 Schema 测试通过。
- 10 个端到端典型任务全部通过后，第一条 M1 闭环完成。

---

## 阶段 7：A2UI Runtime 基础与 Inspector 前置

### 实施内容

- 定义协议版本、Surface、组件树、数据模型与增量更新 Schema。
- 注册首批 13 个白名单组件。
- Props 限制深度、大小和类型；未知组件安全拒绝。
- Action 先只支持低风险 UI 状态和表单事件；文件类 Action 复用 Diff 审阅。
- 建立 Inspector 所需的原始消息、校验结果、组件树和事件记录。

### 验收门槛

- 未知组件、非法 Props 和超限消息均被拒绝并显示可理解错误。
- Runtime 不执行 HTML、Script、iframe、动态 npm 组件或系统命令。
- 增量更新不会重建无关 Surface。

## 5. 测试策略

| 层级                | 建议工具                       | 重点                                         |
| ------------------- | ------------------------------ | -------------------------------------------- |
| TypeScript 单元测试 | Vitest                         | Patch、上下文、脱敏、状态转换、i18n          |
| React 组件测试      | Testing Library                | 文件树、上下文选择、Diff、确认流程、键盘操作 |
| Web E2E             | Playwright                     | Mock 模式完整闭环                            |
| Rust 单元/集成测试  | Cargo test                     | 路径安全、数据库迁移、Patch 应用、凭据接口   |
| Tauri E2E/冒烟      | Windows CI + 安装包脚本        | 启动、文件授权、写入、恢复、卸载策略         |
| 安全检查            | Secret scan + dependency audit | 密钥、依赖、Capabilities、CSP                |

核心模块覆盖率目标为 70%，但以关键安全分支和真实闭环通过为最终门槛。

## 6. CI、打包、签名和自动更新

### Pull Request CI

- npm clean install
- format check
- lint
- typecheck
- unit/component tests + coverage
- production web build
- Rust fmt/clippy/test
- Tauri Windows build
- Secret scan

### Windows 发布

- 以 tag 触发 Windows 安装包构建。
- 使用 GitHub Secrets 注入代码签名证书及密码。
- 使用 Tauri 更新签名私钥生成更新签名，私钥只存在于 Secrets。
- 发布安装包、校验信息和更新清单。
- 首次搭建阶段允许生成未签名测试包；正式发布必须通过签名验证门槛。

## 7. 需要产品负责人后续提供的外部条件

这些条件不阻塞前期 M0，但会阻塞对应阶段最终验收：

1. 可用于联调的 SiliconFlow、DeepSeek、OpenAI 测试账号或 Key；Key 只通过本机设置页录入。
2. Windows 代码签名证书（PFX/硬件证书/云签名方案）与发行主体信息。
3. 自动更新托管位置，默认建议 GitHub Releases。
4. 安装包展示信息：正式产品名、Publisher、版本号规则、官网、隐私政策 URL。
5. 是否需要兼容 Windows 10；默认基线建议 Windows 10 22H2 与 Windows 11。

## 8. 风险与控制

- **仓库曾跟踪 `.env`**：删除文件不能清除 Git 历史，若其中出现过真实 Key，必须轮换；是否重写远端历史需单独授权。
- **本地工具链隔离**：Rust 安装在 `D:\A2UI\.tooling` 且未修改系统 PATH；正式验证继续以 Windows CI 的 stable 工具链为基线。
- **Node 24 兼容性**：发布与 CI 建议固定 Node 22 LTS，本机可继续使用 Node 24 做补充验证。
- **模型输出不稳定**：严格 Schema + 重试 + 文本降级，禁止使用正则猜测 Patch。
- **外部文件变化**：Hash 与锚点双重检查，冲突时不写入。
- **签名与更新依赖外部证书**：先完成配置框架，最终发布验收等待证书材料。

## 9. 审批记录

| 检查点                               | 状态     | 负责人意见 |
| ------------------------------------ | -------- | ---------- |
| 阶段 0：实施计划                     | 已通过   |            |
| 阶段 1：M0-A 仓库与安全治理          | 已通过   |            |
| 阶段 2：M0-B TypeScript 与前端模块化 | 已通过   |            |
| 阶段 3：M0-C Tauri 2 与安全持久化    | 已通过   |            |
| 阶段 4：M1-A 工作区与编辑器          | 等待验收 |            |
| 阶段 5：M1-B Provider 与上下文       | 未开始   |            |
| 阶段 6：M1-C Patch/Diff/撤销         | 未开始   |            |
| 阶段 7：A2UI Runtime 基础            | 未开始   |            |

当前阶段 4 已完成并等待验收。只有产品负责人明确确认后，才执行“阶段 5：M1-B Provider、会话与显式上下文”。
