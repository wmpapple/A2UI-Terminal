# A2UI Terminal V2.0 项目架构

> 文档状态：V2 目标架构基线；S1.1—S2.6 已验收，S2.7 已完成自动验证、待人工验收
> 建立日期：2026-08-11  
> 对照代码：`main` 分支 S2.7 开始基线 `14243d6`；当前 S2.7 工作树待人工验收
> PRD：`A2UI_Terminal_V2.0_大众化产品需求文档_市场调研增强版 (1).docx`  
> PRD SHA-256：`E56FD2303B6228C5FC7AB1936FB1C2B71229845D6780DFDA2ACE06D69347AA3C`

## 1. 文档定位

本文同时记录两类事实，避免后续对话把规划误认为已实现：

- **当前实现**：以 2026-08-11 实际工作树为准，包含未提交改动。
- **V2 目标**：依据 V2.0 PRD 设计，只有在实施账本标记完成并通过验证后，才能改写为已实现。

状态标记统一使用：

- `[CURRENT]`：当前代码已经存在。
- `[TARGET]`：V2 目标设计，尚未完成。
- `[DECISION]`：已经确定且不得被实现随意绕过的架构决策。
- `[OPEN]`：实施前仍需产品或技术确认。

配套实施、变更记录和跨对话恢复规则见 [V2_IMPLEMENTATION_PLAN.md](V2_IMPLEMENTATION_PLAN.md)。V1 文档继续作为已交付内核的专项说明，不由本文删除或覆盖。

## 2. 产品与架构目标

V2 的产品品类是“可信的 AI 成果工作台”。聊天是任务控制面，不是成果本身。用户从目标或资料出发，在明确授权范围内生成可编辑成果，审阅重要修改，保存真实版本并导出交付。

四个不可退让的架构属性：

| 属性         | 架构机制                                                        | 禁止退化                                        |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------- |
| 本地优先     | 用户授权的真实文件、本地 SQLite、系统凭据库、本地 Provider 路径 | 默认扫描整个目录、隐藏上传、前端接触明文密钥    |
| 成果优先     | 独立 Result、版本、保存位置、状态、导出记录                     | 将聊天消息当作唯一完成态                        |
| 人类确认     | 统一 Review Pipeline、版本快照、冲突检查、风险确认              | 静默覆盖、删除、外发或跳过审阅                  |
| 安全动态界面 | 版本化 A2UI 协议、可信 Catalog、Schema、Action Policy           | 执行模型生成的 HTML、JavaScript、脚本或系统命令 |

## 3. 当前实现基线

### 3.1 技术栈与运行边界

`[CURRENT]`

- 前端：React 19、TypeScript 5.9、Vite 8、Ant Design 6、Zustand 5。
- 桌面端：Tauri 2、Rust 2021、SQLite/rusqlite、Windows Credential Manager。
- 测试：Vitest、Testing Library、Playwright、Rust unit/integration tests。
- 正式支持 Windows；Web 运行时只允许确定性 Mock。
- Tauri 主窗口通过 Capability 精确授权 55 个应用命令、updater 和 restart 权限；没有 Shell 权限。
- CSP 禁止远程脚本，当前因 Ant Design 运行时样式保留 `style-src 'unsafe-inline'`。

### 3.2 当前组件关系

```text
React components
  └─ feature stores / controllers
       └─ shared/platform/gateway.ts
            └─ shared/platform/desktop.ts（Tauri invoke/channel 适配）
                 └─ commands.rs（薄 IPC、对话框、Channel、取消注册表）
                      └─ application/*（Provider/Chat/Revision/Workspace/Import 用例编排）
                           ├─ repository/*（按领域包裹现有 Storage）
                           ├─ workspace/mod.rs（授权、读取、保存、版本、草稿）
                           ├─ ai/*（Provider、SSE、上下文校验）
                           ├─ patch/mod.rs（Patch 校验、应用、撤销）
                           ├─ a2ui/*（协议、Runtime 状态、Action 策略）
                           ├─ security/*（系统凭据）
                           └─ storage/mod.rs（现有 SQLite 实现）
```

### 3.3 当前已经具备的可信内核

`[CURRENT]`

- 真实目录工作区和独立授权文件；路径规范化、白名单、越界防护。
- S2.1 统一 ImportBatch：确认前能力检查、逐项选择、取消零授权、格式/大小/失败原因和 Zip Bomb 防护。
- 文本文件受控读写；DOCX/PDF 只读正文提取；2 MB 文本和 25 MB 文档限制。
- 250 ms 崩溃草稿、约 1 秒自动保存、SHA-256 冲突检测。
- 前端工作区切换以工作区 ID 为异步提交令牌；编辑器、自动保存、延迟文件读取和保存回写均不得只凭相对路径跨工作区复用。加载期间取消旧计时器并锁定输入，乱序请求只提交最后一次选择。
- 普通保存、Patch 和恢复版本链；版本默认保留 30 天。
- SiliconFlow、DeepSeek、OpenAI、自定义 OpenAI-Compatible Provider。
- API Key 只进入 Windows Credential Manager，前端只获知 `configured`。
- 显式上下文清单、敏感路径排除、疑似敏感内容二次确认。
- 流式响应、停止、分阶段超时、稳定错误码和部分响应保留。
- schema v11 统一 Review Request：聊天、来源适配、逐块接受/拒绝、安全应用、冲突三选项、跨重启恢复和撤销；既有 `document_patch`/Revision 内核继续承担真实写入与版本审计。
- A2UI Protocol V1、13 个固定组件、严格 Schema、增量更新、Action 审计和 Inspector。
- SQLite schema v11、迁移完整性检查、外键检查、WAL 和崩溃恢复；v9 Result、v10 Task/Template 已验收，v11 Review Pipeline 待人工验收。
- Windows CI、内部未签名包、正式签名/Updater 工作流框架、脱敏诊断和本地数据清除。

### 3.4 当前尚未具备的 V2 核心

`[CURRENT GAP]`

| 领域     | 当前状态                                                                                                          | V2 缺口                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 成果     | Result 聚合、文本新建/重开/保存/版本/复制、成果 UI 和导出入口                                                     | 尚无归档和真实多格式导出                                |
| 任务     | S1.2 已实现并验收本地 Task、结构化补问和草稿 Orchestrator                                                         | 尚无任务首页、上下文 Manifest 和真实生成编排            |
| 导入     | ImportBatch、文本/DOCX/PDF、CSV/XLSX 基础数据和图片本地视觉来源                                                   | Context Manifest 与 Provider 多模态发送属于 S2.3        |
| 上下文   | Rust 不可变 Manifest、来源/排除项、处理位置、一次确认和请求绑定                                                   | 没有 Full/Retrieval/Hybrid 策略、检索索引、Context Pack |
| 审阅     | Review Request/blocks、`document_patch`、`create_file`、空文件首次写入、冲突/撤销；S2.6 选区修改已接入统一 Review | S3.3 A2UI 中风险 Action 的真实接线仍属后续步骤          |
| 成果类型 | 文档/表格/清单/表单/小工具统一 adapter 与共享保存、版本、复制协议；A2UI 工具快照只读并自动保存状态                | S2.7 待人工验收；富格式编辑和导出仍属后续步骤           |
| 导出     | 无成果级导出服务                                                                                                  | 无 DOCX/PDF/富文本、CSV/XLSX、JSON 导出与导出审计       |
| 模板     | S1.2 已实现并验收 4 个版本化内置文档模板和字段 Schema                                                             | 尚无个人模板、系统规则/上下文规则编辑和模板 UI          |
| 模式     | S1.3 双模式外壳与 S1.5 成果专用工作台已实现                                                                       | S2.3 后接通成果 AI 上下文                               |
| 首页     | S1.4 已验收引导/六类入口，S1.5 已接入新建和特定 Result 重开                                                       | 完整导入和真实模型路径仍属后续阶段                      |
| 模型路径 | 首次使用需要自行配置 Key                                                                                          | 无内置可用路径、本地模型探测、本机/云端持续标识         |
| 指标     | 有安全审计，没有产品事件体系                                                                                      | 无 WUO、激活、审阅、保存、导出、恢复等隐私安全埋点      |
| 搜索     | 无统一搜索                                                                                                        | 无成果、资料包元数据和授权正文索引                      |

### 3.5 当前结构热点

`[CURRENT]` 以下是演进风险，不是对现有 V1 功能的否定：

- S0.3 已将 `src/stores/useAppStore.ts` 降为约 71 行组合根；现有组件 API 尚集中，后续新增 V2 领域不得重新堆回组合根。
- S0.4 已将 `src-tauri/src/commands.rs` 从约 1055 行降为约 632 行；Provider/Chat/Revision/Workspace 编排已进入 `application/*`，现有 `commands.rs` 仍待后续按领域拆文件。
- `src-tauri/src/storage/mod.rs` 约 1980 行，所有表的 Repository 和迁移基础设施集中在一个模块。
- `src-tauri/src/workspace/mod.rs` 约 1100 行，文件授权、格式提取、保存、草稿和版本职责集中。
- UI 组件直接读取大型全局 store；`SystemSettings` 还直接调用 Desktop API。
- 当前持久化对象以 Workspace/Session/Message/File 为中心，不适合直接承载“成果优先”的 V2 信息架构。

## 4. V2 总体架构

### 4.1 分层模型

`[DECISION]` V2 采用“展示层 → 前端应用层 → IPC 合同 → Rust 应用层 → 领域服务 → 基础设施”的单向依赖。

```text
Presentation
  Home / Results / Task Builder / Workbench / Review / Settings / Pro Tools
        ↓ intent + view model
Frontend Application
  taskController / resultController / reviewController / contextController
  feature stores（只保存 UI/请求状态，不成为业务事实源）
        ↓ typed gateway
Platform Gateway
  DesktopGateway (Tauri) / WebMockGateway (deterministic fixtures)
        ↓ versioned commands + events
Rust Application
  TaskOrchestrator / ResultApplicationService / ReviewApplicationService
  ImportApplicationService / ExportApplicationService / SearchApplicationService
        ↓ domain interfaces
Core Domain Services
  Workspace / Context / Result / Review / Revision / Permission / A2UI / Provider
        ↓ repositories + adapters
Infrastructure
  SQLite / File System / Credential Manager / Provider HTTP / Exporters / Local Model Probe
```

规则：

1. 页面组件不得拼接 Provider 请求、直接访问密钥、文件系统或 SQLite。
2. 前端 store 不持久化业务真相；Result、Task、Review、Revision、Template 均以 Rust/SQLite 为事实源。
3. Tauri command 只负责反序列化、授权入口和调用应用服务；复杂流程不留在 command 函数内。
4. 领域服务不依赖 Tauri 类型；便于 Rust 单测和未来 CLI/其他壳复用。
5. Web Mock 实现同一前端 Gateway 合同，但永不降级调用桌面能力。

### 4.2 目标代码布局

`[TARGET]` 目录在实施中可小幅调整，但职责边界不能倒退。

```text
src/
├─ app/
│  ├─ routing/                 # 首页、成果、模板、设置、专业模式路由/导航
│  ├─ bootstrap/               # 启动恢复与 capability 加载
│  └─ shell/                   # 简单/专业模式外壳
├─ features/
│  ├─ home/                    # 六类任务入口、拖入区、最近成果
│  ├─ tasks/                   # 任务创建、结构化补问、执行状态
│  ├─ results/                 # 成果列表、详情、生命周期、完成态
│  ├─ import/                  # 导入清单、格式能力和授权提示
│  ├─ context/                 # AI 可读取内容、策略说明、资料包
│  ├─ review/                  # 统一查看修改
│  ├─ editor/                  # 文档/表格/清单编辑适配
│  ├─ templates/               # 模板列表与个人模板
│  ├─ export/                  # 导出选择、进度和结果
│  ├─ a2ui/                    # Runtime；Inspector 仅专业模式
│  ├─ provider/                # 大众模型状态与专业 Provider 配置
│  ├─ search/                  # 成果与授权资料搜索
│  └─ settings/
├─ application/
│  ├─ gateways/                # 平台无关合同
│  ├─ controllers/             # 用例编排和 view model
│  └─ stores/                  # 按领域拆分的临时 UI 状态
└─ shared/
   ├─ contracts/               # 与 Rust 对齐的 DTO
   ├─ ui/
   ├─ i18n/
   └─ testing/

src-tauri/src/
├─ commands/                   # 薄 IPC 适配器，按领域拆文件
├─ application/
│  ├─ task_orchestrator.rs
│  ├─ result_service.rs
│  ├─ review_service.rs
│  ├─ import_service.rs
│  ├─ export_service.rs
│  └─ search_service.rs
├─ domain/
│  ├─ task/
│  ├─ result/
│  ├─ review/
│  ├─ context/
│  ├─ permission/
│  └─ template/
├─ infrastructure/
│  ├─ storage/                 # 按聚合拆 Repository
│  ├─ workspace/               # 路径、授权、读写、提取
│  ├─ providers/               # compatible adapter + 专用 adapter
│  ├─ credentials/
│  ├─ exporters/
│  ├─ retrieval/
│  └─ telemetry/
├─ patch/                      # 保留成熟内核，接入 Review Pipeline
├─ a2ui/                       # 保留成熟内核，增加协商/conformance
└─ error.rs
```

## 5. 核心领域模型

### 5.1 Result（成果）

`[DECISION]` Result 是 V2 第一等聚合，与 Chat Session 解耦。关闭对话、切换模型或删除非必要会话不得破坏成果。

```text
Result
  id: UUID
  workspaceId: UUID
  taskId: UUID?
  type: document | spreadsheet | checklist | form | tool
  title: string
  status: draft | generating | review_pending | ready | exporting | failed | archived
  storageKind: workspace_file | standalone_file | managed_local
  storageRef: opaque reference
  currentRevisionId: UUID?
  activeSessionId: UUID?
  a2uiSurfaceId: string?
  createdAt / updatedAt / completedAt
```

约束：

- `storageRef` 对前端必须是不透明引用；不得用任意绝对路径作为业务 API。
- 新成果默认保存到应用管理的本地“我的成果”目录；只有导出或用户主动另存时才通过系统对话框选择外部位置。
- “我的成果”目录由 Rust 管理，前端只获得 Result 和不透明存储引用；设置中应提供打开目录、空间占用和迁移入口。
- 用户可以主动新建五类受控 Result。创建表单至少明确标题和成果类型，并按 adapter 选择 Markdown/纯文本、CSV 或受控 JSON；用户点击“创建”即为本次创建动作的显式确认，不需要伪装成 AI Review。
- AI 不得直接创建文件。AI 只能提出 `create_file` Review Request，内容、建议文件名、托管位置和风险必须先展示给用户；只有用户接受后，Rust 才能创建真实文件、初始 Revision 和 Result 关联。
- 文档、表格等文件型成果通过 Revision 保存内容和 Hash；A2UI 成果保存协议状态及权限声明。
- 每个 Result 必须能继续编辑，并至少拥有保存或导出路径。
- Result 删除与真实文件删除是两个不同操作；V2 P0 默认只归档/删除应用记录，不删除真实文件。

`[IMPLEMENTED — S1.5 ACCEPTED]` 用户可从首页或成果页主动创建 Markdown/纯文本 Result。Rust 只接受单层安全文件名和匹配扩展名，拒绝绝对路径、路径穿越、非法字符、系统保留名和同名覆盖；前端只获得 Result DTO 与 `result://` 引用。成功路径建立托管 UTF-8 文件、Result 和初始 Revision；SQLite 失败会补偿删除本次新建文件。手工编辑使用基础 Hash 冲突检查和现有版本保留规则，支持重开、历史预览/恢复、撤销与独立副本。S1.2 旧托管草稿缺少初始版本时在首次专用读取时惰性补录，不批量扫描或复制其他内容。

`[IMPLEMENTED — S2.7 PENDING ACCEPTANCE]` Result 工作台按 `document | spreadsheet | checklist | form | tool` 选择受控 adapter，但继续复用既有 `create_text_result`、读取、Hash 冲突保存、Revision、恢复和复制协议，避免为每种 UI 建立写入旁路。document 使用 UTF-8 Markdown/纯文本；spreadsheet 使用 UTF-8 CSV 并按 RFC 风格引号解析；checklist、form、tool 使用有界受控 JSON，Rust 校验根结构、字段类型、唯一标识、数量与长度。普通 tool 提供安全键值配置编辑；由 A2UI Surface 形成的 tool 只显示已验证快照，控件动作在原 A2UI 事务内同步更新 Result 快照，不能在成果编辑器中执行脚本、HTML、宏或动态代码。DOCX/PDF/XLSX 无损回写与真实导出仍属于 S2.8，不在本阶段伪装实现。

### 5.2 Task（任务）

`[IMPLEMENTED — PENDING S1.2 ACCEPTANCE]` 当前子集持久化 `write | modify | organize | analyze` 文档任务、版本化模板、经 allowlist 校验的回答、最多 3 个必要问题和 Result 绑定。`processingMode`、`providerId`、`contextManifestId`、`build_ui` 与 `freeform` 仍是后续目标字段。

```text
Task
  id: UUID
  kind: write | modify | organize | analyze | build_ui | freeform
  templateId / templateVersion: optional
  desiredResultType
  status: draft | awaiting_input | ready | running | review_pending | completed | failed | cancelled
  inputAnswers: validated JSON
  contextManifestId
  processingMode: local | cloud
  providerId
  resultId
  createdAt / updatedAt
```

Task 记录用户意图、必要输入和一次连续成果流程；Chat Session 只是 Task 可选的澄清通道。

### 5.3 Review Request（审阅请求）

`[DECISION]` 所有 AI 导致的持久写入必须进入统一 Review Pipeline。

```text
ReviewRequest
  id: UUID
  resultId: UUID?  # create_file 在接受前没有占位 Result
  source: chat | selection | template | a2ui_action | import_transform
  operationKind: document_patch | table_patch | structured_patch | create_file | replace_result
  status: pending | partially_accepted | accepted | rejected | applied | conflicted | failed | undone
  baseRevisionId / baseHash
  summary / risk
  blocks[]
  createdAt / decidedAt / appliedAt
```

旧 `patch_operations` 和 `document_versions` 保留为成熟执行记录；V2 Review Request 在上层统一各种来源，并通过适配器调用现有 Patch 内核。

`create_file` 的 payload 只能携带受限的建议名称、文本成果类型、完整候选内容和不透明目标作用域，不能携带可直接执行的绝对路径。待审阅状态不得创建空占位文件、临时成果或 Revision。用户接受后，Rust 必须重新校验名称、扩展名、目标作用域和冲突状态，以原子方式写入并在同一业务事务中建立 Result/Revision；用户拒绝、取消或审阅过期时磁盘保持不变。目标已存在时默认拒绝覆盖，改名或覆盖必须形成新的用户决定。

`[IMPLEMENTED — S2.5 ACCEPTED]` schema v11 的 `review_requests/review_blocks` 是业务事实源，前端只保存当前呈现状态。聊天候选和 `chat | selection | template | a2ui_action | import_transform` 来源适配统一进入 Rust `ReviewApplicationService`；当前聊天和 S2.6 选区修改都已接入同一入口，S3.3 仍须复用该入口，不得另建写入旁路。待审阅与冲突审阅可在工作区重开时恢复。`document_patch` 继续调用成熟 Patch 内核；`create_file` 只在接受后以 `create_new` 写入“我的成果”，建立一个 Result/初始 Revision，重复应用幂等；空白授权文本使用完整内容首次写入语义，不放宽非空锚点规则。Markdown 编辑器不得把初始化产生的空换行写回真正零字节文件；Rust 同时兼容仅含 Unicode 空白或 UTF-8 BOM 的既有空白文本，并以原始 Hash 保持并发检查和撤销的逐字节精确性。应用状态新增 `undone`，Patch 撤销与 Review 状态在同一 SQLite 事务中关联。Result 读取响应包含由 Rust 从 `output_result_id` 反查的可选 `appliedReview { reviewId, workspaceId }`，所以重新导航或应用重启后不依赖前端临时状态也能恢复撤销入口。删除前必须与初始 Revision Hash 比较，后续编辑或外部变化停止并报冲突。前端撤销动作使用显式布尔完成结果：成功后提示并导航到“我的成果”以立即呈现删除结果，失败时保留应用标记并把 Rust 错误同时显示在成果页和即时提示中，不允许静默失败。

`document_patch`、`create_file`、`replace_empty_file` 是模型到 Rust 的机器协议。流式 UI 只展示“正在生成可审阅方案”；校验成功后聊天记录保存用户可读摘要，结构化候选继续由 SQLite Review 记录承担。前端按三种协议与 `PATCH_READY/CREATE_REVIEW_READY/REPLACE_REVIEW_READY` 统一显示审阅入口和“接受前零写入”语义，不把协议 JSON 当作助手正文。

冲突只提供可理解且不覆盖原文的三个方向：保留当前版本、把已审阅的单文件完整候选另存到“我的成果”、关闭旧候选并基于当前版本重新生成。多文件冲突不能伪装为一个完整副本。A2UI `request_patch` 当前仍只返回 `review_required` 而不写文件，真实 Action→Review 接线按 S3.3 实施。

`[IMPLEMENTED — S2.6 ACCEPTED]` 编辑器文本选区和 textarea 表格/代码选区会显示统一选区助手，提供润色、缩短、改专业、解释、提取重点和自定义六类动作。动作先建立仅含当前选区的 Context Manifest，并展示目标文件、字符数和本机/云端处理位置；敏感云端清单继续要求明确确认。修改类请求通过现有 `stream_chat` 的受限 `reviewSource=selection` 进入同一 Review Pipeline，接受前不修改编辑器或文件；Rust 持久化的 Review 来源为 `selection`，Patch 应用时继续复核文件 Hash、授权、唯一锚点和冲突。解释类请求使用 `explanationOnly` 只读模式：Rust 不解析或持久化 Review/A2UI 候选，只保存用户可读说明，文件完成声明防伪规则仍然生效。切换文件或工作区继续清除旧选区；重复锚点或外部变化安全失败，不以首次字符串匹配绕过 Patch 内核。

### 5.4 Context Manifest 与 Context Pack

```text
ContextManifest（每次请求不可变快照）
  id, taskId, strategy, processingMode
  source metadata[]: type, opaqueRef, label, hash, size, selectedRange?
  excluded metadata[]: reason
  estimatedSizeBucket, sensitiveWarning, confirmedAt

ContextPack（可复用授权集合）
  id, workspaceId, name, itemRefs[], createdAt, updatedAt
```

- Manifest 记录实际使用来源的元数据和 Hash，不长期复制文件正文。
- Context Pack 只是引用集合；挂载后仍必须在请求前展开为具体来源并确认。
- 删除 Context Pack 不删除原文件。

`[CURRENT — S2.3 ACCEPTED]` 通用工作台每次请求执行 `plan_context → confirm_context_manifest → stream_chat(contextManifestId)`。Rust 用已授权 `sourceId` 复读文本/表格并独立生成 included/excluded 元数据；选区是唯一允许的短期前端正文来源。待确认正文只在 Rust 进程内存保留 10 分钟，确认后一次消费；工作区、会话、Prompt Hash、Provider ID 或 Provider 配置指纹任一变化都会拒绝旧清单。SQLite 继续复用 `context_snapshots` 保存实际请求清单的元数据/Hash，不新增长期正文表。

交互层采用“单对话一次主动弹窗、逐请求一次性 Manifest”：首次发送主动展示清单；后续范围和 Provider 未变化时在后台生成并确认新的 Manifest，不复用旧 ID。前端待确认清单同时绑定 Provider 指纹、上下文指纹和 Prompt 内容指纹，任一输入变化即从界面失效；Rust Prompt Hash 继续作为最终拒绝边界。已确认的范围/Provider 指纹属于工作区级会话状态，跨工作台与设置页导航保留，切换/移除工作区时清空。Provider store 在活动 Provider 的 Endpoint/Model/Temperature/Proxy 被保存修改或活动 Provider 被切换后，显式失效所有已有消息会话；该事件规则同时覆盖尚无新版本确认指纹的历史会话。范围、文件内容或 Provider 变化时只提示用户点击“修改发送清单”，不主动弹窗且不调用 Provider。后台 Manifest 新发现敏感内容时不得代替用户确认，只保留待确认清单并提示用户主动打开后明确确认。

前端聊天区域按职责拆为 `ChatPanel` 组合层、`useChatContextFlow` 上下文编排、`ChatMessageList` 协议呈现和 `ChatComposer` 输入/拖放交互。React 组件不直接调用 Desktop Gateway，Context Manifest 编排只通过 `chatController` 进入平台边界；架构测试限制组合层规模并检查这一依赖方向。

处理位置仅把精确 loopback 主机判为 `local`，其余均为 `cloud`。云端疑似敏感内容要求额外确认。当前 OpenAI-Compatible 文本发送合同没有可信图片字段，因此图片会保留原始 Hash 并明确列入排除项；表格由 Rust 受限解析后以结构化 JSON 文本加入上下文。S2.3 没有实现检索、chunk、Embedding、索引、Context Pack 或成果专用 Review 链路。

### 5.5 Template

Template 不是 Prompt 文本列表，至少包含：版本、任务类别、字段 Schema、默认结构、成果类型、系统规则、上下文规则、风险声明和兼容范围。个人模板不得保存用户敏感原文。

`[IMPLEMENTED — S1.2 ACCEPTED]` schema v10 的 `task_templates` 已登记会议纪要、文档总结、周报和简历优化 v1。当前模板只保存非内容型字段规则、默认空白章节和风险等级；用户源文不进入模板，个人模板与更完整的系统/上下文规则留待后续步骤。

## 6. 数据架构与迁移

### 6.1 当前 SQLite

`[IMPLEMENTED — S1.2 ACCEPTED]` schema v10 包含：

- `workspaces`、`workspace_files`、`workspace_drafts`
- `sessions`、`messages`、`context_snapshots`
- `document_versions`、`patch_operations`
- `a2ui_surfaces`、`a2ui_messages`、`a2ui_events`
- `provider_settings`、`credential_refs`、`app_settings`、`audit_events`
- `results`（第一等成果聚合；旧文件/Surface 惰性归档，不批量复制正文）
- `task_templates`（版本化内置模板；不保存用户源文）
- `tasks`（状态、结构化回答、最多 3 个当前必要问题计数和 Result 绑定）
- `review_requests` / `review_blocks`（schema v11；候选 payload、逐块决定、应用/冲突/撤销关联）

### 6.2 V2 目标表

`[CURRENT + TARGET]` 从 v9 起只做前向、连续、事务迁移；v9 Result、v10 Task/Template 与 v11 Review 已落地：

| 表                                     | 作用                                       | 关键关系                                           |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `results`                              | 成果聚合和当前状态（v9 已落地基础字段）    | workspace、task、session、current revision         |
| `tasks`                                | 任务生命周期和结构化输入（v10 基础已落地） | workspace、template、result；context manifest 后续 |
| `review_requests`                      | 统一审阅头（v11 已落地）                   | result、base revision、patch operation             |
| `review_blocks`                        | 语义块决定（v11 已落地）                   | review request                                     |
| `context_manifests`                    | 一次实际发送的策略、模式与汇总             | task、session/request                              |
| `context_manifest_sources`             | 来源元数据，不存长期正文                   | manifest                                           |
| `context_packs` / `context_pack_items` | 可复用资料引用集合                         | workspace                                          |
| `task_templates`                       | 内置/个人模板及版本（v10 内置基础已落地）  | 当前为全局内置；个人模板后续                       |
| `export_jobs`                          | 导出格式、版本、状态、脱敏错误             | result/revision                                    |
| `product_events`                       | 本地隐私安全行为事件                       | optional task/result                               |
| `search_documents`                     | 成果/资料包允许索引的元数据和分块引用      | result/context item                                |

迁移规则：

1. 不改写 v1-v8 历史迁移；任何修正使用新迁移。
2. 首个 V2 迁移只建新表，不强制把所有旧文件变成成果。
3. 采用惰性归档：用户打开旧工作区文件时，可创建对应 Result；迁移过程不得复制整个工作区。
4. 旧 Session、Patch、A2UI 数据保持可读；关联字段允许空值。
5. 升级前后执行 `quick_check` 与 `foreign_key_check`；失败必须停止启动而不是覆盖数据。
6. 每个 schema 版本都要有从 v0…当前版本的升级测试和故障回滚测试。

v10 迁移额外保证：v9 Result 原样保留，内置模板以 `(id, version)` 幂等播种，Task/Result 必须属于同一工作区且一个 Task 最多绑定一个 Result；迁移失败时任务表、模板表和 `user_version` 一并回滚。

v11 迁移只新增 Review 表和索引，保留旧 Patch/Revision/Result；外键级联只删除应用记录，不触碰真实文件。迁移失败时两张 Review 表和 `user_version` 一并回滚。清除本地数据会删除 Review 记录，但真实项目文件和“我的成果”文件仍遵循各自明确删除/撤销语义。

### 6.3 状态所有权

| 状态                                 | 事实源                          | 前端允许缓存             |
| ------------------------------------ | ------------------------------- | ------------------------ |
| Result/Task/Review/Revision/Template | SQLite + Rust service           | 摘要、当前详情、请求状态 |
| 真实文件内容                         | 授权文件系统                    | 打开的编辑缓冲区         |
| 未保存编辑                           | SQLite draft + 内存             | 当前编辑缓冲区           |
| API Key                              | Windows Credential Manager      | 仅 `configured: boolean` |
| A2UI Surface                         | SQLite 中已校验状态             | 当前可视 Surface         |
| UI 模式、引导完成、面板宽度、外观    | app settings/local preference   | 是                       |
| 产品事件                             | 本地事件表；上传必须另经 opt-in | 不需要长期 UI 缓存       |

## 7. 核心流程

### 7.1 从首页到成果

`[CURRENT — S2.1 PENDING ACCEPTANCE]` 首次启动使用三步可跳过引导解释目标、资料选择和隐私边界；本地只保存一个完成布尔值，不保存用户选择的目标或资料内容。首页严格保留 PRD 六类一级入口，不根据会话或推荐流增生分类；六个任务卡片内部使用统一内容起点与可用宽度，避免文案长度导致图标和文字基线错位。统一资料区同时支持受控系统选择和 Tauri 原生桌面拖放；React 只注册逻辑坐标边界，不接触绝对路径或文件系统。

首页的高频文档路径通过独立 Home store/controller 调用已验收的 Template、Task 与 Result Gateway。Desktop 最近成果来自 SQLite `results`；Web Mock 使用确定性同合同 fixture；两者都不从 Chat Session 推断成果。O-08 未关闭前，会议纪要、文档总结、周报和简历优化只创建明确标注“尚未调用 AI”的本地结构草稿。表格分析与动态工具入口只显示未开放原因，不模拟成功。

```text
选择任务/拖入资料
  → Import Service 建立授权引用和格式报告
  → Task Orchestrator 创建 Task
  → 模板字段校验；最多 3 个必要问题
  → Context Service 生成可见 Manifest
  → 用户确认本机/云端与读取范围
  → Provider Service 生成候选成果或 Review Request
  → Result Service 创建/更新 Result
  → 有持久写入：Review Pipeline
  → Revision Service 建版本并保存
  → 完成态：继续编辑 / 查看历史 / 导出 / 另存副本
```

S1.2 已验收并开放上述流程的本地准备子集：创建 Task → 校验/补问 → 在“我的成果”目录生成明确标注“尚未调用 AI”的 Markdown 结构草稿 → 事务绑定 Result。它不调用 Provider，不代表真实正文生成；完整模型、Context 和 Review 链路仍受后续步骤及 O-08 约束。

`[CURRENT — S1.5 ACCEPTED]` 主动新建流程、Result 专用重开和大众双栏工作台已落地并通过人工验收。Result store/controller 不依赖聊天状态；中央编辑区提供保存状态、查看修改、撤销和历史，完成态保留另存副本与导出入口。右侧 AI 助手当前明确不自动发送成果，等 S2.3 Context Manifest 接通；导出入口明确说明真实多格式导出属于 S2.8，不返回假成功。

托管 Result 与项目文件树属于不同导航域：左侧树只代表当前显式授权工作区，不展示 `my-results` 物理路径。接受 `create_file` 后直接打开新 Result，标题区标明其位于“我的成果”并可返回成果列表；Markdown 默认呈现安全阅读视图，源文编辑由用户主动切换。选择项目文件或重新进入主工作台会清除活动 Result 并恢复工作区编辑器，避免成果视图拦截文件导航。

用户主动新建不依赖 AI：

```text
首页/成果页点击“新建”
  → 选择文档/表格/清单/表单/小工具并输入标题
  → Rust 校验受控名称和“我的成果”目标作用域
  → 用户确认创建
  → 原子创建受控 UTF-8 内部文件 + Result + 初始 Revision
  → 打开工作台继续编辑
```

### 7.2 统一导入批次

`[IMPLEMENTED — S2.1 / S2.2 ACCEPTED]` 首页资料区不再把系统选择或原生拖入结果立即当作已授权上下文，而是建立短生命周期 `ImportBatch`：

```text
系统文件选择器
  → Rust 规范化路径并检查批次/单文件上限
  → 逐项识别能力、只返回文件名/大小/状态/原因/替代方式
  → 用户逐项保留或取消
  → 取消：删除内存批次，零 Workspace/File 授权
  → 确认：重新检查文件，原子建立可读项的 workspace_files 授权
  → 前端只获得 sourceId、脱敏来源元数据和受限本地预览，不获得绝对路径
```

- `ImportBatch` 只保存在 Rust 进程内存，当前最多保留一个待确认批次；应用重启或新选择会使旧批次失效，不新增长期内容表或 schema migration。
- 桌面拖放由 Tauri `on_window_event` / `WindowEvent::DragDrop` 在 Rust 主窗口侧接收；`WindowContent` 不得错误监听 `WebviewEvent::DragDrop`。前端只通过 `set_import_drop_target` 注册最多 8 个可见资料区的逻辑坐标、目标 ID 和可选 Workspace ID。每次 React Effect 生命周期使用独立目标 ID，使 StrictMode/HMR/Workspace 变化中的旧异步清理只能注销旧目标，不能误删当前资料区。Rust 精确命中面积最小的包含区域；区域外不建立批次。命中后在线程中执行与系统选择相同的 `inspect_paths`，同一时刻只允许一个原生拖放检查。
- Rust 只发出 `import-drop-outcome` 脱敏事件：事件含目标 ID、ImportBatch 或稳定错误，不含绝对路径。主窗口 Capability 仅允许前端 `core:event:allow-listen` / `allow-unlisten` 以接收该结果，不授予 `allow-emit` 或 `allow-emit-to`；拖到注册区域外会被忽略。清除所有本地数据会递增导入世代、清空目标/批次，并阻止进行中的旧检查重新写回待确认内存。
- 当前可确认能力是 UTF-8 白名单文本、只读 DOCX/PDF 文本层、CSV/XLSX 基础数据和 PNG/JPEG/GIF/WebP 原始视觉来源。文本与 CSV 上限 2 MB，DOCX/PDF/XLSX 上限 25 MB，图片上限 20 MB，单批最多 20 个文件且总计不超过 100 MB。
- 隐藏属性/点文件、`.git`、`.ssh`、`secrets`、`.env`、私钥、证书和常见凭据路径直接拒绝，不进入默认授权范围。前端只能提交批次内的随机 item ID。
- DOCX/XLSX 预检压缩条目数、单条目/总展开量、压缩比、路径穿越和必要结构；宏、外部关系、嵌入对象只报告且绝不执行或访问。PDF 检查签名并预读文本层；扫描文档明确提示后续 OCR/视觉能力。
- S2.2 引入统一 `DocumentSource`，把“用户已授权的本地来源”与“可在文本编辑器打开的 `WorkspaceDocument`”分开。文本仍生成 `WorkspaceDocument`；表格和图片只生成持久化 `sourceId` 与脱敏元数据，通过 `list_document_sources` / `read_document_source` 读取。两个读取命令都从 SQLite 授权记录反查路径，不接受前端路径。
- 已确认来源属于工作区级累积集合，不属于最后一个 `ImportBatch` 的临时结果。每次确认后前端必须调用 `list_document_sources(workspaceId)` 重新取得完整授权事实；刷新异常时可以按 `sourceId` 合并当前批作为显示兜底，但不能将已成功确认误报为失败。SQLite 继续按 `(workspace_id, absolute_path)` 去重；Web Mock 必须保持同样的追加与去重语义。
- 用户可以通过 `revoke_document_source(workspaceId, sourceId)` 撤销单项授权。Rust 必须在同一条删除条件中校验工作区和来源归属，跨工作区、未知或已撤销 ID 都返回“来源不存在或未获当前工作区授权”；成功只删除 `workspace_files` 记录，响应固定声明 `originalFileDeleted=false`。前端在二次确认后关闭对应预览、内存文本、版本预览和已保存上下文选择，再重新取得完整来源列表。该动作不删除磁盘原文件，也不自动删除已经生成的 Result 或历史记录。
- CSV 使用 RFC 风格引号/跨行字段解析；XLSX 只读取共享字符串、内联字符串、布尔值、数值和公式缓存值，不计算公式。上限为 32 个工作表、每表 10000 行/256 列、总计 100000 个网格单元格、单元格 32768 字符。公式与以 `= + - @` 起始的 CSV 文本标为公式注入风险，原值不改写；S2.8 导出必须调用转义策略。
- 图片保留原始文件字节作为未来多模态来源，只读取签名、尺寸和动画能力元数据；边长上限 32768 像素，总像素上限 4000 万。小于等于 8 MB 的图片可生成仅供当前本机 UI 使用的 `data:` 预览，较大图片仍保留原始来源但不跨 IPC 复制。当前 `visualModelAvailable=false`，UI 必须明确“尚未发送给 AI”；发送授权严格属于 S2.3。
- 确认前会再次检查文件，防止选择后替换或膨胀；确认的多个可读文件在单个 SQLite 事务中建立引用。来源文件只读，不复制、不修改，也不调用 Provider。
- 专业模式既有 `select_context_files` 继续保留兼容命令，但其路径检查、Office/PDF 安全检查和确认时重检复用同一 Import application service，避免双重信任边界。

### 7.3 统一 Review Pipeline

```text
候选变更（聊天/选区/模板/A2UI）
  → 标准化为 ReviewRequest + blocks
  → Rust 校验 Schema、授权范围、base revision/hash、风险
  → UI 以段落/表格区域/字段展示“查看修改”
  → 用户逐块接受、拒绝或继续调整
  → 再次读取磁盘并检查冲突
  → 写入前快照
  → 事务式应用；失败回滚磁盘和数据库
  → 写入后 Revision + 审计
  → Result.currentRevision 更新
```

任何 `save_*`、模板写入或 A2UI Action 若代表 AI 建议，不得直接调用文件保存命令。纯用户手工编辑的自动保存仍可走安全保存链，不强制进入 AI 审阅。

创建文件同样遵守上述边界：用户主动点击“新建”并确认属于直接用户意图；聊天、模板或 A2UI 中由 AI 建议的新文件只能进入 `create_file` Review。审阅界面必须展示建议文件名、文本类型、目标位置说明和完整内容预览，并提供接受、拒绝与调整名称；接受前文件系统写入次数必须为零，重复应用同一 Review 必须幂等。

已存在的空白 UTF-8 文本文件不是 `create_file`，但同样不能通过放宽 Patch 非空锚点规则直接写入。S2.5 提供专用首次写入 Review 语义：候选内容完整可见，接受前零写入；Rust 在生成和应用时重新验证来源授权、可编辑类型、原始基线 Hash 和当前仍为空白，外部变化按冲突处理；接受后建立可撤销版本，拒绝或失败保持原始字节不变，撤销也精确恢复原始基线。真正零字节 Markdown 在编辑器初始化时不得因组件规范化回调被写成换行；仅含 Unicode 空白或 UTF-8 BOM 的既有文件按相同安全流程处理。

### 7.4 自适应上下文

`[IMPLEMENTED — S2.4 PENDING ACCEPTANCE / ADR-019]` Context Planner 根据格式、可提取性、文件数、字符数、任务和用户选择决定：

- `Full`：短文件/短选区全文。
- `Retrieval`：长文、多文件或资料包按块检索。
- `Hybrid`：关键文件全文 + 其他来源检索。

Planner 输出必须包含：策略、实际来源数、估算大小、排除原因、处理位置和敏感提示。用户能删除单项或缩小范围。检索索引只能覆盖用户授权内容，敏感排除路径默认不索引；任何索引正文默认留在本机。

S2.4 P0 的检索边界已经关闭并固定：

- 文本按标题、段落和表格行确定性分块，目标约 1600 字符、相邻块约 200 字符重叠；每块保留不透明来源 ID、内容 Hash、字符范围和顺序。
- 检索采用 Rust 本地确定性词法/BM25 排序，中文使用稳定的字符 n-gram 补充匹配；相同输入和查询必须得到相同结果及固定次序。
- Planner 使用 32000 token 本地输入预算并预留 2048 token 给包装与系统指令；ASCII 按每 4 字符约 1 token，中文、Emoji 和其他非 ASCII 字符按每字符 2 token 保守估算。最近消息最多占 6000 token，超出时从最旧消息开始排除并写明原因。
- P0 不下载、不调用本地或云端 Embedding 模型；检索实现通过内部接口隔离，未来替换为用户明确选择的本地 Embedding 时不得改变授权和 Manifest 合同。
- 索引正文和词项只存在进程内存，不写入 SQLite、日志或临时文件，因此本阶段没有持久索引加密问题。SQLite 仍只保存 Manifest 元数据和 Hash。
- 索引按 workspace/source/contentHash 隔离。撤销来源授权、内容 Hash 变化、切换或删除工作区、一键清除和进程退出都会使相应索引立即失效；再次使用时只从当前仍获授权的来源重建。
- Manifest 必须显示 Full/Retrieval/Hybrid、实际使用与排除来源、选中块范围和估算大小。检索只改变本次发送的已授权正文子集，不扩大用户授权范围。
- 清单消费前 Rust 再次反查每个实际发送来源的 workspace 授权和当前内容 Hash；撤销授权或文件变化会拒绝旧清单。`clear_context_index` 只接受工作区不透明 ID，清理内存索引的同时使待发送清单失效。

### 7.5 导出

- 导出输入必须绑定 `resultId + revisionId`，确保与当前版本一致。
- 文件选择由 Rust 系统对话框完成；前端不提交任意绝对目标路径。
- P0：文档 Markdown/DOCX/PDF/富文本，表格 CSV/XLSX，清单/表单 PDF 或结构化 JSON。
- 导出不得包含未授权上下文、Prompt、内部协议调试字段或绝对路径。
- 导出失败记录稳定错误码和可重试状态，不记录成果正文到日志。
- PDF/DOCX/XLSX 生成器需单独做依赖、字体、许可证和公式注入安全审查。

### 7.6 表格、图片与复杂文档边界

`[IMPLEMENTED — S2.2 ACCEPTED / S2.3 ACCEPTED]` V2 P0 支持 CSV/XLSX 基础数据。图片是可单独授权的上下文类型，系统保留原始视觉信息供未来具备视觉能力的多模态模型理解，不以仅提取文本替代原图。

- 图片是否发送、发送给本地还是云端模型，必须与其他来源一样进入 Context Manifest 并由用户确认。
- Provider 不支持视觉输入时必须明确说明，不得静默丢弃图片或伪造理解结果。
- P0 优先保证文本型和结构清晰文档的可靠读取、成果生成与基础导出，不承诺完整复刻 Office/PDF 内部结构。
- P0 新建成果以 UTF-8 Markdown 和纯文本为规范编辑格式；CSV 等结构化文本由表格适配器负责。DOCX、PDF、XLSX 等是受控导入/导出格式，不作为首期 AI 创建与无损回写的规范内部格式。
- 公式、宏、嵌入式图表和扫描文档首期优先提供只读预览或 AI 上下文能力；不承诺结构化编辑、公式语义保持或无损回写。
- 宏和外部链接永不执行；CSV/XLSX 导出必须防止公式注入；压缩型格式继续受大小、展开量、条目数和 Zip Bomb 限制。

### 7.7 A2UI 动态成果

- Rust 继续是唯一信任边界；前端只渲染已验证 Catalog。
- V2 增加协议版本协商、能力声明和官方 conformance fixtures。
- 清单、表单、计算器、对比器、计划表等必须有真实输入、状态、结果和后续保存/导出动作。
- `set_state` 等低风险临时状态可直接执行并审计。
- 修改成果、创建文件等中风险动作进入 Review Pipeline。
- 删除、外发、系统命令、工作区外访问为高风险；V2 默认不开放命令执行。
- 模型生成的 HTML、JavaScript、React、iframe、URL 自动加载或动态 npm 永久拒绝。
- 已验证 Surface 继续持久化到 SQLite 作为历史；恢复工作区只载入历史，不自动切换中央视图。用户可关闭当前交互成果回到编辑器，关闭不等于删除。永久删除使用独立危险按钮与不可撤销确认，经最小 `delete_a2ui_surface` Capability 到 Rust；Rust 复核工作区归属，并原子删除 Surface、同 Surface 检查/事件和自动关联 Result，不删除真实文件。取消或失败时零删除。

## 8. Provider 与处理位置

`[DECISION]` Provider 是基础设施，不进入产品主信息架构。

- 普通模式只显示“本机处理 / 云端处理”、可用状态、使用量和数据说明。
- 专业模式才显示 Provider、Endpoint、Model ID、Temperature、Proxy、BYOK。
- OpenAI-Compatible 能力优先走统一 adapter；新增专用 adapter 必须证明鉴权、流协议或能力差异。
- 本地探测只允许明确的 localhost 端点和受控超时，不扫描局域网。
- 切换 Provider 后，请求确认区域必须立即更新处理位置。
- `[DECISION]` 首次关键路径默认提供平台内置模型和受控试用额度，不要求用户配置 API Key；本地 Ollama/LM Studio 和自有 Key 作为可选路径。
- `[OPEN]` 仓库尚无内置试用服务。实现前仍需确定模型供应、服务端鉴权、额度、滥用控制、成本、隐私条款和失败降级；不能把平台密钥嵌入客户端，也不能用假成功替代。

## 9. 简单模式与专业模式

两种模式共享同一 Core Services、数据和安全策略，只改变导航、术语和信息密度。

`[CURRENT — S1.3 ACCEPTED]` 应用外壳提供首页、成果、模板、工作台和设置五个 Hash 路由；未知路由安全回退到首页。新安装默认简单模式，用户选择仅以 `simple | professional` 保存到本地 UI 偏好，非法值或存储读取失败均回退为简单模式；存储写入失败不阻止当前会话切换。该偏好不进入业务数据库，不含正文、路径、Endpoint 或密钥。

| 能力   | 简单模式（默认）                            | 专业模式                                |
| ------ | ------------------------------------------- | --------------------------------------- |
| 首页   | 六类任务、拖入区、最近成果                  | 可增加工作区快捷入口                    |
| 工作台 | 选择文件、成果区、AI 助手、新对话、查看修改 | 文件树、会话细节、模型切换              |
| 术语   | AI 可读取内容、查看修改、交互结果           | Context、Diff、Surface、Catalog、Action |
| 调试   | 用户可理解错误                              | Inspector、原始协议、Schema、延迟       |
| 安全   | 确认、审阅、撤销                            | 可查看规则，但不能绕过红线              |

专业模式不是另一套业务实现，不允许复制 Task/Result/Review 逻辑形成分叉。

`[CURRENT — S1.3 ACCEPTED]` 两种模式渲染同一组 `WorkspaceLayout`、`WorkspaceSidebar`、`EditorPane` 和 `ChatPanel`，并共享同一 Zustand store、Gateway 与 Rust IPC。简单模式不渲染文件树、会话列表、Provider/Model 标识、A2UI Inspector、Endpoint 和 API Key 入口，但保留直接复用现有授权链路的“选择文件”和直接复用现有会话动作的“新对话”；专业模式恢复完整 V1 工具。模式切换不会重建业务 store、迁移 Result/Task 数据、改变上下文授权或扩大 Capability。

`[CURRENT — S1.4 / S1.5 ACCEPTED; S2.7 PENDING ACCEPTANCE]` 首页已成为 Result/Task 产品入口，最近成果会按具体 Result ID 打开专用工作台；成果页提供五类本地 Result 列表与新建入口。简单模式显示成果区和 AI 助手外壳，专业模式在同一业务状态上增加既有文件树。AI 区不自动发送正文，导出入口不声称 S2.8 已完成。

## 10. IPC 与事件合同

### 10.1 合同原则

- 命令按领域命名并返回稳定 DTO，不暴露 rusqlite、reqwest 或 Tauri 内部类型。
- 所有 ID、枚举、上限和错误码由 Rust再次校验。
- 长任务通过 Channel 发送版本化事件；事件必须带 `operationId`，支持取消和幂等终态。
- 前端提交的是用户意图和不透明引用，不是 Action 风险、绝对路径或已校验结论。
- 新 Command 必须同时登记 `build.rs`、`lib.rs`、Capability、自动生成权限和命令注册测试。

### 10.2 建议的 V2 命令组

```text
task:     list_task_templates, create_task, answer_task_questions, start_task, get_task  # S1.2 已实现并验收；cancel 后续
result:   list_results, get_result, create_text_result, read_result_document, save_result_document,
          list_result_revisions, read_result_revision, restore_result_revision, duplicate_result
          # S1.5 已实现并使用最小 Capability；archive_result 后续
a2ui:    list_a2ui_surfaces, list_a2ui_inspections, delete_a2ui_surface, execute_a2ui_action  # 当前已实现并受最小 Capability 约束
import:   select_import_sources, inspect_import_batch, set_import_drop_target, confirm_import,
          list_document_sources, read_document_source  # S2.2 已实现并使用最小 Capability
context:  plan_context, confirm_context_manifest  # S2.3 已实现并使用最小 Capability；Pack 后续
review:   create_review_request, get_review, list_active_reviews, decide_review_blocks,
          apply_review, discard_review, resolve_review_conflict, undo_review  # S2.5 已实现
export:   start_export, cancel_export, list_result_exports
template: list_templates, save_personal_template, archive_personal_template
search:   search_authorized_content
provider: get_processing_options, probe_local_providers
telemetry:get_telemetry_settings, set_telemetry_settings, export_event_dictionary
```

这不是一次性添加清单。每个阶段只开放已实现且有权限测试的命令。

## 11. 安全、隐私与权限

`[DECISION]` 以下红线继承 V1 且 V2 不得放宽：

1. 写入、覆盖、删除或外发不得绕过用户可见审阅/确认。
2. 不默认发送整个工作区、全部会话或敏感目录。
3. 不执行任意 JS、Shell、PowerShell、Python、动态 npm 或模型代码。
4. API Key 不进入前端、SQLite、项目文件、日志、安装包固定配置或遥测。
5. 版本快照、撤销、冲突检查和 Action 风险分级不可因自动化而取消。
6. 未验证 AI 输出不得渲染为具有系统权限的控件。

额外 V2 要求：

- 匿名产品指标只采集产品是否好用所必需的行为、性能和错误数据，并且透明、可关闭。
- 允许字段包括：应用启动、应用版本、系统平台、功能动作计数、任务完成状态、AI 请求成功/失败类型与耗时区间、本地/云端模型类别、A2UI 渲染结果、崩溃/性能指标和首次核心闭环完成状态。
- 核心价值指标优先使用 Task Completion Rate、Review Adoption Rate、Accepted Patch Rate、Undo Rate、Export/Save Rate 和 Context Confirmation Rate，不以 DAU、消息数或模型调用量替代成果指标。
- “内容永不上报”是硬性红线：文档正文、Prompt、AI 回复、文件名、完整/绝对路径、图片内容、API Key、具体 Endpoint、邮箱、姓名、身份信息和本地资料索引内容不得进入匿名事件。
- 匿名指标默认关闭；用户完成首次核心闭环后，产品可用非打扰方式邀请其主动开启，不得使用默认勾选、阻断流程或诱导性文案。
- 设置固定提供“隐私 → 帮助改进产品”开关和“查看将发送的数据”入口；开启前即可查看字段，用户可随时关闭，关闭后停止后续上传。
- 搜索/检索索引必须继承授权与排除规则，并能随授权撤销删除。
- 任务模板只存字段结构和规则，不存敏感原文。
- 清除本地数据必须覆盖 V2 新表、索引和本地遥测，但不删除真实成果文件，除非用户对具体文件另行确认。
- 诊断计数需扩展到 V2 表，同时保持内容脱敏。

## 12. 非功能与可观测性

| 领域     | V2 门槛                                                    |
| -------- | ---------------------------------------------------------- |
| 启动     | 首页可交互目标 ≤ 2.5 秒；迁移/恢复状态不可假装完成         |
| 打开成果 | 普通文本成果目标 ≤ 1 秒                                    |
| 请求反馈 | 点击后 300 ms 内出现明确状态；流首字取决于 Provider        |
| 可靠性   | 自动保存失败显式提示；Task/Result/Review 可跨崩溃恢复      |
| 可访问性 | 核心流程键盘可用；焦点、标签、对比度、风险信息不只依赖颜色 |
| 可维护性 | 页面不直连基础设施；前后端按领域拆分；稳定合同和迁移测试   |
| 可观测性 | 区分模型、网络、协议、权限、冲突、存储、导入、导出错误     |
| 更新     | 签名更新、失败恢复、schema 兼容；不得清除成果或密钥        |

日志采用结构化稳定错误码和 `operationId`；正文、路径、密钥和未授权上下文默认脱敏。诊断报告只导出版本、平台、Schema、能力和计数。

## 13. 测试架构

### 13.1 测试层次

- TypeScript unit：controller、状态机、DTO 适配、术语和隐私事件过滤。
- React component：首页、任务创建、读取范围、Review、完成态、双模式和键盘操作。
- Web Mock E2E：使用同一 Gateway 合同覆盖任务 → 成果 → 审阅 → 保存/导出模拟闭环。
- Rust domain unit：Result/Task/Review 状态机、Context Planner、权限、导入/导出校验。
- Rust repository integration：每个迁移版本、事务、外键、清理、惰性旧数据归档。
- Contract test：TypeScript DTO 与 Rust serde fixture 一致。
- Security test：路径越权、公式注入、Zip Bomb、恶意 DOCX/XLSX、任意 A2UI、遥测泄露。
- Windows desktop E2E/冒烟：真实文件授权、保存、恢复、导出、安装/升级。
- A2UI conformance：合法/非法 fixture、未知组件/Action、版本不兼容、增量 revision。

### 13.2 发布阻断条件

- 任意未经 Review 的 AI 写入路径。
- 任意未授权数据发送或敏感遥测字段。
- Result、Review、导出或迁移导致不可恢复的数据丢失。
- 高风险 Action 未确认即可执行。
- 任意模型生成代码被执行。
- V2 P0 验收或正式签名/升级验证未通过。

## 14. 需求追踪摘要

| PRD 能力      | 架构承载                                            | 状态                                              |
| ------------- | --------------------------------------------------- | ------------------------------------------------- |
| ONB/HOME      | app routing、home feature、Result queries           | S1.4 Current                                      |
| IMP/TASK      | Import Service、DocumentSource、Task/Template       | Task/模板与 S2.1 Current；S2.2 已实现待验收       |
| WS            | Result Workbench、typed editors、mode shell         | 五类 Result adapter Current（S2.7 待人工验收）    |
| CTX-01…06     | Context Planner、Manifest、Pack、local/cloud status | Manifest/local-cloud Current；Planner/Pack Target |
| REV-01…06     | Review Request + 现有 Patch/Revision 内核           | S2.5 Current（已验收）；Selection 来源已接线      |
| OUT-01…06     | Result type adapters、A2UI、Action Policy           | 五类 adapter Current；S3.x Action 扩展仍为 Target |
| EXP-01…04     | Export Service、export jobs、format adapters        | 入口 Current，真实导出 Target                     |
| RES-01        | Result 聚合                                         | 文本创建/重开/版本 Current，归档等 Target         |
| SEL-01        | Selection controller → Review Pipeline              | S2.6 Current（已验收）                            |
| PRV-04/MDL-05 | Processing options、local probe                     | Target                                            |
| SRCH-01       | 授权索引和 Search Service                           | P1 Target                                         |
| ARC-03        | Compatible Provider adapter 准入                    | 部分 Current，需制度化                            |
| A2UI-06       | capability negotiation + conformance CI             | Target                                            |
| UX-08         | Import suggestions mapped to Result type            | P1 Target                                         |

完整实施顺序、逐步验收和变更记录见实施文档；这里的 `Target` 不代表已经承诺具体版本日期。

## 15. 已确定决策与开放问题

### 15.1 已确定

1. Result 是第一等对象，Chat Session 与其解耦。
2. 默认简单模式；专业模式主动开启且不能绕过安全规则。
3. 所有 AI 持久写入汇入统一 Review Pipeline。
4. Rust 是文件、凭据、Provider、权限、协议和持久化的唯一可信边界。
5. 模板是版本化工作流配置，不是 Prompt 列表。
6. Provider 是可替换基础设施，OpenAI-Compatible 优先。
7. A2UI 只执行声明式可信组件和受控 Action。
8. V2 不建设插件/MCP 市场、无人值守桌面 Agent、云端多人协作或任意代码 Artifact。
9. 首次使用默认走平台内置模型和试用额度，本地模型与 BYOK 为可选路径。
10. 新成果默认保存到应用管理的本地“我的成果”目录，导出时再选择外部位置。
11. 首批优先验证“会议纪要”和“文档总结”两个场景。
12. 开始 V2 前先验证并归档当前 V1 未提交改动。
13. P0 支持 CSV/XLSX 基础数据；图片作为显式授权的多模态上下文，复杂 Office/PDF 结构首期只读优先。
14. 允许克制、透明、可关闭的匿名产品指标，但用户内容永不上报。
15. V2 大众产品名称采用“A2UI 工作台”。
16. 匿名指标默认关闭，首次核心闭环完成后才邀请用户主动开启。
17. 用户可主动新建文本成果；AI 只能提议创建文件，用户接受 Review 前不得发生真实写入。
18. 首期规范编辑格式为 UTF-8 Markdown/纯文本，不以完整 Office/PDF/XLSX 结构兼容或无损回写为目标。

### 15.2 实施前必须关闭的开放问题

| ID   | 问题                                                                       | 阻塞范围                    |
| ---- | -------------------------------------------------------------------------- | --------------------------- |
| O-03 | DOCX/PDF/XLSX 导出采用哪些库，字体与许可证如何处理？                       | V2-B 导出                   |
| O-06 | 匿名指标上传接收端、保留期、聚合方式和删除机制是什么？                     | 指标与 Beta                 |
| O-07 | “A2UI 工作台”从 0.1.9 开始采用什么版本号、安装包标识和升级兼容策略？       | V2-D 发布                   |
| O-08 | 内置试用模型的供应商、服务端鉴权、额度、滥用控制、成本和失败降级如何实现？ | V2-A 首次完整生成、发布验收 |

开放问题不得由开发者在代码中静默选择。临时实现若不影响外部行为，必须写入实施账本并标为可逆假设。

## 16. 架构演进规则

1. 每个实现步骤开始前，先在实施文档把该步骤标为 `进行中`。
2. 所有实际修改、测试、决定、失败和剩余工作必须追加到变更账本。
3. 只有代码、自动化测试和人工验收证据齐全时，本文对应能力才能从 `Target` 改为 `Current`。
4. 不用大爆炸重写 V1；通过 Gateway、应用服务和新聚合逐步包裹成熟内核。
5. 任何偏离本文的架构决定先记录 ADR，再修改代码。
6. 每个阶段结束检查工作树，区分进入本阶段前已有改动与本阶段新增改动。
7. 用户要求“现在不要改动代码”的本次工作只建立文档，不构成 V2 实施授权。
