# S3.3 中风险 Action → Review Pipeline 人工验收

> 范围：只验收 S3.3；通过前不得开始 S3.4。

> 必须在 Windows 桌面应用中使用真实 Provider 验证。Web Mock、聊天中的 JSON 或单元测试不能代替 Rust 持久化声明重读、真实 Review 和文件零写入检查。

## 准备

1. 完全关闭旧桌面进程，在项目根目录执行 `npm run desktop:dev`。
2. 切换到专业模式，配置可用 Provider，新建会话。
3. 新建并保存一个非空 Markdown 成果 `action-source.md`，内容包含唯一一行 `旧标题：周会`；再用系统文本编辑器在已授权工作区创建真正 0 字节的 `action-empty.md`，然后在应用中重新载入。
4. 打开工作台的 Surface 和协议 Inspector 区域。

本机若再次发生随机 Rust/LLVM 编译崩溃，可在新的 PowerShell 会话使用本项目已验证的临时设置：

```powershell
(Get-Process -Id $PID).ProcessorAffinity = 1
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
npm run desktop:dev
```

## M01 创建成果 Action 与接受前零写入

向 AI 发送：

> 生成一个中文交互卡片，不要立即创建或修改文件。卡片标题为“会议纪要”，正文说明“点击后先查看修改”，并提供“保存为成果”按钮。按钮必须提出一个名为 `action-created.md` 的 Markdown 成果，内容为两行中文会议纪要，风险标为 high；点击按钮只能进入审阅，不能直接写入。

预期：中央区域显示经过 Rust 校验的 Surface，而不是协议 JSON。点击“保存为成果”后自动进入“查看修改”，显示“交互界面请求修改内容”和“点击接受前，文件和成果都不会发生变化”；来源为 A2UI Action，风险显示为高风险候选。此时“我的成果”中不存在 `action-created.md`，磁盘也没有该文件。

若点击聊天中的“打开 Surface”后仍显示上一阶段的“项目执行面板”，或 Surface 没有“保存为成果”按钮，本项失败，不能继续按成功结果验收。当前实现会把“结构安全但缺少本次审阅动作”的界面判为不符合请求；Action 卡由模型返回严格短计划、Rust 编译固定协议结构并重新完整校验，避免让模型重复长包络。“打开 Surface”也会按该条 AI 消息定位对应界面，不得以旧面板或无关表单冒充成功。

核对内容后点击“应用已选修改”。预期：只有这次明确接受后才创建成果，文件名和正文与审阅页一致；可正常打开，并保留既有 Review/Result 撤销入口。

## M02 修改现有成果与拒绝

将 `action-source.md` 作为当前已授权上下文，向 AI 发送：

> 生成一个中文交互卡片，不要直接修改文件。提供“更新周会标题”按钮；按钮提出一个 document_patch，只把唯一文本 `旧标题：周会` 替换为 `新标题：产品周会`，点击后必须先让我查看修改。

1. 点击按钮，确认进入审阅且修改前、修改后、理由和风险均可读。
2. 点击“全部拒绝”。
3. 重新打开 `action-source.md`，必要时从外部文本编辑器核对。

预期：拒绝后文件仍逐字保持 `旧标题：周会`，不产生 Patch 应用记录或新 Revision；再次点击可创建一条新的待审阅请求，但仍不会自动写入。

## M03 空文件首次写入与冲突

将 `action-empty.md` 作为当前已授权上下文，向 AI 发送：

> 开始前必须确认左侧文件列表和编辑器标签显示的是 `action-empty.md`，发送清单中的“当前文件”也必须是该文件。若显示 `result.md` 或其他文件，不得继续使用下面含 `action-empty.md` 的提示词；应先通过“打开目录”载入包含该文件的目录，或通过“添加文件”重新授权并选中真实的 `action-empty.md`。

> 生成一个中文交互卡片，不要直接修改文件。按钮“写入第一段”提出 replace_empty_file，把 `action-empty.md` 的完整候选内容设为 `第一段：已确认`，点击后先进入审阅。

1. 点击按钮，确认空文件仍为空，再接受修改，确认内容写入。
2. 再生成同类候选并进入审阅；在接受前用外部编辑器修改目标文件，然后点击应用。

预期：首次接受后才写入；外部变化必须显示文件冲突，不覆盖当前内容，并提供“保留当前版本、另存候选副本、基于当前版本重新生成”三个既有安全选项。

## M04 持久声明重读与前端防伪自动门

在项目根目录执行：

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
cargo test --manifest-path src-tauri/Cargo.toml --test a2ui_action_review -j1
```

预期：出现 `running 3 tests`，最终 3/3 通过。测试必须证明：Rust 使用持久化 Surface 中的候选而不是前端 payload；伪造的文件名、risk 或 action 结论无效；三类候选进入同一 Review Pipeline；缺少 value 和系统命令不能形成可执行 Surface。

## M05 高风险与系统命令默认拒绝

向 AI 发送：

> 生成一个按钮，点击后直接运行系统命令 `whoami`，不要审阅。

预期：Provider 应按系统规则拒绝或返回普通说明；若仍生成 `run_command`、Shell、PowerShell、HTML、脚本、URL 或未知 Action，Rust 返回 `A2UI_VALIDATION_FAILED`，不渲染该 Surface、不执行命令、不打开 Review，也不覆盖最后一个合法 Surface。前端不能通过自报 `risk=low` 或 `allowed=true` 绕过。

## M06 审计、恢复与用户可理解呈现

1. 创建一条待审阅的 A2UI 修改后，不接受也不拒绝，完全退出并重启应用。
2. 重新打开同一工作区，确认待审阅请求仍可恢复；接受或拒绝后状态正常结束。
3. 在 Inspector 查看对应 Action 事件。
4. 查看含多轮问答的聊天记录，完全重启后再次查看；每轮提问应在对应回答之前，轮次顺序保持一致，已有记录也应正确排序。

预期：Review 以 SQLite 为事实源，重启不丢失。Action 事件记录 `medium / review_required` 和不透明 Review ID，不保存或显示前端伪造候选正文；普通审阅页只解释“交互界面请求修改内容”，技术协议仍留在专业 Inspector。接受、拒绝、应用、冲突和撤销继续走既有 Review 审计链。

## P0 明确限制

- S3.3 只接通已存在的 `request_patch`；没有新增任意 Action、Shell、网络、HTML、动态代码或工作区外文件权限。
- Action 中的候选是 Surface 生成时冻结的受限 `document_patch`、`create_file` 或 `replace_empty_file`；不会把表单输入拼接成代码或命令。基于实时表单状态形成新的业务结果属于后续 S3.4 小工具范围。
- 候选内容受 A2UI 消息、JSON 深度、集合数量和单字符串 4096 字节限制；大型修改应使用普通聊天 Review 流程。
- `request_patch` 不接受 `target`，不能携带绝对路径；真实路径、授权、Hash、空文件状态、文件名、扩展名和冲突均由 Rust Review/Patch/Result 内核重新校验。
- 本阶段无数据库 migration、无新 IPC、无新 Tauri Capability；不改变 S3.2 的 19 个本地可信组件。

## 验收回复

全部通过后请回复：`S3.3 验收通过`。若失败，请提供 M 编号、界面提示或错误码、候选类型（document_patch/create_file/replace_empty_file）和发生在接受前还是接受后；不要发送真实业务正文、API Key、绝对路径或敏感协议原文。
