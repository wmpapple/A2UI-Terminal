# S3.1 A2UI 标准一致性与版本协商人工验收

> 范围：只验收 S3.1；通过前不得开始 S3.2。

> Web Mock 只能检查既有固定 Surface。真实 Provider 输出、Rust 协商、SQLite Inspector 与桌面 Capability 必须在 Windows 桌面应用检查。

## 准备

1. 关闭仍在运行的旧版桌面进程，在项目根目录执行 `npm run desktop:dev`。
2. 在“设置”中切换为专业模式，并配置一个可用的 Provider。
3. 新建或打开一个非敏感测试工作区和会话；不要使用真实业务正文、密钥或绝对路径作为测试内容。

本机若再次遇到随机 Rust 编译崩溃，可在新的 PowerShell 会话中使用本项目已验证的临时设置：

```powershell
(Get-Process -Id $PID).ProcessorAffinity = 1
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
npm run desktop:dev
```

关闭该 PowerShell 后临时设置结束，不会修改全局工具链。

## M01 能力与标准版本

1. 修复前已经打开桌面应用的，先完全关闭旧进程并重新执行 `npm run desktop:dev`；新建一个测试会话。
2. 进入工作台，向 AI 输入：“生成一个仅包含标题、姓名输入框和提交按钮的交互表单，不要创建文件。”
3. 等待交互成果打开，检查顶部版本标签。
4. 查看右侧“协议 Inspector”→“Schema”。

预期：表单实际显示标题、姓名输入框和提交按钮；顶部显示 `A2UI v0.9.1`；Schema 校验通过；协商信息显示收到并选择 `v0.9.1`，Catalog 为 `urn:a2ui-terminal:catalog:basic:v1`。聊天区只显示用户可理解的“Surface 已通过安全校验”和“打开 Surface”，不得直接显示 `createSurface`、`updateComponents` 或整段 JSON；原始协议只在 Inspector 中显示。若 Provider 第一次漏发被 `children` 引用的组件定义，应用只允许自动重新生成一次，原失败仍留在 Inspector；最终仍不合法时必须明确失败，不能显示残缺表单。界面不得出现 HTML、脚本、iframe、远程资源 URL、命令或动态组件。

## M02 Catalog 与 Action

1. 检查 M01 的表单包含标题、输入框和按钮，输入一段非敏感文本。
2. 点击提交按钮，再查看 Inspector 的“Events”。
3. 查看 Inspector Schema 中的 Catalog 能力摘要。

预期：输入状态正常更新；事件仅出现声明式 `set_state`/`submit_form`；Catalog 摘要显示本地 Catalog 与 13 个组件。事件不发起系统命令、任意网络请求或文件写入。

## M03 官方增量更新

1. 在同一会话继续输入：“把刚才表单的标题改为‘增量更新成功’，保留输入内容和其他组件。”
2. 检查 Surface revision 和当前输入值。
3. 查看 Inspector 的 Component Tree 与 Data Model。

预期：模型使用同一 Surface 的 `updateComponents`/`updateDataModel` 时 revision 增加；标题更新，未被更新的组件和数据不丢失；没有出现第二棵混合树。若 Provider 未按协议返回增量消息，应显示明确拒绝信息，不得覆盖最后一个有效 Surface。

## M04 不兼容输入的确定性安全门

在项目根目录另开 PowerShell，确认桌面窗口没有正在重新编译，然后执行项目内置的低内存验收命令：

```powershell
npm run test:a2ui-conformance
```

该脚本固定使用 stable Rust、单构建任务、禁用增量编译和隔离 target；不会覆盖正在运行的桌面 exe。当前 Windows 桌面验收只编译测试需要的 Rust `rlib`，不重复生成仅移动端需要的 `staticlib/cdylib`。第一次执行需要单独编译隔离缓存，耗时会比后续执行长。若检测到另一个 `rustc` 正在编译，脚本会要求等待，而不是并行抢占内存。

预期：出现 `running 5 tests`，最终 5/5 通过。测试明确覆盖首选 v0.9.1、兼容 v0.9、不兼容版本、非本地 Catalog、未知组件、未知 Action，以及未修改的官方 Basic Catalog fixture；非法输入均 `surface=null`、保留 Inspector 证据，且不会覆盖有效 Surface。只有出现 5 项测试结果才算通过；`rustc-LLVM ERROR`、`STATUS_STACK_BUFFER_OVERRUN` 或尚未进入测试均属于环境失败，不能记为验收通过。

## M05 兼容、重启与错误证据

1. 退出并重新启动桌面应用，恢复 M01 的工作区。
2. 打开历史交互成果，检查 Surface 与 Inspector。
3. 若本轮 Provider 曾返回非法 A2UI 消息，选中该检查记录并查看 Schema；否则以 M04 的确定性测试作为拒绝路径证据。

预期：有效 Surface 可恢复但不会强制抢占中央视图；协议版本与 Catalog 仍存在。非法记录可见稳定错误码 `A2UI_PROTOCOL_INCOMPATIBLE`、`A2UI_CATALOG_UNSUPPORTED` 或 `A2UI_VALIDATION_FAILED`，且没有可渲染 Surface。历史私有 `1.0` Surface 如存在仍可读取，但不会显示为官方 A2UI 1.0，也不能接受官方增量更新。

## 明确限制

- S3.1 只完成官方消息信封、版本/Catalog 协商和一致性安全门；本地 Catalog 仍是 13 个组件，不宣称支持官方完整 Basic Catalog。
- `v1.0` 仍是上游候选方向，不在本阶段生产支持范围；不得把项目早期私有 `version: "1.0"` 与官方版本混为一谈。
- 模型 `deleteSurface`、inline Catalog、`sendDataModel=true`、深层 Data Model JSON Pointer 均不开放。
- Provider 是否一次生成理想布局不是协议验收标准；安全拒绝、旧 Surface 不被覆盖和 Inspector 证据才是失败路径标准。

## 验收回复

全部通过后请回复：`S3.1 验收通过`。若失败，请提供步骤编号、界面错误码/提示、收到/选择的版本和 Catalog ID；不要发送敏感正文、API Key、绝对路径或真实业务文件。
