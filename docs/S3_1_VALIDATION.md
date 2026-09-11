# S3.1 A2UI 标准一致性与版本协商自动验证

日期：2026-09-10，人工验收修复更新于 2026-09-11（Asia/Shanghai）。基线：`main` / `9ff2540`（S2.9 用户验收提交）。关联实施账本：LOG-0104/LOG-0105/LOG-0106。当前状态：自动验证完成，待人工复验；不得开始 S3.2。

## 实现结论

- Rust 新增官方 A2UI `v0.9.1`/`v0.9` 服务端消息解析，在 A2A DataPart 中原子处理 `createSurface`、`updateComponents` 和 `updateDataModel`。
- 客户端只声明本地 `urn:a2ui-terminal:catalog:basic:v1`；13 个组件与 3 个 Action 继续经过既有 Props/Action 白名单。未宣称支持官方完整 Basic Catalog。
- `get_a2ui_capabilities` 是唯一新增 IPC，为无输入、只读、Rust 生成的能力合同；主窗口 Capability、自动生成权限、Rust/TypeScript DTO 和共享 fixture 同步更新。
- Inspector 新增收到/选择的版本、Catalog ID 与稳定错误码。不兼容输入只保存检查证据，不创建/更新 Surface。
- 官方增量批次以一个 `surfaceId` 原子提交；组件引用缺失、循环、不可达、混合版本和跨协议更新均拒绝。`updateDataModel` 区分省略值的删除与显式 JSON null。
- 旧私有 `version: "1.0"` 的 `a2ui_surface/a2ui_update` 保留兼容，但明确不等同于官方 A2UI 1.0。
- schema 保持 v12；复用已有 `a2ui_surfaces.protocol_version`，没有 migration。
- 当前交付与验收范围是 Windows 桌面，Rust 库只生成桌面应用与集成测试实际消费的 `rlib`，避免每次测试为未启用的移动端重复生成 `staticlib/cdylib`。未来若正式启动 Tauri Android/iOS，必须恢复对应共享库产物并单独验收移动构建。

## 2026-09-11 人工验收缺陷与修复

- M01 实测中 Provider 只定义了 `root`，却让 `children` 引用不存在的 `title`、`input` 和 `button`。Rust 返回 `A2UI_VALIDATION_FAILED` 且没有渲染，说明安全门行为正确，但生成提示中的空 `children` 骨架不足以指导真实 Provider 生成完整扁平组件表。
- 系统提示现改为由 Rust capability 动态生成的完整表单范例，包含 `root`、标题、Form、TextField、Button、Data Model 与 Action，并明确“引用不会创建组件；所有 child id 必须在同一 components 数组中恰好定义一次”。该范例由真实 `process_message` 校验器执行单元测试，避免文档示例与运行时漂移。
- 首次 Provider A2UI 输出校验失败时，聊天链路只自动请求一次完整重生成。重试携带原 Provider 输出和最多 1200 字符的校验错误；首次失败 Inspector 记录保留，重试仍经过完全相同的 Rust 校验，不做客户端补节点、不放宽 Catalog/Action/Props/树约束。
- 后续人工复验发现标准 DataPart 使用 `createSurface/updateComponents`，而聊天前端只识别旧私有 `a2ui_surface/a2ui_update`，导致有效协议 JSON 被当成普通消息展示。前端现以 `A2UI_READY/A2UI_VALIDATION_FAILED` 和新旧协议标记共同识别 A2UI；后端最终聊天正文改为人类可读的成功/失败说明，原始 JSON 只保留在 Inspector。新增组件回归断言聊天中不存在 `createSurface` 和 MIME 字符串。
- 本修复不新增 schema、IPC、Capability 或权限；需完全重启修复前的桌面进程并在新会话复验 M01。

## 固定上游证据

- 上游仓库：`a2ui-project/a2ui` commit `981e82f1a3cef88456416fa6fd80d8490964df01`。
- 固定规范：`specification/v0_9_1/json/server_to_client.json` 与 `client_capabilities.json`。
- 未修改上游样例：`contracts/a2ui/v0_9_1/upstream/00_simple-text.json`。由于它声明官方 Basic Catalog，而本地没有完整实现该 Catalog，预期在 Catalog 协商处安全拒绝，不进入渲染。
- 本地合法/非法语料：`contracts/a2ui/v0_9_1/runtime-cases.json`。

## 自动验证结果

以下是最终命令与准确结果；中途失败保留在表后，不删除或改写。

| 检查                  | 命令                                                                              | 结果                                  |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| TypeScript            | `npm run typecheck`                                                               | 通过                                  |
| ESLint                | `npm run lint`                                                                    | 通过                                  |
| 前端单元/组件/合同    | `npm test -- --reporter=dot`                                                      | 41 个文件、180 项测试通过             |
| 前端生产构建          | `npm run build`                                                                   | 通过；保留既有大 chunk 提示           |
| S3.1 Rust conformance | `npm run test:a2ui-conformance`                                                   | 5/5 通过                              |
| Rust 共享合同         | `cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures -j1`    | 12/12 通过                            |
| Rust 命令注册         | `cargo test --manifest-path src-tauri/Cargo.toml --test command_registration -j1` | 1/1 通过                              |
| Rust 单元测试         | `cargo test --manifest-path src-tauri/Cargo.toml --lib -j1 -- --test-threads=1`   | 149 通过、1 个人工 PDF 预览按设计忽略 |
| Rust 完整回归         | 隔离 target 执行 `cargo test --locked --all-features -j1 -- --test-threads=1`     | 173 通过、1 个人工 PDF 预览按设计忽略 |
| Rust check            | `cargo check --manifest-path src-tauri/Cargo.toml --all-targets`                  | 通过                                  |
| Rust 严格 lint        | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`  | stable 1.98.0 临时环境通过            |
| Rust 格式             | `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`                 | 通过                                  |
| 本阶段 Prettier       | `npx prettier --check <本阶段 TS/TSX/JSON/Markdown 文件>`                         | 通过                                  |
| 桌面 debug 构建       | 隔离 target 后执行 `cargo build --locked --all-features -j1`                      | 通过                                  |
| 桌面启动冒烟          | `scripts/smoke-desktop.ps1 -BinaryPath <隔离 debug exe>`                          | 通过；脚本关闭测试进程并清理数据      |
| Git whitespace        | `git diff --check`                                                                | 通过；仅仓库既有 LF/CRLF 提示         |

## 中途环境失败记录

- 首次严格 Clippy 使用活动的 Rust 1.97.1 时发生编译器内部错误与 `STATUS_ACCESS_VIOLATION`。改用人工验收文档既有的单核、stable 1.98.0、32 MiB stack、关闭增量编译设置后通过；未修改全局工具链。
- `npm run check` 在仓库级 `prettier --check .` 阶段先报告多项历史文件未格式化，随后 Node/Prettier 自身 `Invalid jump table index` 崩溃，因此没有被记为通过。为避免批量改写无关文件，本阶段只格式化并复核变更文件，lint、typecheck、test、build 分别执行并通过。
- 首次并行 Rust lib 测试中，既有 `cancels_while_waiting_for_provider_headers` 时序用例在负载下失败；单独复跑通过。全量并行复跑仍在同一项失败，随后使用 `--test-threads=1` 全量串行复跑通过。
- 工作区已有一个由用户运行的 `src-tauri/target/debug/a2ui-terminal.exe` 占用主 target，导致链接阶段无法替换该文件。没有擅自终止用户进程；最终桌面链接/全量集成验证使用隔离的已忽略 target 目录。
- 2026-09-11 修复回归时，单条 `cargo test --locked --all-features` 同样因该运行中 exe 无法替换而退出；完整 lib 在主 target 通过，4 个 integration target 在既有隔离 target 逐个通过，合计即表中的 173 项。另一次新建空 target 的从头依赖构建长时间无进度，已通过会话内 Ctrl+C 只终止本次测试进程，没有终止用户桌面进程，也没有将其记为测试通过。
- 用户按原 M04 命令执行时，stable 1.98.0/LLVM 22.1.8 在尚未进入测试前报告 `rustc-LLVM ERROR: out of memory` 并以 `0xc0000409` 退出；事后系统仍有约 20.8 GiB 可用物理内存，因此归类为已知 Windows 编译器/多产物构建崩溃，而非 A2UI 断言失败。现新增 `scripts/test-a2ui-conformance.ps1` 与 `npm run test:a2ui-conformance`：固定 stable、单任务、禁用增量编译、串行测试及隔离 target，并让当前桌面库只生成测试所需 `rlib`。新命令实测约 29 秒完成编译并 5/5 通过；同一隔离 target 的完整 173 项测试、严格 Clippy、桌面 debug 构建和启动冒烟随后均通过。

## 安全断言

- 非法版本、Catalog、组件、Action 和未修改的官方 Basic Catalog fixture 都返回无 Surface 的检查结果。
- 同一 DataPart 的变更要么全部通过并递增 revision，要么全部拒绝；无部分持久化。
- Capability 不增加文件、网络、Shell、剪贴板、Provider、遥测或任意路径权限。
- 原始检查消息继续受 256 KiB 限制；验证记录与合同 fixture 不包含用户正文、绝对路径、Prompt、凭据或 Provider 配置。

## 待人工检查

真实 Provider 是否按系统提示生成标准 DataPart、桌面 Capability 标签、Inspector 协商证据、Action 交互和重启恢复，请按 [S3.1 人工验收单](S3_1_MANUAL_ACCEPTANCE.md) 完成。人工通过前本阶段不是 `COMPLETE`，不得进入 S3.2。
