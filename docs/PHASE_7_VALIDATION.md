# 阶段 7 验收说明：A2UI Runtime 与 Inspector 前置

## 交付结论

阶段 7 已实现受限 A2UI Protocol V1、首批 13 个 Basic Catalog 组件、完整 Surface/增量 Update、低风险 Action 权限和 Inspector 前置数据链。阶段 6 的真实文件 Patch/Diff/撤销功能保持不变。

## 安全保证

- 只有 Rust 严格校验通过的 Surface 才进入前端。
- 未知组件、未知 Props、错误类型、重复节点、树深/数量超限和不连续 revision 均被拒绝。
- 前端使用固定组件映射，不执行 HTML、Script、iframe、动态 import、系统命令或模型代码。
- Action 类型由 Rust 从持久化组件树重新读取，前端不能伪造。
- 模型偶发输出的白名单 Action 字符串简写会先转成规范对象；未知 Action、缺少安全 target 或错误事件绑定仍被拒绝。
- 文件类 `request_patch` 只能要求进入 Diff，不具备文件写入能力。
- 无效协议消息仍可在 Inspector 查看原始消息和错误，但绝不渲染。

## 持久化与增量隔离

SQLite v6 新增 `a2ui_surfaces`、`a2ui_messages`、`a2ui_events`。Surface 与校验记录跟随工作区永久保留，直到删除工作区或清除所有本地数据。增量消息只更新匹配 `surfaceId` 的记录，其他 Surface 不会重建或覆盖。

## 自动化验证

```text
npm run check
  Prettier / ESLint / TypeScript：通过
  Vitest：15 files / 43 tests 通过
  Vite production build：通过

cargo clippy --all-targets --all-features -- -D warnings
  通过

cargo test --lib
  Rust：49 tests 通过

cargo test --test command_registration
  Tauri 命令注册与主窗口权限：1 test 通过

npm run tauri build
  Vite + Rust release：通过
  NSIS 与 MSI 安装包：生成成功
```

Rust 覆盖完整/增量协议、未知组件、可执行 Props、树深和消息大小上限、跨 Surface 隔离、有效/无效消息持久化、低风险 Action、未声明 Action 拒绝与事件审计。React 测试覆盖 13 组件固定渲染、声明事件、非法消息只进 Inspector，以及 Zustand 增量合并不重建无关 Surface。

本次生成的本地验收包为 `A2UI Terminal_0.1.9_x64-setup.exe` 和 `A2UI Terminal_0.1.9_x64_en-US.msi`。两者用于阶段验收，尚未进入正式发布签名流程。

## 手工验收建议

1. 桌面端向 AI 提出“生成一个包含姓名、角色、复选框和提交按钮的 A2UI 表单”。
2. 响应完成后应自动进入 `Surface`，界面与右侧 Inspector 同时显示。
3. 修改输入项，确认 Data Model 与 Events 中出现 `set_state / allowed / low`。
4. 点击提交，确认只记录 `submit_form`，没有网络、文件或命令副作用。
5. 让模型输出未知组件或 `dangerouslySetInnerHTML`；应显示可理解错误，Runtime 不渲染，Raw Message 仍可查看。
6. 对已有 Surface 生成 revision + 1 的 `a2ui_update`；确认目标 Surface 更新，其他 Surface 保持不变。
7. 点击“复制最小复现”，确认内容包括原始消息、校验、组件树、数据与事件，不包含 API Key。
8. Web Mock 输入“Create an A2UI form”，确认只展示 Mock Surface，不访问本地文件。

## 验收边界

本阶段不扩展剩余 Catalog 组件，不执行高风险 Action，也未进入发布签名/自动更新收尾。请验证后明确回复“阶段 7 通过”；未收到确认前停止后续实施。
