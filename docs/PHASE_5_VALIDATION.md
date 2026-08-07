# 阶段 5 验收记录

验证日期：2026-08-07

## 已实现

- SiliconFlow、DeepSeek 官方、OpenAI 官方和自定义 OpenAI-Compatible Endpoint 的统一 Chat Completions 适配层。
- Endpoint、Model、Temperature、HTTP/HTTPS 代理、活动 Provider 和连接测试设置。
- API Key 只写入 Windows Credential Manager；SQLite 只保存 Provider 非敏感配置及凭据引用。
- 每工作区多会话、完整消息正文永久保存、流式回复、停止、错误状态与重试入口。
- 每次发送前显示选区、当前文件、指定项目文件和最近消息的最终清单、字符数及 Token 估算。
- `.env*`、证书、私钥和 `secrets/**` 等敏感路径默认排除；疑似敏感正文必须再次勾选确认。
- Rust 后端二次校验上下文。SQLite 只保存来源摘要和内容 Hash，不复制文件上下文正文。
- Web 继续只使用 Mock 数据，不访问真实 Provider、系统凭据和 SQLite 会话。

协议依据：OpenAI、DeepSeek 和 SiliconFlow 均支持 Bearer 认证的 Chat Completions；DeepSeek 与 SiliconFlow 的流式响应使用 SSE 并以 `data: [DONE]` 结束。

- https://developers.openai.com/api/reference/overview#authentication
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://docs.siliconflow.cn/en/api-reference/chat-completions/chat-completions

## 自动验证结果

- `npm run check`：通过。
- Vitest：9 个测试文件、19 项测试通过。
- `cargo fmt --check`：通过。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- Rust：25 项测试通过。
- 四类 Provider 使用同一受测请求合同；SSE 支持 UTF-8 跨分块解析。
- 挂起 Provider 连接的停止测试：500 ms 内返回 `REQUEST_CANCELLED`。
- SQLite schema v4、完整消息持久化、上下文摘要、独立文件授权和 Provider 非敏感配置测试：通过。
- `tauri build --debug --no-bundle`：通过。
- Debug 桌面程序后台启动 5 秒冒烟：通过。
- 未使用真实 API Key 执行外网收费请求；真实联网由产品负责人使用自己的测试 Key 验收。

## 产品验收步骤

1. 运行 `npm run desktop:dev`，打开一个测试工作区。
2. 打开右上角设置，依次检查 SiliconFlow、DeepSeek、OpenAI 和 Custom 配置。
3. 输入测试 Key，保存后确认输入框被清空，只显示“Key 已配置”；不要使用生产 Key。
4. 点击“测试连接”，确认使用当前 Endpoint 和代理能够访问 `/models`。
5. 将该 Provider 设为当前 Provider，新建两个会话并分别发送消息。
6. 发送前取消勾选一个文件，确认最终清单中没有它；发送后确认模型回答未得到该文件内容。
7. 使用虚构文本 `API_KEY=demo-not-a-real-key` 测试敏感提示，确认未再次勾选时不能发送。
8. 在流式回复中点击停止，确认界面在 500 ms 内停止增长，并出现“重试”入口。
9. 关闭并重新打开应用，确认工作区会话标题、用户消息和完整助手正文仍然存在。
10. 删除工作区记录，确认会话历史同步删除，但磁盘项目文件保持不变。
11. 启动 Web 版本，确认仍显示 Mock 数据且不能打开真实 Provider 设置。

### 独立文件工作区

1. 在未打开目录时点击“添加文件”，选择一个不属于项目目录的受支持文本文件。
2. 左侧应显示“独立文件”，并以真实文件名展示，不显示内部 UUID 路径。
3. 新会话应自动创建，AI 上下文选择、发送、编辑和保存均可使用。
4. 重启应用后，独立文件工作区、会话和文件授权应可以恢复。
5. 删除独立文件工作区后，应用历史和授权记录应删除，磁盘原文件必须保留。

阶段 6 在产品负责人确认前不开始。
