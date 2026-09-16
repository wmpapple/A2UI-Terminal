# S3.5 个人安全 Surface 模板验证记录

> 状态：实现和自动验证完成，等待用户人工验收；验收通过前不得开始 S4.1。

## 1. 范围与基线

- 日期：2026-09-16（Asia/Shanghai）
- 基线：`3880293`（`s3.4`），开始前工作树干净
- 对应实施记录：LOG-0130、LOG-0131
- 范围：保存、列表、重开和删除工作区级个人安全 Surface 模板；schema v13；四个最小本地 IPC/Capability；模板页和 Surface 保存入口
- 明确不做：通用 Prompt/代码模板、HTML/JavaScript/React/iframe/URL/dynamic npm、Shell、系统命令、远程资源、工作区外文件访问、S4.1 搜索

## 2. 实现结论

S3.5 已形成最小闭环：用户可从桌面端已通过安全校验的官方 A2UI v0.9/v0.9.1 Surface 主动“保存为模板”，在“模板”页查看版本、Catalog、兼容状态和普通用户可理解的权限说明，并安全打开为一个新的 Surface。

Rust 是模板事实源和唯一信任边界。保存前重新读取 SQLite 中的来源 Surface，完成协议、Catalog、Schema、组件树、Props、Action 和资源限制校验，并清空 TextField、Date、Checkbox、Checklist、Select 的当前输入。模板不复制聊天、Prompt、Context Manifest、Inspector/Provider 原文、绝对路径、Result、Revision 或文件正文；包含 `request_patch` 文件修改候选的 Surface 明确拒绝保存。

每次重开均重新校验模板快照和 Rust 推导的权限摘要，成功后创建新的 Surface ID 与 revision 1。协议/Catalog 过期、Schema 或权限篡改、跨工作区引用和未知可执行字段均拒绝渲染或执行。删除模板不级联删除来源 Surface、Result、Revision 或真实文件。

## 3. 数据、IPC 与权限

- SQLite：schema `12 → 13`，新增 `a2ui_templates` 和工作区索引。
- 生命周期：模板随工作区删除；`source_surface_id` 只作来源提示，不设 Surface 外键，因此来源 Surface 删除后模板仍可复验并打开。
- 唯一性：同一工作区模板名称唯一；不同工作区互相不可见。
- IPC：新增 `save_a2ui_template`、`list_a2ui_templates`、`open_a2ui_template`、`delete_a2ui_template`。
- Capability：四个命令均使用主窗口最小 allow 权限；未新增网络、Shell、任意文件、剪贴板、Provider 或遥测权限。
- 前端模板列表只接收元数据、有效状态和权限说明，不接收模板快照 JSON。

## 4. 自动验证结果

以下命令均在项目根目录执行：

| 验证                                                                                                | 结果                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm run lint`                                                                                      | 通过                                    |
| `npm run typecheck`                                                                                 | 通过                                    |
| S3.5 变更文件 `prettier --check`                                                                    | 通过                                    |
| `npm test -- --run`                                                                                 | 42 个文件、195 项通过                   |
| `npm run build`                                                                                     | 通过；仅保留既有 bundle size 提示       |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                                         | 通过                                    |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -j1`                                         | 170 项通过、1 项人工 PDF 预览按设计忽略 |
| 五个 Rust 集成测试目标                                                                              | 28 项通过                               |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- -D warnings` | 通过                                    |
| `git diff --check`                                                                                  | 通过（仅 Git 的 CRLF 工作树提示）       |

S3.5 定向覆盖包括：

- 保存后输入值被清空，且原始 Provider 消息不进入模板记录；
- 重开创建不同 Surface，模板和来源 Surface 生命周期独立；
- `request_patch` 模板保存被拒绝；
- 权限摘要变化、跨工作区打开、Catalog/Schema/可执行字段篡改均安全拒绝；
- schema v13 从所有历史版本连续升级，并在迁移失败时回滚表和 `user_version`；
- Tauri 命令注册、Capability allowlist、前端模板列表/打开和失败保留当前 Surface 均有回归测试。

一次把前端生产构建与单核 Rust 全量测试并发执行时，既有 `cancels_while_waiting_for_provider_headers` 的 500 ms 计时断言受资源争用超时；该测试单独复跑通过，随后 Rust 全量再次执行并全部通过。最后一轮 Vitest 首次执行还发生一次 worker 异常退出，S3.5 定向测试与 42 文件全量均立即复跑通过。首次隔离目标编译也出现过本机已知的随机 `rustc` Windows 访问异常，使用项目验收文档中的单核临时设置重试后通过；这些瞬时运行环境问题都没有留下功能失败。

全仓 `npm run format:check` 仍会报告 145 个历史文件未采用当前 Prettier 输出；本阶段没有机械改写这些无关历史文件。S3.5 涉及的前端和文档文件已单独执行并通过 Prettier 检查，Rust 文件已通过 `cargo fmt --check`。

## 5. 待人工验收

自动验证不能代替桌面应用中的真实保存、跨重启、交互输入清空、来源删除后重开和用户文案检查。请按 [S3_5_MANUAL_ACCEPTANCE.md](S3_5_MANUAL_ACCEPTANCE.md) 完成 M01—M06。

当前结论：`S3.5 待人工验收`。用户明确回复 `S3.5 验收通过` 前，不得开始 S4.1。
