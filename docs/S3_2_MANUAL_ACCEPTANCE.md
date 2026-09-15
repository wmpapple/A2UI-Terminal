# S3.2 大众 Catalog 扩展人工验收

> 范围：只验收 S3.2；通过前不得开始 S3.3。

> 必须在 Windows 桌面应用中检查真实 Surface。Web Mock 可验证既有流程，但不能代替真实 Provider、Rust Schema 和桌面恢复验收。

## 准备

1. 完全关闭旧桌面进程，在项目根目录执行 `npm run desktop:dev`。
2. 切换到专业模式，配置一个可用 Provider，新建会话。
3. 打开工作台的 `Surface` 和 `协议 Inspector` 区域。

如果本机再次遇到随机 Rust/LLVM 编译崩溃，关闭其他 `cargo`/`rustc` 任务后，在新的 PowerShell 会话执行：

```powershell
(Get-Process -Id $PID).ProcessorAffinity = 1
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
npm run desktop:dev
```

## M01 六类大众组件

向 AI 发送以下测试请求（内容可使用虚构数据）：

> 生成一个中文交互式项目执行面板，不要创建文件。面板必须同时包含：两项发布清单（第一项已完成）、负责人 Ada、可修改的截止日期 2026-09-30、进行中状态、两列两行的任务表格，以及一个编号为 A2UI-32 的高优先级 IssueCard。标题和字段都要让普通用户看得懂。

预期：中央 Surface 实际显示 `Checklist`、`Owner`、`Date`、`Status`、`Table`、`IssueCard` 六类内容；不是聊天中的 JSON，也不是 HTML 页面。Inspector 的 Catalog 摘要显示本地 Catalog 共 19 个组件，协议仍为 `v0.9.1`，Catalog ID 仍为 `urn:a2ui-terminal:catalog:basic:v1`。

若 Provider 首次返回缺少逗号/花括号的非法 JSON，系统只允许自动重新生成一次。修复后的版本会从经过 Rust 校验的紧凑七节点模板重新生成，不会把同一错误 JSON 原样再喂给模型；最终仍失败时，主界面只显示用户可理解说明，`expected ','` 等技术详情只应出现在 Inspector，且不得渲染残缺 Surface。

Inspector 顶部的下拉框应显示“检查记录 1 · 未通过 · 最新”等可理解名称，不应直接把 UUID 或 `form-surface-*` 作为主标签。旁边说明必须解释：每次 AI 界面都先经过安全检查，通过后才显示，未通过的不会运行，记录只保存在本机。

## M02 输入、键盘与可访问名称

1. 不使用鼠标，从 Surface 开头连续按 `Tab`，焦点应到达清单复选框、日期输入及表格滚动区域。
2. 在清单复选框上按空格切换完成状态；修改日期为 `2026-10-01`。
3. 查看 Inspector 的 Action 事件。
4. 使用 Windows Narrator 或浏览器辅助功能树检查：清单有组名和项目名；日期有“截止日期”名称；表格有标题、列头和单元格；IssueCard 有标题。

预期：键盘焦点清晰可见；清单和日期状态正常更新。事件只出现声明式 `set_state`，不会发起文件写入、任意网络请求或系统命令；表格、负责人、状态和 IssueCard 只是可信展示，不执行隐藏动作。

## M03 Props Schema 与边界

1. 表格应完整显示两列两行，列头可识别；窄窗口下用键盘聚焦表格区域后可水平滚动，不挤破整个页面。
2. 日期只接受系统日期输入；清单只显示模型声明的有限项目。
3. IssueCard 应显示编号、标题、状态、优先级、负责人和日期；不得显示远程头像、链接预览或加载外部资源。
4. 若 Provider 首次生成的字段不合法，允许系统按既有 S3.1 规则受限重试一次；原失败仍应保留在 Inspector。

预期：最终合法 Surface 完整渲染；任何未知 Prop、重复清单 key、非法日期、未知表格列、对象型单元格、未知状态/优先级或未知组件都由 Rust 返回 `A2UI_VALIDATION_FAILED`，不显示残缺 Surface，也不覆盖最后一个有效 Surface。

## M04 固定映射与自动一致性门禁

在项目根目录执行：

```powershell
npm run test:a2ui-conformance
```

预期：出现 `running 6 tests`，最终 6/6 通过。测试必须包含 `expanded_catalog_fixture_passes_the_same_official_protocol_gate`，并继续覆盖不兼容版本、Catalog、未知组件/Action、非法新增 Props 和未修改的官方 Basic Catalog fixture。

## M05 安全与恢复

1. 在 Surface 中搜索或观察是否出现 `script`、`iframe`、HTML、远程 URL、命令输入或下载资源；均不应存在。
2. 关闭当前 Surface 再从历史打开；然后完全退出应用并重启，再次打开该 Surface。
3. 确认协议版本、Catalog ID、六类组件内容、清单/日期当前状态仍可用。

预期：恢复时仍先经过既有版本/Schema/Catalog 安全边界；不会执行模型代码或自动加载 URL。关闭 Surface 不等于删除，恢复不自动抢占编辑器。S3.2 只新增“删除失败检查记录”的最小 IPC/Capability，不新增数据库 migration、文件/网络权限或 S3.3 中风险 Action。

## M06 失败检查记录说明与删除

1. 选中一条标为“未通过”的安全检查记录。
2. 点击“删除失败记录”，先选择“取消”，确认记录仍在。
3. 再次点击并确认删除，确认该条记录从列表消失。
4. 若同一工作区还有其他失败记录、成功 Surface、聊天或文件，确认它们均保持不变；重启应用，已删除记录不再恢复。

预期：删除前明确说明只删除这一条本地检查记录且不可恢复；删除必须二次确认。后端同时校验当前工作区和检查记录 ID，并只允许单独删除未通过记录。成功检查仍随对应 Surface 管理；删除失败记录不会删除 Surface、Result、Action、聊天、文件、Provider 配置或其他检查记录。

## P0 明确限制

- 本地 Catalog 仍是自定义可信子集，不宣称支持官方完整 Basic Catalog。
- `Table` 只支持最多 12 列、50 行的基础值单元格，不支持公式、合并单元格、HTML、图片或任意对象。
- `Checklist` 最多 50 项；`Date` 使用本地系统日期输入；`Owner` 不加载远程头像。
- `IssueCard` 是结构化展示容器，不会在 S3.2 直接修改文件；需要持久修改的 Action 属于 S3.3，当前不得实现或验收。
- Provider 输出具有不确定性；一次受限重试后仍不合法，应明确失败并默认保留 Inspector 证据，不能手工放宽 Schema 来“通过”。用户可在检查完毕后显式删除单条失败记录。

## 验收回复

全部通过后请回复：`S3.2 验收通过`。若失败，请提供 M 编号、界面错误码/可理解提示、组件名、收到/选择的协议版本和 Catalog ID；不要发送真实业务正文、API Key、绝对路径或包含敏感数据的协议原文。
