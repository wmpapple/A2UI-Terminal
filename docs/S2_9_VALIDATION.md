# S2.9 Context Pack 与授权撤销自动验证记录

日期：2026-09-10（Asia/Shanghai）。基线：`main` / `cd3918c`（S2.8 用户验收提交）。关联实施账本：LOG-0101/LOG-0102。当前状态：待人工验收，不是已完成；不得开始 S3.1。

## 实现结论

- schema 从 v11 升级为 v12，新增 `context_packs` 与 `context_pack_items`。资料包只保存 `workspace_id`、`source_id`、名称、顺序和时间戳，不保存正文、Prompt、Provider、绝对路径或已确认 Manifest。
- 新增 `list_context_packs`、`create_context_pack`、`delete_context_pack` 三项最小 IPC，并同步最小 Capability 与自动生成权限。创建输入使用严格 serde，额外的正文、路径、Prompt 或 Provider 字段会被拒绝。
- Rust 在 `plan_context` 内按当前工作区展开资料包，随后复用既有 Context Manifest 规划器逐项读取并重新鉴权；跨工作区、已删除、已撤销、重复或空资料包均不能绕过。
- 直接勾选的已授权资料在一次发送后从会话选择中移除；资料包选择可以在工作区会话中记住。资料包首次实际发送仍必须生成可信清单并显示具体来源。
- 设置页可以创建/查看/删除资料包，也可以查看和撤销来源授权。删除资料包不删除来源授权或原文件；撤销来源会通过外键清理引用、删除空资料包、清理内存索引并使待确认 Manifest 失效。
- Context Selector 每次重新打开都会从当前会话状态初始化，避免上一次弹窗的临时勾选泄漏到下一次发送。

## 自动验证结果

| 检查                 | 命令                                                                                                         | 结果                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| TypeScript           | `npm run typecheck`                                                                                          | 通过                                                                                                                    |
| ESLint               | `npm run lint`                                                                                               | 通过                                                                                                                    |
| 变更文件格式         | 对本轮 TS/TSX/JSON/Markdown/CSS 执行 `prettier --write` 后复核                                               | 通过；未批量改写无关业务内容                                                                                            |
| 前端单元/组件/合同   | `npm test -- --reporter=dot`                                                                                 | 41 个文件、179 项测试通过                                                                                               |
| S2.9 Web Mock 端到端 | `npm run test:e2e -- --grep "remembers context packs"`                                                       | 1/1 通过                                                                                                                |
| 全量 Web Mock 端到端 | `npm run test:e2e -- --workers=1 --retries=2`                                                                | 12/12 业务用例通过；3 条旧用例首次 `page.goto` 遇到本机 Chromium `Page crashed`，retry #1 通过，S2.9 新用例本轮直接通过 |
| 前端生产构建         | `npm run build`                                                                                              | 通过；保留既有大 chunk 提示                                                                                             |
| Rust 测试编译        | `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-features --tests -j1`                       | 通过                                                                                                                    |
| Rust 单元与集成合同  | `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features -j1`                                | 142 个单元测试通过、1 个预览测试按设计忽略；6 个架构、1 个命令注册、11 个合同测试通过                                   |
| Rust 格式            | `cargo +stable fmt --manifest-path src-tauri/Cargo.toml --check`                                             | 通过                                                                                                                    |
| Rust 严格 lint       | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -j1 -- -D warnings` | 通过                                                                                                                    |
| 桌面 debug 构建      | `cargo build --manifest-path src-tauri/Cargo.toml --locked --all-features -j1`                               | 通过；仅 Windows 链接器建库提示                                                                                         |
| 桌面启动冒烟         | `powershell -File scripts/smoke-desktop.ps1 -BinaryPath src-tauri/target/debug/a2ui-terminal.exe`            | 隔离数据目录启动通过，测试进程由脚本关闭并清理                                                                          |
| Git whitespace       | `git diff --check`                                                                                           | 通过；仅有仓库既有 LF/CRLF 提示                                                                                         |

Rust 首次并行测试编译遇到本项目文档已记录的随机 Windows `STATUS_ACCESS_VIOLATION`；按人工验收单中的当前 PowerShell 单核、关闭增量编译设置重跑后通过。全量 Playwright 的 3 次失败也均发生在 `page.goto` 的 Chromium 进程启动阶段，retry #1 通过，不是页面断言失败。以上临时设置和重试没有修改全局环境或项目工具链，历史失败记录没有被删除。

## 关键断言

- 数据库测试覆盖 v12 迁移、失败回滚、工作区级创建/删除，以及撤销来源后引用级联清理。
- Rust 应用测试覆盖跨工作区拒绝、同名/重复来源拒绝、资料包展开为具体候选、删除资料包后来源仍存在、撤销最后一项后空资料包消失。
- Rust/TypeScript 共用 `contracts/v2/context-pack.json`；合同测试确认响应可往返，并确认创建输入不能携带正文、路径、Prompt 或 Provider。
- 前端测试覆盖资料包 store 的加载/创建/删除/撤销同步、Manifest 输入中的 opaque pack id、Web Mock 的逐项展开、Selector 的逐项预览，以及会话中撤销来源/删除资料包后清除旧选择和确认状态。
- 浏览器端到端覆盖：仅本次来源发送后取消勾选；创建资料包；保存资料包后首次发送强制可信清单；清单显示具体 `sales.xlsx`；确认后会话记住；删除资料包仍保留来源；撤销来源后空资料包同步消失。

## 待人工检查

真实桌面 SQLite 重启持久化、不同工作区隔离、设置页实际操作手感、原文件在撤销/删除后的磁盘保留，以及真实 Rust 内存索引和旧 Manifest 失效，请按 [S2.9 人工验收单](S2_9_MANUAL_ACCEPTANCE.md) 完成。自动测试不把 Web Mock 当作真实文件系统验收。

## 限制与边界

- P0 不提供资料包编辑/重命名；需要调整时删除并重建。
- 本阶段不复制或缓存资料正文到资料包表，不提供跨工作区共享、云同步或后台索引持久化。
- 删除资料包不会撤销来源；只有用户明确执行“取消授权”才清理来源引用和检索索引。
- 没有开始 S3.1，也没有修改 Provider、A2UI Catalog、导出格式或发布签名流程。
