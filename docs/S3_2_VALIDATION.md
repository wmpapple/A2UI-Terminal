# S3.2 大众 Catalog 扩展验证记录

日期：2026-09-11（Asia/Shanghai），人工验收与缺陷修复完成于 2026-09-15。基线：`main` / `8222b9e`（S3.1 用户验收提交）。关联实施账本：LOG-0109—LOG-0114。当前状态：用户人工验收通过，S3.2 `COMPLETE`；S3.3 已按独立账本开始。

## 实现结果

- 本地 `urn:a2ui-terminal:catalog:basic:v1` 从 13 个基础组件扩展为 19 个固定组件，新增 `Checklist`、`Owner`、`Date`、`Status`、`Table`、`IssueCard`；仍不冒充官方完整 Basic Catalog。
- Rust `COMPONENT_PROP_SCHEMAS` 为每个 Catalog 组件绑定独立允许字段；六个新增组件再使用各自专用校验函数约束必填字段、集合规模、唯一 key、有效日历日期、表格列/基础类型单元格、Issue 状态和优先级枚举。
- 清单和日期只复用现有 `set_state`，缺少 `change` 声明时沿用既有安全规范化；未新增 Action 类型。表格、负责人、状态和 IssueCard 不执行隐式行为。
- React Runtime 使用显式 `switch` 固定映射。清单使用 `fieldset/legend` 与原生复选框语义，日期使用可聚焦的原生日期输入，表格使用 `caption/thead/th/tbody/td` 和可聚焦滚动区域，状态、日期展示与 IssueCard 使用 `status/time/article/dl` 等语义。
- 架构回归扫描 Runtime 源码，要求六个固定 `case` 全部存在，并拒绝 `import()`、`dangerouslySetInnerHTML`、`srcDoc` 和 `iframe`。
- Provider 系统提示从 Rust capability 动态生成组件和 Action 清单，并明确六类新增 Props；现有完整表单范例、一次受限修复和聊天可理解状态卡片保持不变。
- M01 真实 Qwen 首次输出与自动重试曾原样复现同一处缺少 `{` 的非法 JSON。修复后，项目面板使用经生产校验器验证的紧凑七节点模板；JSON 语法失败不再回喂完整坏串，而是从该模板重新生成。Rust 不自动修补 JSON，最终结果仍必须完整通过同一安全门。
- 失败 Surface 主区域只显示用户可理解说明，解析器/Schema 细节只在专业 Inspector；前端不会再把技术错误复制到顶部通知。
- Inspector 的 Surface 与安全检查选择器不再以内部 Surface ID、UUID 或消息 ID 作为可见主标签，改为“交互成果 1”“检查记录 1 · 未通过 · 最新”等编号与状态；固定说明解释安全检查、执行条件、本机保存和失败记录删除边界。
- 失败检查记录新增独立二次确认删除。Rust 只接受当前工作区与不透明检查记录 ID，并以同一条 SQL 限定 `valid=0`；成功检查、Surface、Result、Action、聊天、文件和其他记录不受影响。取消、找不到目标、跨工作区或后端失败时前端不移除本地记录。

## 合同与 fixture

- `contracts/v2/a2ui-capabilities.json` 固定 19 个本地组件。
- `contracts/a2ui/v0_9_1/runtime-cases.json` 增加六组件合法官方 DataPart 和非法日期 Props；两者均通过与生产相同的 Rust 解析、协商、Schema 与持久化入口。
- Rust conformance 6/6：合法扩展 Surface 可渲染；非法扩展 Props 返回 `A2UI_VALIDATION_FAILED` 且 `surface=null`。不兼容版本/Catalog、未知组件/Action和未修改的上游 Basic fixture 继续安全拒绝。

## 自动验证

以下命令在 Windows、stable Rust、schema v12 上执行：

```text
npm run lint
通过

npm run typecheck
通过

npm test
41 个测试文件、185 项通过

npm run build
通过；仅保留既有主 bundle 体积提示

npm run test:e2e
LOG-0113 最新完整运行 9/12 通过，3 项在 `beforeEach` 的 `page.goto('/')` 遇到 Chromium `Page crashed`，均未进入业务断言；按用例行号复跑后 2/3 通过，余下 1 项仍在导航处崩溃，第二次单独复跑 1/1 通过。结合本轮相关组件/Store 单测与完整前端测试通过，判定为浏览器进程临时崩溃，不记作产品通过证据；最终 12 项业务用例均有通过结果

npm run test:a2ui-conformance
6/6 通过

cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features -j1 -- --test-threads=1
Rust lib 153 项通过、1 项人工 PDF 预览按设计忽略；A2UI conformance 6/6、架构 6/6、命令注册 1/1、合同 12/12，通过总数 178

cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -j1 -- -D warnings
通过

cargo fmt --manifest-path src-tauri/Cargo.toml --check
通过
```

仓库级 `npm run format:check` 仍会报告 157 个历史文件不符合当前 Prettier 配置；其中绝大多数不在 S3.2 修改范围，且该问题在开始本步骤前已经存在。为避免把全仓机械格式化混入本阶段，本轮所有变更的前端、合同和文档文件已单独执行 `prettier --write` 并通过定向检查；本项不记为全仓格式门通过，也不影响上述 lint、typecheck、测试与构建结论。

首次在默认 target 定向重编译时发生一次本项目已记录的 Windows `rustc` 随机 `STATUS_ACCESS_VIOLATION`，尚未进入测试。M06 修复的首次默认 target 编译又因用户当前桌面进程占用 `target/debug/a2ui-terminal.exe` 返回 Windows `os error 5`；没有终止用户进程，改用 S3.1 已固化的单核、关闭增量和隔离 `src-tauri/target/s31-validation`。隔离 target 首次编译无关 `contract_fixtures` 时再次发生随机 `STATUS_ACCESS_VIOLATION`，原命令利用已生成缓存重跑后实际进入并通过新增 Rust 回归。上述环境失败均未被计作测试通过证据。

## Migration / IPC / Capability

- schema 保持 v12；无 migration。
- 新增最小 `delete_a2ui_inspection(workspaceId, inspectionId)` IPC 与主窗口 Capability，仅删除归属当前工作区且 `valid=0` 的单条 `a2ui_messages`；既有只读 `get_a2ui_capabilities` 继续返回扩展后的固定组件列表。
- 不新增文件、网络、Shell、剪贴板、Provider、遥测或远程资源权限。

## 安全、兼容与回滚

- Rust 继续是唯一信任边界；前端只接收已完成协议/Catalog/树/Props/Action/资源限制校验的 Surface。
- 模型不能提供 HTML、JavaScript、React、动态组件、远程头像/URL、公式对象或系统命令。未知字段与可执行字段默认拒绝。
- 官方协议、Catalog ID、SQLite 表和旧私有 `1.0` 兼容读取均未改变；旧 Surface 可继续恢复。
- 失败检查记录默认本地保留供排错，用户显式确认后可单条永久删除；该删除不接受 Surface ID、消息 ID 或数据库外键，也不能删除已通过检查。
- 若回滚 S3.2，移除六个 Rust Schema/组件名、前端固定分支、类型/fixture 和 Provider 说明即可；无数据 migration 需要回退。已持久化的 S3.2 Surface 在旧版本会安全拒绝未知组件，不会执行或部分渲染。

## 人工验收

用户已按 [S3.2 人工验收单](S3_2_MANUAL_ACCEPTANCE.md) M01—M06 完成真实 Provider 六组件生成、Windows 交互、Inspector 19 组件摘要、失败记录删除及跨重启恢复，并于 2026-09-15 明确回复验收通过。S3.2 已关闭；后续变更归入 S3.3 独立账本。
