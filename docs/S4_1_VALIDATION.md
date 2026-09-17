# S4.1 最近成果与统一搜索验证记录

> 状态：实现、自动验证和用户人工验收均已完成；S4.1 已关闭，允许开始 S4.2。

## 1. 范围与基线

- 日期：2026-09-17（Asia/Shanghai；接续 2026-09-16 开始的实施）
- 基线：`a165978`（`s3.5`），开始前工作树干净
- 对应实施记录：LOG-0135、LOG-0136
- 范围：HOME-03/SRCH-01；最近成果；Result 标题/当前正文、当前工作区已授权 DocumentSource 正文和 Context Pack 元数据的本地统一搜索；成果直达；资料进入任务发送清单；撤权清理和安全重建
- 明确不做：S4.2 本地模型探测、持久化 Embedding、全盘工作区扫描、云端搜索、聊天/Prompt/AI 回复搜索、图片 OCR、搜索事件埋点

## 2. 实现结论

S4.1 使用独立的 Rust 内存词法索引复用 S2.4 已验证的确定性分块、中文 bigram 与 BM25-like 排序。每次搜索均从 SQLite Result 元数据、受控 Result 正文读取、当前工作区仍授权的 DocumentSource 和 Context Pack 引用重新建立候选集合；候选 Hash 变化时自动更新分块，已删除或撤销候选从索引保留集合移除。

首页新增普通用户可见的“搜索本地内容”：成果结果可直接打开；资料或资料包结果只加入当前会话的发送清单并打开工作台，同时使既有上下文确认失效，不会自动发送给 Provider。页面提供“修复搜索”，只清空内存索引，下一次查询按当前授权数据重建，Result/Revision/原文件不发生写入。

## 3. 安全、隐私与数据边界

- 不新增 schema 或正文持久化表；schema 保持 v13。目标架构中的 `search_documents` 未在本阶段落地，因为 P0 可用可重建内存索引满足当前范围，并避免复制正文。
- 搜索只读本地数据，不新增网络、Shell、剪贴板、任意路径、Provider 或遥测能力。
- 资料来源必须属于请求中的当前工作区且仍存在于 `workspace_files`；敏感/隐藏路径在读取正文前再次排除。
- Result 若绑定敏感工作区路径、正文适配器失效或源文件不可读，则整项跳过；错误项不会使其他安全候选不可搜索。
- Context Pack 仅索引名称和仍有效条目的安全标签，不复制包内正文；图片仅索引安全文件名，不索引二进制、Data URL 或 OCR 文本。
- 返回 DTO 只有不透明 ID、类型、标题、短摘要、更新时间和排序分值，不返回绝对路径、数据库位置或完整索引。
- 撤销来源、删除资料包、删除/切换工作区和清除本地数据会同步清空搜索索引；查询也会按当前候选集合剔除失效缓存。

## 4. IPC 与前端合同

- `search_authorized_content`：输入可选工作区 ID、1—200 字符查询和 1—50 结果上限；未知字段拒绝；返回本地词法结果及安全统计。
- `rebuild_authorized_search_index`：只清空内存搜索文档，明确返回 `resultDataChanged: false`。
- 两个命令只加入主窗口最小 allowlist；Web Mock 仅提供确定性的 Result 搜索演示，不模拟真实文件授权或 SQLite。

## 5. 自动验证结果

| 验证                                                                                                | 结果                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                                                                 | 通过                                    |
| `npm run lint`                                                                                      | 通过                                    |
| `npm run build`                                                                                     | 通过；仅保留既有 bundle size 提示       |
| `npm test -- --run`                                                                                 | 42 个文件、198 项通过                   |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -j1`                                         | 171 项通过、1 项人工 PDF 预览按设计忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures -j1`                      | 13 项通过                               |
| `cargo test --manifest-path src-tauri/Cargo.toml --test command_registration -j1`                   | 1 项通过                                |
| `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_boundaries -j1`                | 6 项通过                                |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- -D warnings` | 通过                                    |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                                         | 通过                                    |
| S4.1 变更文件 `prettier --check`                                                                    | 通过                                    |
| `git diff --check`                                                                                  | 通过（仅 Git 的 CRLF 工作树提示）       |

定向覆盖包括：

- 成果标题/正文、已授权中文正文和资料包元数据命中；
- 敏感路径即使被直接写入测试数据库，也在文件读取前排除；
- 撤销来源后正文和空资料包不再命中；
- 重建索引不改变 Result 数据；
- Rust 与 TypeScript 共同消费搜索 fixture，拒绝路径、完整正文和 Provider 字段进入搜索合同；
- 首页搜索直接打开 Result；资料结果只改变待确认的会话上下文，不自动发送。

首次误用未带 `--lib` 的 Rust 定向命令时，Cargo 无谓进入全部集成目标链接，已主动中止并改为 `--lib` 精确验证；这不是测试失败。第一次 Rust 全量库测试中，既有 `heartbeats_and_reasoning_do_not_extend_content_deadline` 本机套接字测试出现一次 `PROVIDER_PROTOCOL_ERROR` 瞬时失败；该项单独复跑通过，随后 172 项库测试全量复跑为 171 项通过、1 项按设计忽略。新增 S4.1 定向测试、命令注册和严格 Clippy 均稳定通过。

## 6. 人工验收结论

### 工作台导入反馈修正（LOG-0137）

工作台旧入口未展示逐文件检查结果。专业模式“添加文件”和简单模式“选择文件”现统一调用已有导入检查流程，工作台挂载同一确认窗口并显示选择失败错误。敏感项显示拒绝原因、不可勾选；混合批次只确认可读项，复用既有确认后工作区接入。没有 Rust、IPC、数据库或权限变更。

修正后前端 42 文件 / 200 项测试、typecheck、lint 通过；新增仅敏感项与混合批次的入口回归，并更新简单模式入口测试。

用户已按 [S4_1_MANUAL_ACCEPTANCE.md](S4_1_MANUAL_ACCEPTANCE.md) 完成桌面验收，并于 2026-09-17 明确回复 `S4.1 验收通过`。验收包含 LOG-0137 对工作台三类资料入口的可理解敏感文件拒绝修正。当前结论：`S4.1 已完成`；允许开始 S4.2。
