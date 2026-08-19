# A2UI Terminal 前端架构

## 当前阶段

前端在同一套工作台核心之上提供默认简单模式和可选专业模式，并通过运行时边界分为两种数据源：Web 只使用确定性 Mock；Desktop 使用受控 Tauri IPC 访问真实工作区、Provider 与 SQLite 会话。API Key 不进入前端状态或数据库。

## 应用外壳与双模式

应用通过轻量 Hash 路由提供首页、成果、模板、工作台和设置五个入口。新安装默认简单模式；本地偏好只保存 `simple | professional`，未知值回退为简单模式。S1.4 首页已接入三步可跳过引导、六类固定任务、受控资料区、高频本地 Task 草稿和最近 Result；S1.5 已接入成果列表、主动新建和专用 Result 工作台，模板详情页仍按后续阶段推进。

简单模式与专业模式复用同一个 `WorkspaceLayout`、工作区 store、Gateway、IPC 和 Rust 安全内核。简单模式隐藏文件树、会话列表、Provider/Model 标识、A2UI Inspector、Endpoint 和 API Key 配置入口，但保留复用既有授权与会话动作的“选择文件”和“新对话”；专业模式恢复既有 V1 三栏工具。切换模式只改变显示密度，不复制业务数据、不修改上下文授权，也不增加命令权限。

## 新手引导与首页

首次引导只保存完成布尔值，不保存所选目标或资料。三步分别使用大众语言说明目标、资料选择和隐私；用户可跳过并从首页重开。首页一级分类严格固定为写文档、修改文件、整理资料、分析数据、制作表单/清单/小工具和自由描述六类；六个任务卡片的图标与文案使用相同内容起点和可用宽度，不随文案长度整体居中偏移。

Home 页面通过独立 Zustand store 缓存模板、最近 Result 摘要和当前 Task 请求状态，经 `homeController` 访问统一 Gateway；页面不直接调用 Desktop API。Desktop 数据来自 SQLite/Rust，Web Mock 使用确定性同合同 fixture。首页资料区支持受控系统选择器和 Tauri 原生桌面拖放：React 只向 Rust 注册资料区的逻辑坐标边界，桌面拖入的绝对路径由 Rust 原生事件接收和检查，前端只收到脱敏 ImportBatch 结果。主窗口仅授予事件 listen/unlisten 权限接收该结果，不授予前端事件 emit 权限。O-08 未关闭前，文档模板只生成明确标注未调用 AI 的本地结构草稿；未实现的表格与动态工具入口只展示能力边界。

## 统一导入批次

`features/imports` 由独立 controller/store/确认组件和拖放目标 hook 组成。每次拖放 Hook Effect 挂载使用独立目标 ID，避免 StrictMode/HMR 的旧异步清理误删当前资料区。主 `WindowContent` 的原生文件通过 Tauri `WindowEvent::DragDrop` 进入 Rust，不能使用子 WebView 的 `WebviewEvent::DragDrop`。系统选择或原生拖入后，Rust 只向前端返回随机批次/文件标识、文件名、扩展名、大小、读取/编辑能力、失败原因、替代方式和安全警告；绝对路径只暂存在 Rust 内存。原生 Drop 精确命中已注册资料区，区域外不建立批次；检查在线程中执行且同一时刻只允许一个批次。取消批次不会建立 Workspace 或文件授权；确认时 Rust 重新检查文件，只把用户保留且当前可读的项以单个 SQLite 事务写入 `workspace_files`。

S2.2 当前可确认 UTF-8 白名单文本、只读 DOCX/PDF 文本层、CSV/XLSX 基础数据和 PNG/JPEG/GIF/WebP 原始视觉来源。统一 `DocumentSource` 将持久化授权来源与编辑器文档解耦：表格/图片只有不透明 `sourceId`、脱敏元数据和受限本地预览，不会伪造文本编辑文档。同一工作区的确认批次只追加授权，前端在确认后重新读取完整来源集合；SQLite 以工作区和绝对路径去重，因此后批不会覆盖前批，重复加入也不会创建第二份授权。每项来源可通过二次确认撤销：`revoke_document_source` 同时校验 `workspaceId` 和 `sourceId`，只删除对应 `workspace_files` 记录并明确返回原文件未删除；前端随即关闭该来源的预览、已打开文本和已保存上下文选择。已生成成果和历史记录不自动删除。CSV/XLSX 限 32 表、每表 10000 行/256 列、总计 100000 单元格和单元格 32768 字符；公式只读缓存值，宏不执行，外部链接不访问，公式注入风险会标记供 S2.8 导出转义。图片限 20 MB、32768 像素边长和 4000 万像素，保留原始字节；8 MB 内可本地预览，当前明确没有视觉模型且不会发送。隐藏/敏感路径、无效签名、超限、异常 Office 包、路径穿越和 Zip Bomb 仍在授权前拒绝。

## 大众成果工作台

首页和成果页都可调用 `create_text_result` 主动创建 UTF-8 Markdown 或纯文本成果，无需先选择已有文件。Result feature 使用独立 controller/store 缓存当前编辑缓冲区、保存状态、版本摘要和预览；React 组件不直接访问 Desktop API。创建、读写、恢复和复制均由 Rust 根据 Result ID 与不透明存储引用解析真实位置，前端不会获得托管目录绝对路径。

成果工作台复用同一个 `WorkspaceLayout`：中央为 Result 编辑区，右侧为 AI 助手外壳，专业模式仍可展开既有文件树。工具栏提供保存状态、查看修改、撤销、历史、另存副本和导出入口。用户手工编辑约 1 秒后按基础 SHA-256 自动保存；冲突时保留编辑缓冲区并拒绝覆盖。当前 AI 区明确不自动发送成果，真实上下文确认属于 S2.3；导出按钮明确提示真实多格式导出属于 S2.8。

## Provider 与会话流

1. 设置页只读写 Endpoint、Model、Temperature 和无凭据代理地址；API Key 通过独立 IPC 写入 Windows Credential Manager。
2. 用户每次发送前都必须确认上下文来源。前端构造仅含勾选内容的快照，敏感路径默认排除，疑似敏感正文需要再次确认。
3. Rust 再次校验请求大小、来源路径和敏感确认，只把来源名称、字符数和内容 Hash 写入上下文审计表，不长期复制文件上下文正文。
4. Rust 从 SQLite 读取用户明确选择条数的历史消息，在后端组装 Provider 请求；密钥不返回前端。
5. Provider 的 SSE 增量通过 Tauri Channel 返回，完整用户消息和助手回复写入 SQLite。取消在连接、响应等待和流读取阶段均生效，部分回复保留为 `stopped`。
6. 传输层采用分阶段超时：连接 10 秒、响应头 45 秒、流空闲 60 秒、持续输出最长 15 分钟。HTTP、网络、超时、协议和限流错误映射为稳定错误码，并附带可重试与 `Retry-After` 元数据。
7. 删除工作区依靠外键级联删除会话、消息与上下文摘要；真实项目文件不受影响。

## 模块边界

```text
src/
├── app/                    # 应用壳、错误边界、主题、国际化
├── features/
│   ├── workspace/          # 文件树、Tab、编辑器
│   ├── home/               # 引导、六类入口、资料区、Task/Result 首页状态
│   ├── results/            # Result 列表、受控新建、编辑/保存/版本工作台
│   ├── imports/            # ImportBatch 状态、能力确认和取消/确认
│   ├── chat/               # 会话、输入与流式 Mock
│   ├── context/            # 请求前上下文确认
│   ├── diff/               # 修改前后审阅与应用
│   └── a2ui/               # 协议、Basic Catalog、Runtime、Inspector
├── shared/                 # Mock、平台接口和领域类型
├── stores/                 # Zustand UI 临时状态
└── styles/                 # 全局 Design Tokens
```

## 状态规则

Zustand 保存活动工作区摘要、文件树、已打开文档、多 Tab、基础 Hash、脏状态和恢复提示。工作区授权与草稿写入 SQLite；真实文件内容仍以磁盘为事实来源，不复制成长期数据库正文。会话、版本和审计继续由 SQLite 承担；API Key 只进入 Windows Credential Manager。

A2UI Surface 历史保存在 SQLite，工作区恢复时只恢复历史和活动引用，不自动占用中央视图；选择/恢复工作区、选择资料或打开文件都回到编辑器。交互成果的“关闭”只退出当前视图，不删除历史，用户仍可从“交互成果”重新查看。“永久删除”使用独立危险按钮和不可撤销确认，Rust 按工作区与 Surface ID 复核归属，并在单个事务中删除 Surface、同 Surface 协议消息和自动关联的 A2UI Result；Action 事件由外键级联删除。取消或事务失败时不改变任何记录，也不触碰工作区真实文件。

SQLite 启动先后执行完整性检查、单事务连续迁移和外键检查。Schema v8 为崩溃草稿保存正文 Hash；schema v9 新增独立 Result 聚合；schema v10 新增版本化内置模板和 Task/Result 绑定。旧文件或 Surface 仍在显式打开时惰性关联，不批量复制正文。工作区恢复时列出全部草稿，区分待恢复、外部冲突、磁盘已写成功的陈旧记录和原文件不可用四种状态。目录文件与独立授权文件都先持久化草稿再写磁盘。

## Result 基础聚合

Result 是独立于 Chat Session 的成果事实源。v9 `results` 保存类型、状态、存储类别、不透明存储引用、当前版本和可选 Surface 快照；对外 DTO 不返回绝对路径。文件正文仍由授权文件系统和版本链承载，A2UI Result 保存已通过可信校验的状态快照。删除会话只清空可选会话关联，删除工作区级联清理应用记录但不触碰真实项目文件。应用数据目录下的 `my-results` 是新成果默认托管目录；S1.2 Task Orchestrator 和 S1.5 用户主动新建都会建立初始 Revision。托管成果复用既有 `document_versions`、2 MB UTF-8 上限、30 天/100 条普通历史和 Hash 冲突规则，不引入第二套版本表。

用户新建只接受单层安全文件名和匹配的 `.md`、`.markdown`、`.txt` 扩展名，拒绝绝对路径、目录分隔符、`..`、Windows 保留名、非法字符和静默覆盖。磁盘文件先以 `create_new` 写入并同步，再由单个 SQLite 事务建立 Result 与初始 Revision；数据库失败时只补偿删除本次新建文件。旧 S1.2 托管草稿若尚无初始 Revision，在首次专用读取时按当前文件 Hash 惰性补录。另存副本使用新的不可预测文件名和独立 Result/Revision，不覆盖原成果。

## Task 与内置模板基础

Schema v10 以 `(template id, version)` 保存会议纪要、文档总结、周报和简历优化的字段规则与空白结构，不保存用户源文。Task 回答由 Rust allowlist、类型、选项和长度校验，当前必要问题最多 3 个；只有 `ready` Task 能通过 Orchestrator 创建一个托管 Result。文件先以不可预测 UUID 名写入应用数据目录，数据库事务再以双向标识绑定 Task/Result；事务失败只清理由本次调用新建的文件。该链路不引用 Provider，O-08 未关闭前不会把结构草稿表述成 AI 生成结果。

## Desktop 工作区流程

1. 前端调用 `select_workspace`，Rust 在后台打开系统目录选择器，前端不能提交任意绝对路径。
2. Rust 规范化并保存授权根目录，返回不含绝对路径的工作区摘要。
3. 文件树只列出白名单文本类型；依赖、构建、Git、虚拟环境和 secrets 目录被忽略。独立资料选择复用 ImportBatch 安全检查。
4. 打开文件时校验相对路径、最终规范路径、2 MB 上限及 UTF-8。
5. 编辑后约 250 ms 保存崩溃草稿，约 1 秒携带基础 SHA-256 自动保存真实文件。
6. 磁盘 Hash 不匹配时拒绝写入并显示冲突；用户必须显式选择恢复草稿或保留磁盘版本。

## 真实文件版本历史

普通编辑自动保存通过统一的 Rust 保存服务完成。服务在写入前复核磁盘 Hash，写入后以 SQLite 事务记录首次磁盘版本和保存后版本；历史记录失败时回滚磁盘并重新保留崩溃草稿。独立授权文本文件复用同一链路。

版本列表只返回 ID、来源、摘要、时间和 Hash，正文按预览请求单独读取。恢复任意历史版本前会再次校验当前磁盘 Hash，并将恢复前内容和恢复结果都写入版本链。恢复是新事件，不删除旧版本。完整约束见 [DOCUMENT_VERSION_HISTORY.md](DOCUMENT_VERSION_HISTORY.md)。

## Mock 审阅流程

1. 用户从文件树选择演示文件。
2. 编辑器在内存中修改内容并模拟 1 秒自动保存状态。
3. 用户发送指令前打开上下文选择器。
4. Mock 助手流式返回说明并创建符合 Patch V1 形状的演示审阅数据。
5. 中心区域切换到审阅中心，显示 before/after。
6. 接受后更新内存文档；拒绝后不修改。

该流程只验证 UI 和状态边界，不代表真实文件已经被写入。

## Desktop 语义 Patch 边界

AI 响应不持有文件系统能力。完整响应可以包含 Patch V1 JSON，但必须先在 Rust 中完成严格反序列化，并校验工作区、白名单路径、完整文件 Hash、锚点 Hash、唯一匹配和修改块不重叠，前端才会收到可展示的审阅对象。

用户可以逐块取消或接受修改。应用命令不信任前端审阅状态，会基于当前磁盘内容再次执行全部校验，然后将语义块确定性转换为文本变更。写入失败或数据库版本记录失败时回滚本次已写文件。

每次应用为所有受影响文件保存关联的 `before`/`after` 完整版本，有效期 30 天。撤销是一个新的 Patch 操作，并且只有当前文件仍匹配原操作的 `after` Hash 时才允许恢复，从而保留历史链且不覆盖外部修改。

## A2UI 边界

A2UI 消息分为完整 `a2ui_surface` 与增量 `a2ui_update`，协议固定为 V1。Rust 是唯一信任边界：先限制原始消息大小，再严格反序列化、校验组件树、Props、数据模型和 Action，只有有效 Surface 才返回前端 Runtime。无效消息保留在 Inspector 中用于定位，但不会渲染。

前端 Runtime 使用固定 `switch` 将 13 个 Basic Catalog 名称映射到仓库内 React/Ant Design 组件，不使用动态 import、任意 HTML 或模型提供的 JavaScript。增量更新按 `surfaceId` 和连续 revision 应用，只替换目标 Surface，Zustand 保留其他 Surface 对象。

Action 声明与执行分离。Rust 会从已持久化组件树重新读取声明，不信任前端提交的 Action 类型：`set_state` 与 `submit_form` 为低风险本地事件；`request_patch` 只返回“需要 Diff 审阅”，不写文件；未声明 Action 和其他类型默认高风险拒绝。所有尝试写入 `a2ui_events`，供 Inspector 查看。

SQLite v6 持久化 Surface、有效/无效原始消息、校验耗时和 Action 审计。删除工作区或执行“一键清除所有本地数据”时通过外键/事务一并清理。

## 更新与发布边界

开发版和内部验收版初始化 updater 插件但不配置 endpoint/pubkey，因此检查更新会安全降级且不影响启动。正式 tag 工作流使用临时配置覆盖层注入 GitHub Releases endpoint 和 updater 公钥；私钥仅存在于受保护的 GitHub environment secret 中。安装包 Authenticode 与 updater 内容签名是两套独立门禁，二者都必须通过。

前端只能通过 `updater:default` 执行检查、下载和安装，并只获得 `process:allow-restart`，没有 shell 或任意进程能力。Tauri updater 在安装前验证签名，设置页显示版本、更新说明和下载进度。正式工作流默认创建 Draft Release，人工安装/升级验收后才发布 `latest.json`。

## 诊断与本地数据管理

诊断导出在 Rust 中生成并由系统保存对话框选择目标，只包含应用/Schema 版本、平台、架构和各数据表记录数量。报告结构固定声明消息正文、文件内容、工作区路径和 Provider Secret 均未包含；前端无法要求导出额外字段。

“一键清除所有本地数据”必须输入固定确认文本。Rust 先删除 Credential Manager 中已知 Provider Key，再事务清空 SQLite 业务表、上下文授权和活动请求；真实工作区文件从不进入删除目标。
