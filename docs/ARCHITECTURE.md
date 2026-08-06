# A2UI Terminal 前端架构

## 当前阶段

前端保持同一套三栏工作台，但通过运行时边界分为两种数据源：Web 只使用确定性 Mock；Desktop 使用受控 Tauri IPC 访问真实工作区。Provider 请求仍未接入。

## 模块边界

```text
src/
├── app/                    # 应用壳、错误边界、主题、国际化
├── features/
│   ├── workspace/          # 文件树、Tab、编辑器
│   ├── chat/               # 会话、输入与流式 Mock
│   ├── context/            # 请求前上下文确认
│   ├── diff/               # 修改前后审阅与应用
│   └── a2ui/               # Basic Catalog 白名单基础
├── shared/                 # Mock、平台接口和领域类型
├── stores/                 # Zustand UI 临时状态
└── styles/                 # 全局 Design Tokens
```

## 状态规则

Zustand 保存活动工作区摘要、文件树、已打开文档、多 Tab、基础 Hash、脏状态和恢复提示。工作区授权与草稿写入 SQLite；真实文件内容仍以磁盘为事实来源，不复制成长期数据库正文。会话、版本和审计继续由 SQLite 承担；API Key 只进入 Windows Credential Manager。

## Desktop 工作区流程

1. 前端调用 `select_workspace`，Rust 在后台打开系统目录选择器，前端不能提交任意绝对路径。
2. Rust 规范化并保存授权根目录，返回不含绝对路径的工作区摘要。
3. 文件树只列出白名单文本类型；依赖、构建、Git、虚拟环境和 secrets 目录被忽略。
4. 打开文件时校验相对路径、最终规范路径、2 MB 上限及 UTF-8。
5. 编辑后约 250 ms 保存崩溃草稿，约 1 秒携带基础 SHA-256 自动保存真实文件。
6. 磁盘 Hash 不匹配时拒绝写入并显示冲突；用户必须显式选择恢复草稿或保留磁盘版本。

## Mock 审阅流程

1. 用户从文件树选择演示文件。
2. 编辑器在内存中修改内容并模拟 1 秒自动保存状态。
3. 用户发送指令前打开上下文选择器。
4. Mock 助手流式返回说明并创建 `DiffProposal`。
5. 中心区域切换到审阅中心，显示 before/after。
6. 接受后更新内存文档；拒绝后不修改。

该流程只验证 UI 和状态边界，不代表真实文件已经被写入。

## A2UI 边界

阶段 M0-B 只定义已批准的 Basic Catalog 名称白名单，不解析或执行模型消息。Schema 校验、组件渲染、增量更新和 Action 权限在独立阶段实施。任何 HTML、Script、iframe 或动态 npm 组件默认不可信。
