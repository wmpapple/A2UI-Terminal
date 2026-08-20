# V1 前后端合同 Fixture

本文记录 S0.2 固化的 Rust ↔ TypeScript JSON 合同。共享 fixture 位于 `contracts/v1/`，由 Rust 集成测试和 TypeScript Vitest 直接读取同一文件。

## 固化范围

| 领域      | Fixture          | 代表合同                                             |
| --------- | ---------------- | ---------------------------------------------------- |
| Workspace | `workspace.json` | `WorkspaceDocument`                                  |
| Chat      | `chat.json`      | `ChatSession`、`ChatStreamEvent`、`ChatStreamResult` |
| Patch     | `patch.json`     | `DocumentPatch`、`PatchReview`、`PatchApplication`   |
| A2UI      | `a2ui.json`      | `a2ui_surface` 协议和 `A2uiProcessResult`            |
| Revision  | `revision.json`  | `DocumentVersionSummary`、`DocumentVersion`          |
| Error     | `error.json`     | 稳定错误码、公开消息、重试和 HTTP 元数据             |

V2 增量合同位于 `contracts/v2/`。S2.3 新增 `context-manifest.json`，固定 Rust 返回的来源元数据、排除原因、处理位置、敏感确认和确认状态；fixture 只含虚构标签与 Hash，不含正文、Prompt、Endpoint 或绝对路径。

Fixture 使用固定、虚构、无密钥内容；不得放入真实路径、文档正文、Prompt、AI 回复或凭据。

## 未知字段策略

### 可信 Rust 响应：允许新增字段

Rust command 返回给当前 TypeScript 前端的响应采用向前兼容策略：既有必需字段必须存在且类型正确，新增字段允许被旧客户端忽略。Rust 合同测试通过派生 `Deserialize` 验证相同规则，TypeScript guards 也只验证已知必需字段。

已有字段的删除、改名、类型变化、枚举值语义变化仍属于破坏性合同修改，必须新增合同版本或提供兼容层。

### 不可信协议输入：拒绝未知字段

AI 生成或外部输入的 `document_patch` 和 A2UI 协议保持严格 allowlist。Rust serde 使用 `deny_unknown_fields`，TypeScript guards 要求精确字段集合；任何额外字段均拒绝。

这一差异是安全边界：响应需要支持应用滚动升级，执行型协议需要防止未审阅能力悄然进入运行时。

## 测试入口

- Rust：`src-tauri/tests/contract_fixtures.rs`
- TypeScript：`src/shared/contracts/contracts.test.ts`
- TypeScript 运行时 guards：`src/shared/contracts/guards.ts`

Web Mock 合同测试显式清除 Tauri 运行时标记，并断言 Desktop `invoke` 未被调用。共享 fixture 测试不访问数据库、文件系统、Provider 或网络。

## 变更规则

1. 跨 IPC DTO 变化必须同步修改 Rust 类型、TypeScript 类型/guard 和对应共享 fixture。
2. 先让合同测试表达预期，再修改实现。
3. 兼容新增字段可留在 `v1`；破坏性变化必须建立新的版本目录并记录迁移策略。
4. Patch/A2UI 输入不得为了兼容而放宽未知字段校验。
5. Fixture 只表达跨边界 JSON，不固定数据库行、UI state 或内部 application service 结构。
