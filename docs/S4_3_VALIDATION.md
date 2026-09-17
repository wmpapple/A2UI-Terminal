# S4.3 隐私安全产品事件与 KPI 验证记录

> 状态：实现与自动验证已完成，等待用户人工验收；人工验收通过前不得开始 S4.4。

## 1. 范围与基线

- 日期：2026-09-17（Asia/Shanghai）
- 基线 commit：`343052c`（`s4.2`），开始前工作树干净
- 对应实施记录：LOG-0141、LOG-0142、LOG-0143
- 范围：严格产品事件字典、字段 allowlist、六项核心成果 KPI、首次核心闭环邀请、隐私开关和开启前字段预览
- 明确不做：匿名指标上传、接收端、后台队列、服务端保留/聚合/删除、远程仪表盘、用户或设备追踪；这些仍受 O-06 阻塞

## 2. 实现结论

schema v14 新增单例 `telemetry_settings` 和本机 `product_events`。指标默认关闭；关闭时 Rust 不写产品事件。首次成功保存、导出或应用已审阅修改只把邀请资格写入本机设置，不追溯记录事件，也不自动开启开关。

用户主动开启后，Rust 强类型 `ProductEvent` 只生成 17 个固定事件。事件值继续使用固定枚举：Review 决定、成功/失败/取消、错误类别、处理位置、导出格式、首次闭环触发方式、性能操作和耗时区间均不能由前端或任意字符串注入。SQLite 同时以事件名 CHECK、事件版本、Windows 平台和 4096 字节属性上限收紧存储。

设置页提供：

1. 默认关闭的“帮助改进产品”开关；
2. 首次闭环后仅在设置页出现的非阻断邀请；
3. 开启前也可使用的“查看将发送的数据”；
4. 本机事件数和 Task Completion、Review Adoption、Accepted Patch、Undo、Export/Save、Context Confirmation 六项成果 KPI；
5. 当前无上传接收端、计数只在本机的明确说明。

## 3. 安全、隐私与删除边界

- 公共字段只有事件名、事件版本、应用版本和平台；不保存安装、用户、工作区、会话、成果或任务 ID。
- 属性只允许固定布尔值与类别；文档正文、Prompt、AI 回复、文件名/路径、图片、API Key、具体 Endpoint/模型 ID、姓名、邮箱、身份信息和本地索引内容禁止进入事件。
- 前端没有任意产品事件写入 IPC；仅能读取设置/字典和切换开关。三个命令均使用主窗口最小 Capability。
- `uploadConfigured=false` 且 `collectionMode=local_only`；没有上传队列、遥测 HTTP 客户端、接收端或后台发送路径。
- 关闭开关在同一事务中停止后续采集并删除全部本机产品事件；一键清理删除产品事件和设置后重建默认关闭行。
- 诊断导出只增加 `product_events` 数量，不包含属性、时间、正文或事件明细。
- 指标写入失败被产品动作隔离，不能使保存、导出、Review、Task、AI 或 A2UI 操作失败。

## 4. 合同、迁移与 KPI

- 共享 fixture `contracts/v2/telemetry.json` 同时由 Rust serde 和 TypeScript guard 消费；guard 固定 17 个事件名、六个 KPI 名称、`local_only` 和 `uploadConfigured=false`。
- schema v14 进入初始建库、逐版本升级、完整性和一键清理测试；迁移只前向增加两张表，不修改既有业务表或成果文件。
- KPI：任务完成/任务创建、AI 审阅采用/审阅展示、AI 接受修改/审阅采用、发送清单确认/准备；保存/导出和撤销/恢复成功率采用固定 performance_sample 的 success/(success+failure)，取消排除。无操作结果样本时暂无样本，不再依赖创建时间。旧导出事件不追溯伪造配对样本。
- 不采集或展示 DAU、消息数、模型调用量，也不以这些虚荣指标替代成果指标。

## 5. 自动验证结果

| 验证                                                                                                | 结果                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                                                                 | 通过                                    |
| `npm run lint`                                                                                      | 通过                                    |
| `npm test -- --run`                                                                                 | 44 个文件、206 项通过                   |
| `npm run build`                                                                                     | 通过；仅保留既有 bundle size 提示       |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j1`                                | 178 项通过、1 项人工 PDF 预览按设计忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures -j1`                      | 15 项通过                               |
| `cargo test --manifest-path src-tauri/Cargo.toml --test command_registration -j1`                   | 1 项通过                                |
| `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_boundaries -j1`                | 6 项通过                                |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- -D warnings` | 通过                                    |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、Prettier、`git diff --check`           | 通过                                    |

定向覆盖包括：默认关闭且零写入、主动开启、关闭事务清除、首次闭环仅产生本机邀请资格、17 类事件禁止字段扫描、强类型类别、六项 KPI 分子/分母、v14 初始/升级/清理、Rust/TypeScript 共享合同、三项命令注册与最小权限，以及设置页开启前字典、邀请和关闭路径。

Windows Rust stable 1.98.0 在一次未设置 ProcessorAffinity 的增量定向复跑中发生既有随机 `STATUS_HEAP_CORRUPTION`；按项目记录的单核临时环境原命令复跑为 4 项全部通过。该编译器进程异常不作为代码通过证据，表中只记录成功完成的验证。

## 6. 待人工验收

LOG-0156/0157 取代旧比例口径：保存/导出、撤销/恢复使用单条操作结束结果构成 success/(success+failure)，无创建分母；取消排除。工作台保存、独立文件保存、Result 恢复与工作区版本恢复均已接入。应用层 72 项通过、1 项忽略，新增真实旧文件保存/恢复所在 3 项通过；前端设置 3 项、typecheck、lint、严格 Clippy 通过。此前缺少基数提示不再用于这两项；历史未记录的操作结果不伪造。

LOG-0154：定位本机早期 v14 CHECK 缺少 result_created 等五类事件，修改 v14 SQL 对存量数据库不生效。新增 v15 事务迁移原样复制事件、扩展固定白名单且保留开关。此前入口修复不能替代本次存量 schema 修复；需重启当前开发构建迁移后新建成果复验。

LOG-0152/0153：创建事件此前散布于命令层，复制、文件首次登记与 Surface 创建漏记。现托管创建集中在公共创建函数，文件/Surface 仅真正新建聚合时计数，移除重复命令记录；8 项成果测试通过。现有缺失记录不回填；缺少创建记录不能据此认定文件创建于开启前。

LOG-0150/0151：导出开启前已有成果会产生导出事件但没有创建分母。界面现显示已有次数及缺少比例基数，不再误报暂无样本；没有补造历史或改变比例口径。typecheck、设置组件 3 项回归通过。

LOG-0148/0149 修正：旧代码开启指标也会设置邀请已处理，现只有具备邀请资格且明确点击邀请按钮才处理邀请。用户报告只保存文档，本机错误隐藏位已按授权条件修复，保持采集关闭。Rust 遥测 5 项、React 设置 2 项、typecheck 通过；此前“曾开启后不重复显示”描述由本条取代，不能以跳过 M02 代替验证。

M02 复验修正（LOG-0144、LOG-0145）：工作台和独立授权文件的保存入口此前未设置首次闭环邀请资格，现已在实际保存成功后统一接入。新增两项 Rust 临时文件回归通过，验证保存成功触发、冲突/草稿不触发和关闭时事件数为零。邀请已拒绝或指标曾开启后不重复显示，验收单已说明。

真实桌面默认状态、首次闭环邀请、字段可理解性、本机计数、开关跨重启、断网无上传和关闭清除仍需按 [S4_3_MANUAL_ACCEPTANCE.md](S4_3_MANUAL_ACCEPTANCE.md) 完成 M01—M06。用户明确回复 `S4.3 验收通过` 前，S4.3 不得标记为完成，也不得开始 S4.4。
