# S4.4 崩溃恢复与迁移全链路验证记录

> 状态：实现和自动验证已完成，等待用户人工验收；通过前不得开始 S4.5。

## 1. 范围与基线

- 日期：2026-09-17（Asia/Shanghai）
- 基线 commit：`343052c`（`s4.2`）；S4.3 与验收修正保留在未提交工作区
- 对应实施记录：LOG-0158—LOG-0160
- 范围：Task、Result 未提交输入、Review、Export Job 跨崩溃恢复；迁移原子回滚、较新 schema 拒绝和旧数据惰性归档
- 明确不做：后台自动重试导出、自动覆盖冲突文件、云端备份、跨设备恢复、批量复制或删除真实项目文件

## 2. 实现结论

schema v16 只以前向迁移新增 `task_runs`、`result_drafts` 和 `export_jobs`，未改写 v1—v15。应用在 SQLite 完整性检查和迁移成功后、窗口可交互前协调恢复：

1. Task 先持久化稳定的 Result/Revision ID、文件名、内容和 Hash，再写托管文件，最后用单一事务创建 Result 并完成 Task。重启时缺文件则按意图创建；已有文件只有 Hash 一致才完成数据库状态，不一致标记失败且不覆盖。完成后的重复启动返回同一 Result。
2. Result 可编辑输入在约 250 ms 后写入 `result_drafts`；真实保存仍约 1 秒并在成功后删除草稿。重开时正文不自动覆盖磁盘，用户明确选择恢复草稿或保留磁盘版本；基础 Hash 变化会显示冲突。
3. Review 继续复用 schema v11 的持久请求、逐块决定、应用操作 ID 和既有幂等应用路径；重启不复制请求，重复应用已完成 Review 返回原结果。
4. Export Job 在选择目标、生成完成、原子写入前和提交后记录状态与输出 Hash。重启只核验 `writing` 目标的字节 Hash或确认 `committed`，绝不重新生成或覆盖；无法证明提交的任务标为 `interrupted`，由用户重新发起新导出。

首页恢复提示只公开未保存成果标题/ID、待处理 Review 数、已恢复 Task 数和脱敏导出状态。导出绝对目标路径只保存在本机恢复表，不进入 IPC、合同 fixture、诊断或产品事件。

## 3. 迁移与安全边界

- 启动继续在迁移前后执行 `quick_check`，迁移使用一个 `IMMEDIATE` 事务并在完成后执行外键检查。
- v16 任一语句失败时三张恢复表和 `user_version` 一并回滚；高于 v16 的数据库被拒绝且版本保持不变。
- 从 v0 到 v15 的每个历史版本均升级到 v16并保留原有行；v9 的旧文件/Surface 仍只在显式打开时惰性建立 Result。
- 恢复不会自动覆盖外部修改，不会重复应用 Review，也不会把未确认的导出重新提交。
- 一键清除本地数据包含三张 v16 表；诊断仅增加数量，不包含草稿正文、Task 内容、导出路径或输出 Hash。

## 4. 共享合同与 IPC

- `contracts/v2/recovery.json` 由 Rust serde 与 TypeScript guard 共同验证，明确不含 `targetPath`、`absolutePath` 或草稿正文。
- 新增最小 IPC：`save_result_draft`、`discard_result_draft`、`get_recovery_status`；均已注册到 Tauri manifest、invoke handler、自动生成权限和主窗口 allowlist。
- Result 文档响应增加可空 `recoveryDraft`；草稿只在打开对应成果时返回，首页汇总不返回正文。

## 5. 自动验证结果

| 验证                                                                                         | 结果                                                        |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run typecheck`                                                                          | 通过                                                        |
| `npm test`                                                                                   | 44 个文件、208 项通过                                       |
| `cargo test --manifest-path src-tauri/Cargo.toml -j1`                                        | 190 项通过、1 项人工 PDF 预览按设计忽略；集成测试 32 项通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures -j1`               | 16 项通过                                                   |
| `cargo test --manifest-path src-tauri/Cargo.toml --test command_registration -j1`            | 1 项通过                                                    |
| `npm run lint`、`npm run build`、严格 Clippy、rustfmt、修改文件 Prettier、`git diff --check` | 通过；生产构建仅有既有 bundle size 提示                     |

故障注入覆盖：Task 在意图记录后、文件写入后和数据库完成后恢复；Result 草稿正常/外部冲突；Export `writing` 目标 Hash 匹配与不匹配；Review 跨数据库重开和应用幂等；v16 中途无效 SQL 原子回滚；较新 schema 安全拒绝；所有历史 schema 升级与旧数据惰性归档。

未设置单核亲和性时，本机仍随机出现既有 `rustc STATUS_ACCESS_VIOLATION`；使用项目文档的临时单核、stable、禁增量和单任务配置后，完整 Rust 测试通过。该编译器进程异常不作为业务测试结果。

仓库级 `npm run format:check` 仍会枚举大量本阶段开始前就存在的未格式化历史文件，并在旧文档上触发 Prettier 内部 `reading 'stack'` 异常；未对这些无关文件做批量改写。本阶段全部修改的前端、合同和文档文件已单独通过 Prettier check，Rust 全部通过 rustfmt，`git diff --check` 通过。

## 6. 待人工验收

### M04 复验修正（2026-09-18）

- 原实现的复选框只更新内存，“应用已选修改”同时决定并写入；此前 M04 没有明确可用的“只保存决定”入口。现增加“保存选择（不应用）”及明确说明，文件保持不变。
- 活动审阅查询补齐 accepted/partially_accepted；未应用决定允许再次调整或丢弃，终态仍不可重决定。恢复 rejected 块时不默认勾选；应用已保存且未改变的选择时不重复 decide。
- 新增前端保存不跳转/零写入、恢复拒绝状态、IPC 失败保留决定测试，以及 Rust 真实 SQLite 重开后的部分接受、版本数不重复、已决定审阅可丢弃测试。
- 前端全量 45 文件/213 项通过，最后的保存状态共用判断调整后相关 20 项复跑通过；typecheck、lint、build 和修改前端文件 Prettier 通过。Rust 串行全量 192 项通过、1 项人工 PDF 忽略，集成 32 项通过。
- 首次并行执行 Rust 测试时，既有 `heartbeats_and_reasoning_do_not_extend_content_deadline` 出现协议错误；串行复跑该项及全套通过。未据此声称用户真实 Provider 生成失败已修复；仍需界面具体错误码确定原因。
- Windows 桌面 M04 尚待用户复验；没有改动或清理用户实际数据库、成果文件。

请按 [S4_4_MANUAL_ACCEPTANCE.md](S4_4_MANUAL_ACCEPTANCE.md) 在 Windows 桌面应用完成 M01—M06。只有用户明确回复 `S4.4 验收通过` 后，才能把本阶段改为已完成并开始 S4.5。

### M04 重复生成数据库错误修正（LOG-0164）

- 重复模型修改块 ID 导致 `review_blocks.id` 主键冲突已通过先失败后通过的回归复现。新 Review 使用本机 UUID 命名空间，同步块及 Patch 引用，不改旧记录，不删除数据。
- 数据库故障不再自动请求模型重生成；新消息和旧错误提示区分本地存储失败与模型校验失败。
- 前端 45 文件/214 项、typecheck/lint/build、应用层 Rust 79 项（1 项人工 PDF 忽略）和严格 Clippy 通过。
- 本轮完整 Rust 测试仍有既有 Provider 心跳时序测试失败（192 通过、1 失败、1 忽略）；复跑被运行中的桌面 exe 占用阻断，未强行关闭。完整通过记录不能用此前的结果替代。
