# A2UI Terminal 前端架构

## 当前阶段

M0-B 将旧 JavaScript 原型迁移为严格 TypeScript，并建立可以在 Web 中验证的三栏工作台。Web 运行时只使用确定性 Mock 数据；真实文件系统、SQLite、系统凭据和 Provider 请求属于后续桌面阶段。

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

当前 Zustand Store 保存 Web Mock 的临时状态，用来演示文件、会话和 Diff 流程。M0-C 引入 SQLite 后，Zustand 只保留活动 Tab、当前视图和 Modal 等 UI 状态；工作区、文档、会话、消息、版本和审计进入 SQLite；API Key 只进入 Windows Credential Manager。

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
