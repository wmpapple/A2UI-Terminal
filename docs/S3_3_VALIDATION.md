# S3.3 中风险 Action → Review Pipeline 验证记录

日期：2026-09-16（Asia/Shanghai）。基线：用户已验收的 S3.2。关联实施账本：LOG-0114—LOG-0122。当前状态：实现和自动验证完成，人工复验发现的无关旧面板、长 Action DataPart 截断及 M03 缺失目标的不可理解错误均已修复；用户已于 2026-09-16 明确复验通过，`ACCEPTED`。S3.4 已按 LOG-0123 开始。

## 实现结果

- 保留固定 Action 白名单 `set_state | submit_form | request_patch`，没有新增命令或任意写入 Action。`request_patch.value` 只能是完整 `document_patch`、`create_file` 或 `replace_empty_file` 候选，且不得同时提供 `target`。
- Rust 在 Surface 进入持久化前校验候选 JSON 的资源边界、类型与精确 DTO Schema；缺少候选、未知候选类型、未知字段、可执行字段和系统命令均使整条 Surface 安全失败，不进行部分渲染。
- 点击时前端仍只发送工作区、Surface、组件、事件和交互 payload。Rust 从 SQLite 中重新载入 Surface、重新规范化并校验，再查找该组件事件的 Action 声明；前端不能传入 Action 类型、风险、候选路径或已校验结论。
- application adapter 将持久化声明中的候选序列化后，以 `source=a2ui_action` 调用既有 schema v11 `ReviewApplicationService`。三类候选继续复用既有 Patch、空文件首次写入和受管 Result 创建内核；没有第二条写入路径。
- `ActionExecutionResult` 增加可选 `review` 响应。桌面前端收到真实 Review 后设置 `pendingDiff` 并进入既有 Diff Review；审阅页明确说明来自交互界面且接受前零写入。
- Action 审计不保存前端为中风险动作提交的任意候选 payload，只保存不透明 Review ID 与固定来源；创建 Review 失败时保存稳定错误码并返回错误。低风险状态事件的既有 payload 审计不变。
- Provider 系统提示明确 `request_patch` 必须携带精确候选和当前 workspace ID，不能使用 target；点击只打开 Review。普通表单和项目面板模板保持原行为。
- 人工验收首次生成曾返回结构合法但不含“保存为成果”按钮的 S3.2 项目面板，旧逻辑只做协议安全校验而错误显示成功。修复后新增由生产校验器验证的三节点 Action 卡模板；聊天编排只在“交互界面/卡片/按钮”和明确审阅动作意图同时出现时启用语义要求。结果必须包含持久化的 `request_patch`，否则在写入 Surface 前记录失败并从 Action 专用模板受限重试一次。普通文档 Review 和 S3.2“不要创建文件”的项目面板有反向测试，不会被误分流。
- 聊天中的“打开 Surface / 打开 Inspector”现在携带该条 AI 消息 ID：成功时选择该消息持久化的 Surface，失败时选择该消息的检查记录。旧实现仅切换中央视图，可能继续显示先前活动面板；新增前端回归固定该行为。
- Provider 实测失败记录表明完整 Action DataPart 已包含正确标题、按钮和 `action-created.md` 候选，但在外层包络结尾截断。Action 卡现在要求模型返回严格的短计划 `a2ui_review_card`；Rust 只接受完整 JSON 和精确字段，将模型提供的三个可见文本与完整候选编译进固定本地 A2UI 结构，再走同一生产校验器。残缺、未知字段或不安全候选不会被补全或绕过。
- M03 实测中发送清单授权的是 `result.md`，候选却指向未授权的 `action-empty.md`；Rust 继续拒绝目标不一致的候选，但不再暴露 `filesystem operation failed`，而是提示目标文件不存在或尚未加入工作区。验收单同时明确目标文件名、当前选择和发送清单必须一致。
- 高风险候选可进入 Review 并显示其真实 Review 风险，但 Action 本身仍只具备中风险“请求审阅”能力；未知高风险 Action、系统命令、Shell、HTML、脚本和 URL 继续在 Rust 白名单处默认拒绝。

## 自动验证

以下命令在 Windows、Rust stable、schema v12 上执行：

```text
npm run lint
通过

npm run typecheck
通过

npm test -- --run
41 个测试文件、188 项通过

npm run build
通过；仅保留既有主 bundle 体积提示

npm run test:e2e
首轮 10/12 通过；另 2 项在 beforeEach 的 page.goto('/') 发生 Chromium Page crashed，未进入业务断言
npm run test:e2e -- --last-failed
原 2 项 2/2 通过；最终 12 项业务用例均有通过结果，导航崩溃不计作产品通过证据

npm run test:a2ui-conformance
6/6 通过

cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features -j1 -- --test-threads=1
Rust lib 160 项通过、1 项人工 PDF 预览按设计忽略；A2UI Action→Review 3/3、conformance 6/6、架构 6/6、命令注册 1/1、合同 12/12；通过总数 188

cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -j1 -- -D warnings
通过

cargo fmt --manifest-path src-tauri/Cargo.toml --check
通过
```

Rust 独立 target 首次编译在第三方 `webview2-com-sys` 发生一次本项目已记录的 Windows `STATUS_ACCESS_VIOLATION`，未进入业务代码编译或测试；按人工验收文档的单核、单任务临时设置复用缓存重跑后通过。该环境失败未计作测试通过证据。

2026-09-16 的 LOG-0121 增量验证新增 1 项缺失目标错误回归；Rust lib 161 项通过、1 项人工 PDF 预览按设计忽略，rustfmt 与 lib Clippy `-D warnings` 通过。运行中的桌面应用锁住 `target/debug/a2ui-terminal.exe`，本轮未重复运行需要构建该二进制的集成测试；最近完整 Action→Review 集成证据仍为 LOG-0120 的 3/3。

仓库级 `npm run format:check` 仍受开始本阶段前已有的 157 个历史格式差异影响，本轮没有全仓机械格式化。所有本阶段修改的 Rust 文件已通过 rustfmt，前端文件已定向通过 Prettier；文档与代码通过 `git diff --check`。

## 安全断言

- LOG-0118 聊天排序修复：历史 UI 与 Provider 最近消息查询统一按 `created_at, rowid` 排序；同秒消息使用实际插入行序，不再按随机 UUID。新增文件数据库回归以逆序 ID 创建两轮同秒问答，关闭重开后验证显示顺序及最近 0/1/2/3/20 条上下文截取。此次 Rust 全量测试通过；前端验证沿用上一轮结果，本次未改前端。

- `a2ui_action_review` 集成测试使用持久化声明 `declared.md/high` 与伪造前端 payload `forged.md/low`，最终 Review 只包含 `declared.md/high`，审计也不包含伪造正文。
- `document_patch`、`replace_empty_file` 和 `create_file` 均产生 `source=a2ui_action` 的持久 Review；接受前源文件逐字不变且没有 Result。
- 创建成果必须在 Review block 明确接受后才落盘；文件名、内容和来源均来自经过 Rust 重校验的持久候选。
- `request_patch` 缺少 value 与 `run_command` Surface 均不持久化、不渲染、不创建 Result。
- 明确要求 Action 卡时，安全但无关的表单/项目面板和普通说明同样不能成为成功 Surface；检查发生在持久化前，已有合法 Surface 不会被错误输出覆盖。Action 专用生成/修复模板本身经过同一生产校验器和语义门。
- 聊天消息的 Surface/Inspector 打开入口按消息 ID 定位，不会因为全局仍选中 S3.2 历史面板而打开错误记录。
- `a2ui_review_card` 仅作为 Provider→Rust 的短计划 DTO；完整且字段精确时才编译，Surface ID 来自可信消息 ID。编译后的 Action 与候选仍通过现有生产校验器，Rust 不修复残缺 JSON，也不生成或改写候选内容。
- `replace_empty_file` 目标缺失时只改善公开错误说明，不把模型声明的路径替换为另一个已授权文件；错误候选仍无法进入 Review，接受前保持零写入。
- 既有 Review 决定、应用、冲突、恢复、幂等、撤销、路径授权、Hash 和版本测试继续全量通过。

## Migration / IPC / Capability

- schema 保持 v12；无 migration。
- 复用既有 `execute_a2ui_action` 与 Review IPC；只对既有 Action 响应增加可选 `review` 字段，无新命令。
- 主窗口 Tauri Capability 不变；没有新增文件、网络、Shell、剪贴板、Provider、遥测或远程资源权限。

## 兼容与回滚

- 现有 `set_state` 和 `submit_form` 行为与审计不变。历史上没有候选 value 的 `request_patch` Surface 仍可作为历史查看，但再次执行时会因新安全要求拒绝，不能形成无内容 Review。
- 官方 v0.9.1/v0.9 协商、本地 Catalog ID、19 个组件、旧私有 1.0 兼容读取和 schema v12 均未改变。
- 回滚时移除候选 Schema、Action→Review adapter、响应字段、前端跳转与提示即可；没有数据 migration 需要回退。已经创建的 Review/Result 使用通用 schema 与来源枚举，仍可由旧 Review 链读取。

## 人工验收

用户已按 [S3.3 人工验收单](S3_3_MANUAL_ACCEPTANCE.md) 完成复验，并于 2026-09-16 明确回复通过。后续回归仍应覆盖真实 Provider、零写入、接受/拒绝、冲突、系统命令拒绝、审计和重启恢复；S3.4 通过前不得开始 S3.5。
