# S3.4 首批真实小工具验证记录

日期：2026-09-16（Asia/Shanghai）。基线：用户已复验通过的 S3.3，commit `26964a8`。关联实施账本：LOG-0122—LOG-0124。当前状态：实现和自动验证完成，`READY FOR USER ACCEPTANCE`；S3.5 未开始。

## 实现结果

- 首批只开放两个真实闭环：检查表和单项项目计划表。Provider 返回严格短计划 `a2ui_tool`，Rust 只接受 `checklist | planner` 两种精确 Schema，再编译为固定本地组件；残缺 JSON、未知字段、未知工具类型、重复/非法清单 key、无效日期和状态均不会被猜测补全。
- Catalog 新增第 20 个固定组件 `ResultSummary`。它只展示同一 Surface 内真实输入的当前值；字段必须绑定 `TextField | Select | Checkbox | Checklist | Date`，每个 Surface 最多一个摘要，不执行表达式、脚本或模型代码。
- 检查表包含可勾选项目、备注和实时“当前检查结果”；计划表包含任务、负责人、截止日期、固定状态和实时“当前计划结果”。两者的输入都通过现有低风险 `set_state`，前端只提交组件事件和值，Rust 从 SQLite 重读声明后再次校验类型和范围。
- 合法工具会自动关联 Result。Rust 从持久化 Surface 状态投影为 `settings[{key,label,value}]` 可读 JSON，并为每次实际内容变化创建新的 `document_versions` Revision；相同状态不会重复造版本，最多保留最近 100 个自动快照。
- 工具 Result 使用既有 Export Service 和系统保存对话框导出 JSON，仍绑定当前 Revision、拒绝旧版本混用并沿用原子写入/冲突处理。导出不包含组件树、Action、聊天、Prompt、Context Manifest、原始模型输出或 Inspector 调试信息。
- 普通展示 Surface、旧项目面板和 S3.3 审阅卡没有 `ResultSummary`，不会获得便携 Revision，也不会因本阶段改动在 Review 接受前提前创建成果。

## 自动验证

以下命令在 Windows、Rust stable、schema v12 上执行：

```text
npm run lint
通过

npm run typecheck
通过

npm test -- --run
41 个测试文件、190 项通过

npm run build
通过；仅保留既有 bundle 体积提示

npm run test:a2ui-conformance
6/6 通过

cargo test --manifest-path src-tauri/Cargo.toml --locked --tests -j1 -- --test-threads=1
Rust lib 165 项通过、1 项人工 PDF 预览按设计忽略；A2UI Action→Review 3/3、conformance 6/6、架构 6/6、命令注册 1/1、合同 12/12 全部通过

cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -j1 -- -D warnings
通过

cargo fmt --manifest-path src-tauri/Cargo.toml --check
通过
```

全量 Rust 集成门使用独立 `src-tauri/target/s34-validation`，没有停止或覆盖用户正在运行的桌面进程。首次构建耗时约 9 分 26 秒并正常越过 `webview2-com-sys`，无 OOM、访问异常或业务失败。

## 安全断言

- `a2ui_tool` 只是 Provider → Rust 的短计划 DTO；只有完整且字段精确时才编译，最终 Surface 仍必须通过官方 v0.9.1/本地 Catalog/Props/树/Action/资源与实时结果绑定校验。
- `ResultSummary` 不接受 HTML、模板表达式、计算代码、URL、命令、动态组件或任意结果正文；结果值只能来自 Rust 已验证的持久化输入状态。
- 后续 Action payload 不能伪造清单 key、固定状态、布尔值或日期；不合法 payload 在写入状态、审计成功记录和新 Revision 前被拒绝。
- 导出读取当前 Revision，无法通过前端传入正文、路径或旧 Revision 绕过；普通 Surface 没有 Revision 时导出按钮禁用，Rust 也会拒绝直接绕过。
- 集成门首次发现“所有 Action 后补建 Result”会破坏 S3.3 接受前零成果断言；实现已收紧为仅真实工具补建，并由原 `a2ui_action_review` 3/3 回归确认审阅卡不会提前产生 Result。

## Migration / IPC / Capability

- Migration：无，schema 仍为 v12。
- IPC：无新增命令，复用 A2UI Action、Result、Revision 和 Export IPC。
- Tauri Capability：无变化。
- 协议能力：本地 Catalog 从 19 个固定组件增至 20 个，新增 `ResultSummary`；Action 仍严格为 `set_state | submit_form | request_patch`。

## 人工验收

### 长时间等待反馈修正（LOG-0128）

- 用户确认停止按钮有效。已确认代码缺陷：每个网络块均重建空闲计时，心跳/仅 reasoning 数据可把无正文等待延长到 15 分钟。未读取用户凭据或调用真实 Provider，因此不能断言此次远端具体阻塞原因。
- 修正：60 秒无非空正文即返回明确的可重试超时，正常正文持续输出继续刷新计时；A2UI 单次自动修复总时限 90 秒，不改变严格校验。同步中英文等待文案。
- 自动验证：Rust lib 166 项通过、1 项人工 PDF 预览忽略；TypeScript 类型检查通过。新增本地 HTTP/SSE 模拟覆盖心跳、仅思考、空正文的超时及持续正文成功，取消回归仍通过。
- 桌面复验：完全退出旧进程，重新运行 `npm run desktop:dev`，发送 M01。正常应生成工具；若服务商不返回正文，应明确报超时而不是长期转圈。响应头最多等待 45 秒，之后开始正文计时；不能把该修复理解为保证模型 60 秒内生成成功。


### M01 人工反馈修正

- 根因：`requires_a2ui_review_action` 将“自动保存为成果”中的“保存为成果”识别为文件审阅意图，导致合法工具被强制要求 `request_patch`，失败重试也进入了错误的审阅卡模板。
- 修正：自动保存短语不触发保存按钮要求；明确的 `document_patch`、`request_patch`、“查看修改”等仍保留审阅约束。必需 `ResultSummary` 时，不合法的短计划不能退回普通聊天绕过校验。
- 回归：测试直接读取本验收单 M01/M02 原提示词，验证意图、可信编译、实际协议校验、残缺计划拒绝、工具修复模板及显式文件审阅仍生效。
- 本轮 Rust lib：165 项通过、1 项按设计忽略。真实 Provider 与桌面交互仍待用户重启后复验，不能用自动测试替代人工通过。


请按 [S3.4 人工验收单](S3_4_MANUAL_ACCEPTANCE.md) 在重新启动后的 Windows 桌面应用完成检查表、计划表、重启恢复、历史版本和真实 JSON 文件导出。用户明确回复 `S3.4 验收通过` 前，本阶段不得标记 COMPLETE，也不得开始 S3.5。
