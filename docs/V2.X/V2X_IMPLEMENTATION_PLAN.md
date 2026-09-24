# A2UI 工作台 V2.x 实施计划（基于当前代码）

> 日期：2026-09-21（Asia/Shanghai）  
> 代码基准：`35023d75a0d87e5e16f1d0de8a554e4eb6b49a69`；开始分析时工作树干净。  
> 状态（2026-09-24）：M0、F0、M1-A、M1-B、M2 产品验收通过；用户已授权 M3。M3 Inline AI 与风险自适应审阅已完成工程实施，当前等待产品功能验收。实施证据见 [M3_EXECUTION.md](M3_EXECUTION.md)。未收到明确授权前不进入 M4。
>
> 输入：用户提供的 PRD、Engineering Implementation Plan、Product Engineering Roadmap，以及仓库现有 64 份 docs 文档、实现与测试。材料目录见 [V2X_REVIEW_INVENTORY.md](V2X_REVIEW_INVENTORY.md)。

## 1. 建议采用的路线

阶段验收分工：用户仅验收产品功能、操作体验和输出结果；代理负责代码/架构/接口、数据兼容、权限、自动测试、构建及技术问题排查。工程失败不能交由用户决定是否接受。两类验收均通过且用户明确允许后才进入下一阶段。F0 当前工程记录见 [F0_ENGINEERING_ACCEPTANCE.md](F0_ENGINEERING_ACCEPTANCE.md)。

保留现有 React/Tauri/Rust/SQLite 架构，以“个人资料 → 写作偏好 → 成果内修改 → 可验证引用”作为下一次 Product Beta 的主线。

实施顺序建议为：

```text
M0 当前基线与缺口确认
  → F0 小范围复用接口：解析、文档目标、存储访问
  → M1-A 个人资料库：导入、管理、搜索、Manifest
  → M1-B 成果真实生成与可替换 AI 接入策略
  → M2 写作偏好与统一 Prompt Composer
  → M3 Inline AI：可信选区 + 原地审阅
  → M4 引用：片段、请求映射、成果版本、来源预览
  → B0 Product Beta 集成验收
  → M5 持久检索 / 混合检索
  → M6 长文工作流
  → M7 主动审稿
  → M8 结构化文档
  → M9 场景工具
  → M10 协作与外部来源
```

AI 接入是产品策略选择，可采用内置默认服务、仅 BYOK、默认服务 + BYOK；已有本地模型能力继续保留。仅选定内置服务的版本才将其服务端联调列为发布依赖。用户现已选择 BYOK + 本地模型，详见 [接入决策](M1B_AI_ACCESS_DECISION.md)；本版本不能宣称“无需配置、开箱即用”。

### 1.1 风险分类与控制方式（依据本轮用户修订）

写作质量的不确定性是结构性的；交互方案和默认 AI 是可替换设计；文档定位存在格式差异，通过分级能力逐步解决。

| 类别         | 性质                       | 控制措施                                                                                                     | 验收和回退                                                                                              |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 模型质量风险 | 无法消除，但可测量、可控制 | 固定典型任务 Eval；事实保留、风格符合、长文一致性、引用准确率；模型按任务设最低门槛；Prompt 版本化及模型回归 | 未达门槛不声明支持该模型/任务组合；保留上一版模型配置/Prompt；回退不得静默改变资料接收方                |
| 交互方案风险 | 可替换设计                 | 先交付低风险 Inline Edit；Ghost Diff、inline replacement、track changes、hover accept 均为候选展示方案       | 用户在原地审阅、接受或放弃，不跳出写作流；用任务完成时间、交互次数、误接受/撤销和用户反馈决定保留或替换 |
| 外部能力依赖 | 可选择、可分级降级         | AI 接入策略与写作内核解耦；PDF 首期页级、DOCX 首期段落级；高级对象定位后置                                   | 按发布策略和格式能力矩阵验收；高级定位缺失不阻塞基础写作，基础定位不可用时明确降级，不伪造精度          |

最新用户要求优先于三份附件中的具体交互和AI 接入策略；附件原件与旧验收账本保持历史原貌。这里明确的是新实施约束，不代表已选定具体交互或服务供应商。

S4.8 签名与安装升级验收继续单独跟踪，不阻塞本地功能开发；也不能因 V2.x 功能完成就自动关闭旧发布阻塞。

## 2. 当前代码实际具备什么

以下为静态代码核对结论，不代表本轮已执行自动或桌面验收。

| 领域        | 当前实现及证据                                                                                                                       | 对本次升级的影响                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 技术栈      | `package.json`：React 19、TS 5.9、Vite 8、Ant Design 6、Zustand 5；`Cargo.toml`：Tauri 2、Rust 2021、rusqlite bundled、reqwest/tokio | 保持既有栈；近期不换编辑器框架、不增加独立后端运行时                                     |
| 前端边界    | `features/*` controller/store；`shared/platform/gateway.ts` 当前是 desktopApi 的轻量导出；Mock 分散在对应 feature/shared mock        | 扩展现有入口；不假设已存在完整的 `src/application/gateways` 目录或统一 WebMockGateway 类 |
| Rust 边界   | `commands.rs → application/* → repository/* / storage / workspace`                                                                   | 新领域沿现有方向增加；不搬迁全部目录来迎合参考文档                                       |
| 数据库      | `storage/mod.rs` 中 `SCHEMA_VERSION = 18`；0017 历史管理、0018 成果置顶                                                              | 新迁移从实施时最新版本顺延；现有 0001–0018 冻结                                          |
| IPC         | `commands.rs` 当前有 94 个 `#[tauri::command]`                                                                                       | 老文档中的 36/66 是历史口径；M0 应从实际注册、权限、Gateway 生成快照                     |
| 导入        | `application/import.rs` 做批次/检查/确认；`workspace/mod.rs` 提取 TXT/MD/DOCX/PDF；`document_source.rs` 解析 CSV/XLSX 和图片元数据   | 并不存在一个可直接复用的独立 Import Parser；需要先提取最小共用解析接口                   |
| 资料授权    | `workspace_files` / DocumentSource 属于 Workspace；Context Pack 是工作区内来源引用                                                   | 个人资料库需要独立应用级聚合，不能挂在某个虚拟 Workspace 下伪装全局资料                  |
| 上下文      | `ai/context.rs` 冻结 Prompt/Provider/来源 Hash，TTL 10 分钟、确认后一次消费；`application/context.rs` 规划时清空旧 pending manifests | 增加类型化来源解析；多请求要改成按操作隔离，不能直接开启并行章节生成                     |
| 检索        | `ai/retrieval.rs` 内存词法/BM25-like、中文 bigram；`application/search.rs` 每次收集成果/授权资料/资料包                              | 可复用排序；不能把内存块缓存等同于持久索引，也不能直接宣称支持千份资料低延迟             |
| 写作任务    | `application/task.rs::start` 使用 `local_scaffold`；架构测试明确禁止 Task 直连 Provider                                              | 长文编排不能只增加章节表；近期还需补真实生成用例及替换旧阶段约束测试                     |
| Result      | 五类 adapter、持久化、版本、导出、删除记录、置顶已存在；`ResultContentAdapter.tsx` 文档编辑基于 TextArea                             | Result 是近期写作主入口，需要补齐成果目标 Context 与 Inline 编辑接线                     |
| Result 助手 | `AppShell.tsx` 在成果模式渲染 `ResultAssistantPanel.tsx`，该组件仍是说明与 Empty 占位；文件模式才渲染 ChatPanel                      | 这是 M1-B 的实际产品缺口；必须接通成果助手，不能只验证文件工作台聊天                     |
| 文件编辑    | `EditorPane.tsx` 使用 Markdown 编辑器及 CodeMirror；`CodeEditor.tsx` 向外只回传选中文本                                              | 选区缺少统一可信位置快照；不能直接拿选中文本字符串作为精确写入授权                       |
| 选区助手    | `features/selection` 已有润色、缩短、专业、解释、提取、自定义；走 Modal → Manifest → Chat → Review                                   | 复用现有动作；补扩写/自然/语法/翻译和可替换的原地审阅，不另建聊天副本                    |
| 审阅        | `domain/review.rs` 已有 Low/Medium/High；`application/review.rs` 统一创建/决定/应用/撤销                                             | 无需重建风险枚举；新快捷路径必须增加 Rust 推导风险与选区限制，不能相信模型的 risk 字段   |
| 来源定位    | DOCX 当前主要提取文本、PDF 当前整体提取；检索块提供字符范围                                                                          | 不等于稳定页码/段落/表格 Locator；定位信息须在解析时保留                                 |
| 发布        | S4.7 历史账本已验收；S4.8 非签名项待人工验收、正式签名材料缺失；O-08 默认 AI 未解决                                                  | 本次不能沿用旧测试数量或旧包 Hash 宣称当前 HEAD 可发布                                   |

当前结构热点约为：`storage/mod.rs` 5763 行、`commands.rs` 1830 行、`application/chat.rs` 1719 行、`workspace/mod.rs` 1219 行。它们提示后续扩展应有边界，但不构成一次全量重构的理由。

另一个重要限制：旧架构文档部分段落仍写 schema v16、尚无历史管理或旧 UI 状态；最新账本已到 LOG-0204。事实优先采用当前代码和对应的较新记录，历史验收表保留其历史含义。

## 3. 对三份输入文档的具体调整

| 原建议                               | 本计划采用的修正                                          | 原因                                                                      |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| 直接新增 Knowledge Parser/Repository | F0 先提取解析结果接口及受限数据库访问入口                 | 现有解析跨三个文件；Repository 多为 Storage 包装，数据库连接是私有 Mutex  |
| `0019…0024` 六个迁移覆盖全部路线     | 将编号视为示例，按落地顺序追加                            | Inline 审阅扩展、引用映射持久化、持久词法索引、任务运行记录也可能需要迁移 |
| Profile 后者覆盖前者                 | 仅写作偏好按层覆盖；系统权限与安全策略不可覆盖            | “当前用户指令优先”不能被解释成覆盖应用安全边界                            |
| Inline 低风险走 Ghost Diff           | 原地编辑是目标，Ghost Diff 是可替换的 Review 展示方案     | 保留统一 AI 写入、审计、冲突、Revision、Undo 语义                         |
| M4 才考虑 Fragment                   | F0/M1 保存解析结构和版本，M4 再建立正式 Fragment/引用服务 | 避免首次导入把 PDF 页码、DOCX 段落等信息永久压平                          |
| 引用中直接使用 Knowledge/Fragment ID | 采用工程文档建议的请求级 `S1/S2` 映射                     | 映射必须绑定 request/manifest，不能跨请求复用 S1                          |
| Verified Citation                    | UI 表达为“来源已核验”，另行评估是否支持该断言             | ID/授权/Hash 正确只证明来源链，不证明事实或推理正确                       |
| 开箱即用作为 Provider 小扩展         | 先选接入策略；内置服务方案才拆出服务端交付                | 默认服务是可选产品策略；BYOK 发布不依赖平台服务端                         |
| 每阶段可回滚                         | 功能可关闭，数据库只前向迁移                              | 当前旧客户端会拒绝较新 schema，不能承诺升级后随意降级二进制               |

这些是待实施时形成 ADR 的工程建议，不把附件中的“必须执行”“等待验收”等语句当作本轮的执行授权。本轮不修改旧验收状态。

## 4. 目标架构与目录落点

```text
React 页面 / 编辑器适配器
  → feature controller / store
  → shared/platform/gateway.ts + desktop.ts
  → Tauri command / capability
  → Rust application service
      → SourceResolver / PromptComposer / Review policy
      → domain + repository
      → SQLite / managed files / 现有 Provider transport
```

优先增加以下模块；只有职责增长后才把单文件变成目录：

| 新能力        | 前端落点                                                        | Rust 落点                                                                    |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 个人资料库    | `features/knowledge/`                                           | `domain/knowledge.rs`、`application/knowledge.rs`、`repository/knowledge.rs` |
| 共用解析      | 复用 `features/imports/` 批次 UI                                | `document/parser.rs` 及按格式实现；原有调用方保留兼容适配                    |
| 文档/选区目标 | `features/selection/` 的 editor adapter；接入 results/workspace | `domain/document_target.rs`、`application/document_target.rs`                |
| 写作偏好      | `features/writingProfile/`                                      | `domain/writing_profile.rs`、同名 application/repository、`ai/prompt.rs`     |
| Inline        | 扩展 `features/selection/`，复用 `features/diff/`               | `application/inline_edit.rs`，扩展既有 Review/Patch                          |
| 引用          | `features/citation/`                                            | `domain/citation.rs`、同名 application/repository、fragmenter                |
| 长文与审稿    | 后续 `features/writingProjects/`、`features/critic/`            | 同名 domain/application/repository                                           |

DTO 继续与 `shared/types/domain.ts`、`shared/contracts/guards.ts` 和共享 JSON fixture 配套。可按新增领域拆类型文件并从原入口 re-export，避免一次移动全部旧类型。新 fixture 可使用 `contracts/v2x/`，同时显式接入 Rust/TS 测试和证据审计，不假设新目录自动被扫描。

## 5. M0：冻结可复现的当前基线

状态：已完成人工验收。用户明确回复“测试通过，开始下一阶段”，授权进入 F0。执行记录见 [M0_EXECUTION.md](M0_EXECUTION.md)，历史结果见 [V2_BASELINE.md](V2_BASELINE.md)。M0 的 E2E 崩溃历史记录保留，不因人工通过改写成自动测试全绿。

| 工作包 | 实施内容                                                                                      | 交付 / 退出条件                                                 |
| ------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| M0-01  | 记录 HEAD、干净/已有差异、schema、94 个命令及实际注册、capability、协议、Provider、搜索模式   | `docs/V2.X/V2_BASELINE.md`；不把本规划稿冒充测试基线            |
| M0-02  | 当前 HEAD 执行前端、Rust、Mock E2E、desktop build/smoke；覆盖 v17/v18 历史管理和置顶          | 每项有结果、环境、失败/重试信息；已有缺陷单列                   |
| M0-03  | 回归导入 → Manifest → Provider → Review → Apply → Revision → Undo → Export                    | 虚构资料、测试 Provider；Windows 实测与 Mock 证据分别记录       |
| M0-04  | 形成下列 ADR：全局资料生命周期、解析契约、Result/选区目标、Inline 策略、引用分级、AI 接入策略 | 记录建议/决定/开放项；不重写历史验收记录                        |
| M0-05  | 将 S4.8、O-06、O-08 放入独立发布依赖清单                                                      | 按选定策略标明适用范围、负责人和关闭点；O-08 仅阻塞内置服务方案 |

M0 不替换编辑器、不大规模重写 Storage/Review、不新增业务表。资料库等实现从通过基线的提交开始。

## 6. F0：只做新功能必需的复用接口

状态：用户已确认 F0 产品验收通过并授权 M1-A。F0-01/02/03 代码及历史验证见 [F0_EXECUTION.md](F0_EXECUTION.md)；原生工具异常继续由代理跟踪，最新验证见 [M1A_EXECUTION.md](M1A_EXECUTION.md)。

**F0-01 共用解析。** 从现有代码提取 `ParsedDocument { format, parserVersion, rawHash, extractedHash, blocks, warnings }`。Block 保存文本及可用 locator，尚不能可靠定位时使用明确的 `unavailable`。Workspace 导入和 Knowledge 导入复用同一检查/解析实现。先用现有 fixture 保证文字、限制、错误行为不变，再加入结构信息；不复制 PDF/DOCX/XLSX 解析器。

**F0-02 数据访问。** 为新 Repository 增加 crate 内受限的读连接/事务回调或等价接口，由 Storage 管理锁、连接和迁移。新 SQL 放在领域 Repository。不要把 Connection/Mutex 暴露给 commands，也不要在数据库锁内执行网络或大文件解析。旧表和旧 Repository 暂不全量搬迁。

**F0-03 文档目标。** 定义 `DocumentTarget = WorkspaceFile(sourceId, workspaceId) | Result(resultId)`，Rust 根据不透明 ID 解析权限、格式和实际写入位置。定义 `DocumentSnapshot/SelectionSnapshot`，至少携带基础 revision/hash、选区范围、选区正文 hash。禁止把任意绝对路径作为新目标协议。

前端 editor adapter 统一读取选区位置、正文快照、显示提案和接收权威写入结果。首先覆盖 Result TextArea 与文件 CodeMirror/Markdown 源码编辑；Markdown 预览 DOM 的选中范围若不能准确映射回源码，不能进入快捷写入，应引导到编辑模式。

退出：旧导入/读写/选区回归不变；新增接口有合同；尚不改变用户 AI 操作流程。

## 7. M1-A：个人资料库

状态：已实现，工程检查完成，用户产品验收通过，并授权 M1-B。范围、限制、验收版本及验证条件见 [M1A_EXECUTION.md](M1A_EXECUTION.md)。

本阶段按用户验收反馈追加资料库与资料包整合：统一入口下提供“全部资料 / 资料包”，包可混合引用个人资料及当前工作区资料，保留所属工作区与发送前确认。schema 20；整合版工程验证完成，仍待产品验收。

### 7.1 数据与存储

个人资料属于本地应用实例，独立于 Workspace，不先引入不存在的云用户身份系统。

建议首批模型：

```text
KnowledgeSource
  id, title, format, originalName, mimeType
  managedRef, rawHash, extractedHash, parserVersion, sourceVersion
  status, createdAt, updatedAt
KnowledgeTag / KnowledgeSourceTag
KnowledgeImportJob（若需持久崩溃恢复）
```

`managedRef` 是 Rust 内部相对引用，不向前端返回真实路径。沿用 `app.path().app_data_dir()` 和既有产品技术身份，新增 `knowledge/sources/<uuid>/`，不因文档中示例 `AppData/A2UI` 改动应用数据根目录。

导入先检查和预览，确认后复制到受控 staging，解析、计算 Hash，再提交 DB 与文件。SQLite 与文件系统不能天然构成同一事务，需要明确持久意图、原子 rename、补偿及启动对账。外部观察只出现完整 ready 来源，取消/失败不留下可用的半条资料。

同内容重复导入默认提示复用已有记录；第一版可不做跨来源物理去重，避免引用计数和删除复杂度。后续“更新资料”显式导入新版本，不静默跟踪或扫描原文件。

### 7.2 工作包

| ID   | 内容与主要文件                                                                          | 验收                                                                  |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| K-01 | 新迁移、knowledge domain/repository/application；稳定排序和游标分页                     | 新装与 v18 升级；删除 Workspace 不级联删除个人资料                    |
| K-02 | 扩展 Import 目的地：workspace / knowledge；Dialog 和原生拖入都走 Rust 受控路径          | 取消零导入；复制后原文件移走，资料仍可使用；恶意包与超限拒绝          |
| K-03 | 六种格式、管理副本、解析缓存、崩溃对账和重复检测                                        | MD/TXT/DOCX/PDF/CSV/XLSX 各有正反例；扫描 PDF 明确不支持 OCR          |
| K-04 | `KnowledgePage/List/Preview/ImportDialog/TagEditor`、controller/store、路由及中英文文案 | Loading/Empty/Importing/Failed/Ready/删除确认；键盘、暗色、护眼模式   |
| K-05 | `SearchItemKind::PersonalKnowledge`，搜索结果按 ID 打开；复用现有词法排序               | 从首页/命令面板搜到资料；取消导入和删除资料不可搜到                   |
| K-06 | `ContextSourceKind::PersonalKnowledge`；类型化 SourceResolver 在规划和消费时复核        | 未勾选不发送；更新/删除使旧 Manifest 失败；跨工作区可显式使用同份资料 |
| K-07 | 扩展 clear-all、recovery、诊断计数、隐私说明                                            | 清除管理副本和新表/缓存；保留用户原文件、my-results、导出文件         |

首批建议 IPC：`list/get/rename/delete_personal_knowledge`、`set_personal_knowledge_tags`；导入复用批次 inspect/confirm，并增加 purpose。统一搜索复用 `search_authorized_content`，只有资料库分页搜索确有不同需求时再增加专用命令。

### 7.3 生命周期和隐私

- “存入资料库”授权本地管理、解析、搜索，不等于允许发送云端。
- 搜索仅提供候选，生成前将具体来源、处理位置、预计发送量放入 Manifest。
- source binding 从当前 `(sourceId, hash)` 扩展为带 kind/version 的可信引用；不能继续只查询 `workspace_file_by_source`。
- 删除先撤销可用性并使 pending Manifest/缓存失效，再清理副本；文件被占用时显示待清理并可重试，不假报删除完成。
- 正在执行的请求尝试取消、阻止后续发送；已经发给 Provider 的内容不能声称已远程撤回。
- 新清理逻辑只删 Knowledge 自有目录，校验规范化目标、junction/symlink 越界；不复用“删整个 app data”操作。
- 第一版先在内存索引中复用已提取内容，避免每次搜索重新解析 Office；M5 才引入持久全文索引。

退出用户故事：导入一次 → 重启 → 切到另一 Workspace → 搜索并选取 → Manifest 确认 → 配置好的 Provider 使用资料；删除副本后原文件仍在。

## 8. M1-B：真实成果生成与可替换 AI 接入

状态：用户已授权并实施，工程验证及阶段门见 [M1B_EXECUTION.md](M1B_EXECUTION.md)。采用 BYOK + 本地模型，不启动内置服务端；交付后等待产品验收，不进入 M2。

### 8.1 先补完整的生成应用服务

新增或提取可信 `GenerationApplicationService`，复用现有聊天传输的连接、SSE、停止、超时、错误映射；以已经确认的 Manifest 和可信任务配置为输入，向 Chat / Task / Inline 提供受限调用入口。

普通写作闭环：选任务和 Result 目标 → 规划资料 → 确认 → Provider 生成候选 → Review → 建立或更新 Result。不得把模型正文直接塞进 `save_result_document`，伪装成人工编辑绕过审阅。

将 `ResultAssistantPanel` 的占位内容替换为复用聊天组件/状态能力的成果助手，显式绑定 Result 目标；从 Result 新建/重开进入时可选择资料、提交目标、查看提案并继续修改。不复制整套 ChatPanel，也不自动授权发送整份成果。现有 Manifest 强制 session/workspace，第一版可为成果解析出所属 Workspace 并使用受控会话，避免误用当前另一个工作区的 active session。

当前 `task_orchestrator_does_not_bypass_the_unresolved_model_boundary` 测试将与新需求冲突。保留“离线结构草稿不调用模型”测试，新增“AI 模式必须消费有效 Manifest、取消不写入、结果必须 Review”的行为测试；不要简单删除安全门。

### 8.2 接入策略与客户端内核解耦

| 发布策略        | 必须完成                                                     | 依赖范围                                                            |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 内置默认服务    | 真实服务、身份/额度/限流、数据处理说明、客户端联调           | 默认服务端是发布门；BYOK 配置不是默认生成的必经步骤                 |
| 仅 BYOK         | 安全凭据配置、连接检查、模型能力提示、失败恢复、真实成果闭环 | 不依赖平台默认服务的采购、部署与额度系统                            |
| 默认服务 + BYOK | 两条路径及用户主动切换；切换后重新核验发送范围               | 两条声明支持的路径分别验收；任一路径故障不得自动外发到另一 Provider |

默认服务是可选 Adapter，不能成为 GenerationApplicationService、Task、Inline 或 Citation 的构造前提。下表服务端任务仅在选定内置服务的发布方案中生效。

| 客户端                                                                | 服务端/运营依赖                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| 扩展已有 `ProcessingOptions/ProcessingAvailability`，不重复建等价枚举 | 明确模型供应、服务部署、服务身份/会话机制              |
| 默认 / BYOK / 本地三条路径共享 generation service 和 Manifest         | 服务端保存上游凭据，提供限额、限流、滥用防护、费用边界 |
| 额度耗尽、登录/服务异常、断网的可理解状态和重试                       | 数据处理说明、保留策略、错误映射及服务故障处理         |
| 更换服务或本地/云端时失效旧发送确认，不静默切换                       | 真实端到端联调、可观测性、服务停用与应急流程           |

不把平台通用 API Key 打进桌面包。默认服务选择和预算尚未知，不在本计划指定厂商或价格。原仓库暂无独立服务端部署单元；若采用内置服务，在 ADR 决定是否另建仓库。O-08 原始状态保留；若选择仅 BYOK，通过新 ADR 将其从该版本发布依赖中移出，而非声称已经实现默认服务。

退出：选定接入策略下真实 Result 生成闭环可用，错误和恢复通过验收。Product Beta 按已选策略验收；默认路径只有真实服务联调通过才标完成，BYOK 版本明确说明配置要求。

## 9. M2：Writing Profile 与 Prompt Composer

状态：工程验证完成，待人工验收；依赖 M1-A/M1-B 共用生成边界。预计 5–8 人日。

| ID   | 工作                                                                      | 验收                                                                    |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| W-01 | Global / Workspace Profile、version、规则、术语、禁用词、范文引用及新迁移 | 修改/删除/重启/清除持久化正确；Workspace 删除不损坏 Global              |
| W-02 | `ai/prompt.rs` 接收系统策略、写作偏好、任务、Manifest、当前指令           | 写作默认 < Global < Workspace < Task < 当前指令；安全策略独立且不被覆盖 |
| W-03 | 所有生成入口使用同一 Composer                                             | Chat、Task、Inline 不各自拼一份规则；现有 A2UI/Review 输出协议不退化    |
| W-04 | 写作方式设置页、项目覆盖、术语编辑、启用/禁用、有效规则预览               | 用户知道本次采用哪套偏好；第一版仅手动编辑                              |
| W-05 | `evals/style`、术语和指令覆盖 fixture                                     | Profile ON/OFF 固定任务可观察；显式反向指令优先                         |

Profile 不是隐形资料通道：范文只保存 Knowledge 引用，正文需进入本次 Manifest；规则本身也应作为可见的 writing-instruction snapshot 参与请求摘要、敏感检查和 token 预算。记录 profile id/version/hash，使清单确认后偏好变化可检测并重新规划。

任意自由文本规则不能升格为系统权限。对“简洁”等偏好合并做确定性结构处理；“模型一定遵守风格”由 Eval 测量，不用字符串拼接单测替代质量评估。

退出：同一任务开关 Profile 有可解释差异；范文未授权不出现在 payload；当前指令覆盖长期风格；修改偏好后旧请求不偷偷使用新规则。

## 10. M3：Inline AI 与风险自适应审阅

状态：工程实施完成，待人工验收；依赖 F0 文档目标、M2 Composer。未收到明确授权前不进入 M4。

### 10.1 一套写入内核，两种审阅展示

```text
SelectionSnapshot + action + 有效 Manifest
  → Rust 生成提案并重新判定实际风险
  → 低风险：编辑器内 Inline Edit 审阅（可替换展示）
  → 中/高风险：完整 Review UI（高风险增加明确确认）
  → 用户接受
  → 同一 Review / Patch / Revision 内核
```

未实现的危险 Action 继续拒绝；不能因为存在“高风险确认”就开放 Shell、任意外部发送等新权限。

产品要求是“低风险编辑必须在原地完成，且不跳出当前写作流”。首轮可用 Ghost Diff 验证；inline replacement、track changes 或 hover accept 可通过 editor adapter 替换，均须在接受前提供可审阅候选，并保留显式接受、放弃、键盘可用和撤销。提案协议、风险判断、Review/Revision 与数据库不依赖展示方案名称；替换 UI 不重建安全内核。

### 10.2 工作包

| ID   | 工作                                                                              | 验收                                                                 |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| I-01 | 在 Result 文档和文件编辑器中接通 F0 SelectionSnapshot                             | 中文、emoji、CRLF、重复段落、空选区定位一致；源码/预览模式不混用     |
| I-02 | 在现有 Review 上增加 inline mode、目标、选区约束和 request 绑定；必要时新增关联表 | 低风险只允许单个文本目标、单个连续选区、允许动作和受限大小           |
| I-03 | Rust 生成可信替换操作，不接受模型指定其他路径/offset/risk 作为授权                | 模型即使返回 `risk=low`，越界/新文件/多目标仍拒绝快捷应用            |
| I-04 | Inline Edit：生成中、接受、再生成、放弃、冲突；首轮可试验 Ghost Diff              | 不要求先换富文本编辑器；提案展示不改变真实编辑正文                   |
| I-05 | 接受时合并决定和应用用例，复用已有审阅内核及幂等键                                | 双击只产生一次应用；失败保留候选；接受后形成 Revision、Undo 可用     |
| I-06 | 切换文档、工作区、Result、Provider、清除数据、取消/再生成时隔离旧响应             | 使用 operationId + target + generation epoch；迟到响应不能覆盖新状态 |

**偏移约定：** IPC 明确 UTF-16 或统一字符坐标，Rust 显式转换并校验字符边界；不要直接把 JS selectionStart 当作 UTF-8 byte offset。范围必须在可信基础快照内，重复文本不能仅用字符串第一次命中定位。

**未保存内容：** 第一版采用“先安全保存/等待在途保存完成 → 固定基础版本 → 生成”。保存冲突即停止。生成后用户继续编辑会使 proposal 过期；接受前重新核验当前缓冲区与磁盘 Hash，禁止把旧提案覆盖到新草稿。以后若要支持草稿原生 Inline，再单独设计草稿版本协议。

**一次生成 + 一次接受：** 普通选区且当前发送范围已展示/获准时，生成按钮可以同时表达本次明确发送意图，Rust 仍执行 plan/confirm/consume；初次云端授权、新增资料、切换处理位置或敏感内容需要额外确认。这些例外必须在 UX 验收中写清楚，不能为了两次点击取消 Manifest。

退出：从 Result 和文件编辑器分别完成选中 → 润色 → 原地审阅 → 接受 → 一个新版本 → 撤销；无需跳到聊天或独立审阅页面。再生成/放弃不增加文档 Revision；越界修改和伪造风险无法走快捷入口。用相同典型任务比较现有流程与候选交互的完成时间、点击次数、误接受/撤销和主观中断感，决定保留或替换；测量采用用户测试或自愿开启的本机事件，不新增默认上传。

## 11. M4：可定位资料与可信引用

状态：待开始；依赖 M1 资料、F0 解析结构、生成请求快照。预计 10–15 人日。

### 11.1 分成三层数据

```text
KnowledgeSource(version, rawHash, parserVersion)
  → KnowledgeFragment(id, contentHash, locator, position)
  → RequestCitationMap(requestId, manifestId, S1 → fragment/version/hash)
  → CitationReference(resultRevisionId/messageId, range/anchor, key, status)
```

只建 `knowledge_fragments` 表不足以支持重启、聊天删除后 Result 独立引用、Revision 恢复和导出。需持久化请求级映射及输出引用，明确引用归属；不能仅依赖 10 分钟内存 Manifest。

### 11.2 工作包

| ID   | 工作                                                                   | 验收                                                                 |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| C-01 | MD/TXT 结构分块；DOCX 段落；PDF 页；CSV/XLSX sheet/range               | Locator 指向管理副本中真实位置；无可靠定位时显式降级，不编造页码     |
| C-02 | 旧 Knowledge 按 parserVersion 后台补提取/分块；可取消、断点恢复        | 失败保留原件、状态可见；不在数据库迁移中同步解析全部文件             |
| C-03 | Manifest 包含实际发送片段，并生成 request-scoped S1/S2                 | 被截断/预算排除/未选择片段不得拥有可验证引用                         |
| C-04 | Parser/Validator 校验 key、request/manifest、授权、sourceVersion、Hash | unknown/stale/unauthorized/verified 分开；伪造及跨请求 ID 拒绝       |
| C-05 | 来源徽标、预览、打开受控来源；Result 与消息都接入                      | 一到两次操作看到原文；不是任意 URL/路径打开能力                      |
| C-06 | Revision、手工编辑、Inline、复制、恢复、导出时携带或失效引用           | 引用不因文本偏移仍显示在错误句子上；聊天删除不破坏独立 Result 的映射 |

### 11.3 格式定位能力分级

| 格式           | 首期基础定位                                                 | 后续增强                              |
| -------------- | ------------------------------------------------------------ | ------------------------------------- |
| PDF 文本层     | 页级：页码及对应页原文，可展示已核验摘录                     | 段落、坐标框、版面与 OCR              |
| DOCX           | 段落级：管理副本中的解析段落序号与正文，不承诺 Word 分页一致 | 表格单元格、文本 run、Word 对象级定位 |
| Markdown / TXT | 标题或行范围及原文                                           | 更细结构节点与字符定位                |
| CSV / XLSX     | 工作表（如适用）及行列范围                                   | 合并单元格、公式与复杂布局语义        |

PDF 页级与 DOCX 段落级是对应能力声明的基础验收门，高级定位不阻塞主流程。PDF 按页提取先验证现有本地依赖，不能从全文换行反推页码。某个文档无法可靠达到基础粒度时，可继续作为明确标注限制的只读资料/来源级引用使用；只核验来源身份、版本和授权，不宣称该精确位置已核验。扫描 PDF 沿用“需要 OCR”的能力提示，不假装完成正文提取。

发布前覆盖六种格式的能力矩阵：支持的基础粒度通过定位验收，不支持或异常资料通过降级路径验收；不要求所有格式在同一版本达到高级定位精度。

### 11.4 引用生命周期

- “来源已核验”只证明真实来源、请求授权和版本一致；断言是否得到原文支持由人工检查和 Citation Eval 单独衡量。
- 更新资料使旧版本引用显示 stale；若没有保留该版原文，就不得假装能定位到当前内容。
- 删除资料：保留成果既有文字及最小失效引用标记，删除可读取的来源副本/片段/索引，预览明确不可用。既有成果/聊天可能已包含摘录，删除说明要告知这些独立产物不会被自动改写。
- 手工改写被引用语句、Inline 改写或版本恢复后重新绑定/验证，不能无条件继承 verified。
- 导出绑定同一 Result Revision，至少提供可读来源标题/定位的尾注或来源列表；不导出绝对路径、内部 request ID。富 Word 脚注样式可以留待 M8。

退出：导入资料 → 授权生成 → 引用原文预览 → 保存/重启 → Result 重开 → Inline 修改 → 版本恢复 → 导出，引用状态均可解释；不存在伪造引用显示为来源已核验的路径。

## 12. 数据库演进与恢复计划

编号只在实现时确定。当前可从 0019 开始，但不预先锁死后续序号。

| 顺序建议 | 迁移主题                                                           | 关键约束                                                   |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| 第一批   | personal_knowledge、tags、import jobs                              | 应用级归属；Hash/状态约束；全局资料不被 Workspace 级联删除 |
| 第二批   | 写作偏好、规则、版本；必要的 generation runs                       | Global/Workspace 唯一性；运行状态与请求幂等                |
| 第三批   | Inline Review 关联 / selection snapshots                           | 复用 review id；绑定基础版本、范围、目标；不能重启自动应用 |
| 第四批   | fragments、request citation map、output citations                  | 引用输出版本；来源删除后可保留最小 tombstone，正文清理独立 |
| 第五批   | persistent lexical index / index jobs                              | 可重建派生数据；重建失败不破坏原资料                       |
| 后续     | embeddings、writing projects、critic findings、document structures | 每批独立状态机、迁移与清理测试                             |

每次迁移更新 `SCHEMA_VERSION/MIGRATIONS`，覆盖新装、所有历史版本升级、失败回滚、外键、旧数据保留和 clear-all。昂贵文件转换/Embedding 在迁移提交后走可恢复后台任务，不持有 SQLite 迁移事务等待网络。

关闭功能开关只关闭入口/任务调度；入口背后的 Rust 校验始终存在。回滚优先发布支持新 schema 的修复版本，或在明确接受新数据损失后恢复一致的数据库与管理文件备份；不自动降级、不仅恢复一个正在 WAL 写入中的 `.sqlite3` 文件。

## 13. M5–M10 后续规划

| 阶段          | 前置条件                                         | 工程切片                                                                                                          | 完成标准                                                                      |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| M5-A 持久词法 | M4 稳定片段和生命周期                            | 先验证当前 bundled SQLite 的 FTS5；比较中文 tokenization 与既有 bigram；增量 insert/update/delete、索引版本、重建 | 重启不全量重建；删除立即不可命中；100/1000 来源、10000 fragments 基准可复现   |
| M5-B 混合检索 | 词法基准与标注检索集                             | EmbeddingProvider、本地/云端明确选择；模型/版本/维度/content hash；融合排名，复杂 rerank 后置                     | 在固定集上优于词法且费用/延迟可接受；失败可退回词法                           |
| M6 长文项目   | M1-B 真实生成、M2、M4；M5 按资料规模决定是否必需 | project/outline/sections/runs；用户确认大纲；逐章节生成；取消/恢复/幂等；章节事实摘要                             | 恢复不重复收费式自动重发、不重复写入；每章有来源和审阅；组合为单个最终 Result |
| M7 主动审稿   | 文档快照、Profile、Citation                      | 先本地术语/长度/标题/引用规则，后可选 LLM 逻辑/重复/风格；findings 绑定 revision                                  | 只提示；用户选择修改后进入 Inline/Review；文档更新使旧 finding 失效           |
| M8 结构化文档 | 文本写作闭环和新编辑器 ADR                       | 平台无关 AST、稳定 block ID、编辑器 adapter、Patch V2、Revision、DOCX/MD import/export                            | 有限格式保真矩阵；PDF 只读来源；不承诺完整 Office round-trip                  |
| M9 场景工具   | 有明确用户流程                                   | 复用已有 20 个组件与 3 个 Action，做发布检查表/采访提纲/审核器模板                                                | 真实输入、状态、Result、保存/导出；需要新能力时才增加 Catalog                 |
| M10 协作生态  | 单用户产品验证成功                               | 身份、ownership、分享权限、同步/冲突/加密/审计 ADR；外部 Source Adapter                                           | 连接器数据也经过权限快照、Retrieval、Manifest；不直接给模型账号权限           |

Embedding 云端调用本身也是资料发送，必须有独立可见授权/发送计划并纳入统一外发边界；不能仅在最终写作请求时确认。未授权资料应在召回前过滤，Top-K 入 Manifest 前再复核，避免只在最后过滤造成侧信道或结果不足。

M6 第一版串行章节即可。当前 `application/context.rs::plan` 会清空所有待确认清单，必须先改成按请求/任务隔离、有 TTL 和容量限制的 registry，才可安全支持 Chat、Inline、Critic 或多个章节并行。

M5-A 与长文“必须串行”的关系不应机械化：小资料库可以先试验 M6；但不得把尚未验证的大规模检索性能作为长文能力的已知前提。M8 与 M9 可在后续规划时按真实需求调整优先级。

## 14. 验证与发布门

### 14.1 每个切片的完成定义

领域/状态机 → 迁移/Repository → Rust application → IPC/权限 → Gateway/DTO → UI → 自动验证 → Windows 人工验收 → 更新阶段记录。

按风险执行相关测试；里程碑退出运行完整质量门。新增命令同步更新 `build.rs`、`lib.rs`、`capabilities/main.json`、生成权限、`command_registration.rs`、前端适配和合同 fixture。

```powershell
npm run check
npm run test:coverage
npm run test:e2e
npm run audit:beta-evidence
npm run audit:third-party
npm run audit:release
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
npm run tauri build -- --debug --no-bundle
./scripts/smoke-desktop.ps1 -BinaryPath ./src-tauri/target/debug/a2ui-terminal.exe
```

已有 beta evidence 主要覆盖 V2，需要新增 V2.x 需求映射及真实验收材料，不能仅重复执行旧脚本就认定新需求覆盖完整。Web Mock 负责 UI/合同，Rust 负责数据与授权，真实 Windows 负责文件、WebView、凭据、安装/升级，真实 Provider 测试负责模型效果和服务边界。

### 14.2 必须覆盖的故障与安全场景

| 面       | 必测情形                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| 导入     | 取消、重复、源文件确认前变更、解析失败、磁盘满、文件已复制但 DB 未提交时崩溃              |
| 全局资料 | Workspace 删除不删资料；资料删除不删原文件；ID 伪造；撤销后旧 Manifest 不可发送           |
| Profile  | 未授权范文、规则变更后的旧清单、当前指令覆盖、过长规则挤占预算                            |
| Inline   | 选区外/多文件提案、重复文本、UTF-16/UTF-8、草稿/自动保存竞争、双击接受、迟到流、Undo 冲突 |
| Citation | 不存在 key、跨请求 key、来源删除/更新、结果编辑/复制/恢复、删除会话后重开 Result          |
| 迁移清理 | v18 → 最新、新装、失败回滚、未来 schema 拒绝、全部新表/副本/索引清理、真实成果文件保留    |
| Provider | 未配置、鉴权失败、限流、首字超时、流中断、取消、切换服务后确认失效                        |
| 发布     | 干净安装、上一版本升级、正常卸载保留、签名/更新验证；旧安装包 Hash 不当作新版本证据       |

### 14.3 AI 质量评估

M2 就建立 `evals/`，M3/M4 持续补全，M6 扩到长文。使用固定虚构/授权测试资料，记录模型、参数、Prompt 版本和重复次数；真实 Provider Eval 是显式运行的独立门，不在普通离线 CI 中隐式外发或消耗费用。

Eval 同时固定任务类型、输入上下文、检索结果或索引版本，区分模型、Prompt、检索与资料质量的变化。每例记录 dataset/case 版本、预期事实、风格规则、可用证据和评分方式。

| 指标       | 评分口径                                                           | 准入使用方式                                                |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 事实保留   | 必须保留事实的正确保留比例，另统计事实改错/新增无依据断言          | 按改写、总结等任务设最低门槛；关键数字/否定关系错误单列阻断 |
| 风格符合   | 可机械检查的术语/禁用词合规率，加固定量表盲评                      | Profile ON/OFF 对照；不能以风格为由降低事实保留要求         |
| 长文一致性 | 固定检查项中的术语、事实、章节关系一致率及矛盾数量                 | M6 上线前启用，不用短文本成绩推断长文能力                   |
| 引用准确率 | 引用中由所指原文真正支持的比例，另统计来源链校验和应引用事实覆盖率 | 不允许通过完全不引用获得高分；来源存在不等于支持断言        |

按“Provider/模型版本 × 任务类型 × Prompt 版本”建立准入矩阵：首次基线后、发布评测前冻结最低门槛和回归容差，记录样本量、重复试验波动及人工复核。模型、Prompt、Composer、检索或上下文策略变化均跑相关回归，不在失败后临时降低门槛。BYOK 自定义模型可显示“未验证”，不得暗示所有模型均达到同一质量。

失败时可恢复上一版 Prompt/配置、限制该模型的任务能力，或由用户选择其他已验证模型。无法固定远端模型版本时记录别名与评测日期，不保证服务端可回滚；Provider 或处理位置变化仍须重新确认，禁止静默转发。验收百分比是明确测试集的通过率，不能转述成“95% 概率满足全部预期”。

建议首批 40–60 个用例，覆盖中文为主的术语/风格/事实保留，以及数字、人名、日期、否定语句、引用误配、恶意文档指令和选区越界。硬性安全断言要求全部通过；风格/事实支持等主观项使用盲评及固定量表，在 M0/M2 样本基线后确定阈值，不预先虚构模型质量百分比。

### 14.4 性能预算（待基准验证的目标）

- 继承首页可交互 ≤2.5 秒、普通文本成果打开 ≤1 秒、操作反馈 ≤300ms 的现有目标；真实 WebView2 与 Mock 分开测量。
- Knowledge 列表后端分页，初始页建议 40 项；不是读全量再只渲染 40 条。
- 1000 来源 / 10000 fragments 下，M5-A 热查询 p95 可先以 ≤300ms 为目标；M1 若达不到必须公开规模限制或提前 M5-A。
- Inline 区分本地反馈、规划耗时、Provider 首字、完整生成、应用耗时，不能把本地 300ms 反馈写成模型完成时间。
- 大文件解析/索引放在有界后台任务；不占 UI 线程，也不长时间持有单个数据库连接锁。

## 15. 排期、发布切片与依赖

估算是假设一位熟悉本仓库的开发者可完成 Rust + React 的净实施工作量，包含相关测试和修复，不含等待签名、真实模型服务商务决策及用户验收排队。不是交付承诺。

| 阶段        | 人日范围 | 可评审交付                      |
| ----------- | -------: | ------------------------------- |
| M0          |      3–5 | 可复现基线、差距与 ADR          |
| F0          |      4–6 | 最小解析/存储/文档目标接口      |
| M1-A        |    10–15 | 可跨工作区使用的资料库          |
| M1-B 客户端 |      4–6 | 真实成果生成、可替换接入        |
| M2          |      5–8 | 写作偏好、Composer、首批 Eval   |
| M3          |     8–12 | Result + 文件编辑器 Inline 闭环 |
| M4          |    10–15 | 分级定位、引用与版本链          |
| B0          |      4–6 | 全链集成、性能和桌面验收        |
| 合计        |    48–73 | 不含独立默认 AI 服务端          |

单人顺序实施约 10–15 个工作周，再预留 20% 左右不确定性；团队规模变化需重新按依赖和人力排期，不能简单除以人数。仅当发布策略包含默认服务时，其服务端可暂按 15–25 人日粗估，身份/付费/运营要求变化会显著改变范围，应单独评审。

建议发布切片：

| 切片                        | 范围                                                        | 对外表述                                     |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Internal Alpha              | M1-A + 真实生成入口 + M2；使用已配置 Provider               | 验证资料复用和风格，不宣称无需配置           |
| Product Beta                | M1-A/M1-B/M2/M3/M4 + B0（按选定 AI 策略与定位能力分级验收） | 资料、风格、原地修改、来源的完整个人写作闭环 |
| Professional Beta           | M5/M6/M7                                                    | 大资料检索、长文与审稿                       |
| Structured Document Preview | M8                                                          | 明确格式支持矩阵的结构化文档                 |

版本号暂不在本轮改动。内部里程碑与公开版本号分开，签名发布前统一 package/Cargo/Tauri 三处版本及技术身份合同。

## 16. 待决定事项与推荐默认值

这些事项不阻止本轮计划完成；在相应实现阶段关闭即可。

| 事项                  | 建议                                                                       | 最晚时间 / 负责人                                                                       |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AI 接入策略与费用边界 | 内置默认服务 / 仅 BYOK / 默认服务 + BYOK；本地能力保留                     | M0 选择策略；仅所选方案需要的服务在发布前联调；产品/服务端                              |
| Inline 首发范围       | 文本 Result + 已授权文本文件；表格/结构化内容仍完整 Review                 | F0/M3；产品/客户端                                                                      |
| 资料副本更新          | 第一版显式更新，不自动监听原文件                                           | M1-A；产品/客户端                                                                       |
| 引用旧版本保留        | 第一版更新后旧引用 stale，删除后来源不可读；未来再做用户可控的历史来源归档 | M4 数据设计前；产品/隐私                                                                |
| 引用 UI 名称          | “来源已核验”，不等价于“事实已核验”                                         | M4；产品                                                                                |
| 遥测 O-06             | 继续默认关闭、仅本机；新增事件必须扩展 Rust/SQL allowlist                  | 各阶段；产品/隐私。若公开发布明确不上传，可通过正式决策关闭上传依赖，而非默认认为已关闭 |
| 正式签名材料          | 保留 S4.8 独立发布门，功能开发继续                                         | 公开发布前；发布负责人                                                                  |
| 实际人力              | 按 Rust/前端/QA/服务端资源重排日历                                         | M0；项目负责人                                                                          |

## 17. 首批可以直接进入实施的任务

建议第一次开发只选择 M0，不同时铺开 M1–M4：

1. 以当前 HEAD 建立 `V2_BASELINE.md`，复验现有门并确认最新 UI、schema v17/v18 没有回归。
2. 把文件与 Result 的 Context/Review/选区现状画成数据流，确认 F0 目标 DTO。
3. 写出 `ParsedDocument` 合同及六种格式定位能力清单；先让旧解析 fixture 通过。
4. 完成个人资料副本/删除/clear-all 的 ADR 和迁移草案。
5. 定义本次发布的 AI 接入策略、最小合同、负责人和条件依赖。

M0 完成后，下一切片是 F0-01/F0-02 的行为保持改造，再交付 K-01/K-02。每个切片有独立差异、合同、验收步骤和回退说明；新阶段状态采用“待开始 / 进行中 / 受阻 / 待人工验收 / 已完成”。

本次文档交付没有将上述待开始任务标为已实现；没有修改业务代码、依赖、数据库、权限或用户数据，也没有执行发布。
