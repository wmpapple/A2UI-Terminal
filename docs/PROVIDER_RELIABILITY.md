# Provider 可靠性与凭据策略

## Provider 合同

SiliconFlow、DeepSeek、OpenAI 和自定义 OpenAI-Compatible Endpoint 共用受控的 Chat Completions + SSE 传输层，但根据适配器选择输出 Token 字段。远程 Endpoint 必须使用 HTTPS；只有本机回环地址允许 HTTP。Endpoint 与代理地址禁止内嵌凭据、查询参数和片段。

## 取消与超时

- TCP/TLS 连接：10 秒。
- 等待 Provider 响应头：45 秒。
- 连接测试：20 秒。
- 流正文空闲：收到响应头后，连续 60 秒没有非空正文即停止；SSE 心跳、仅思考数据和空 delta 不延长计时。深度思考模型若长时间不给正文，也会明确超时，可手动更换模型。
- 流总时长：持续有数据时最多 15 分钟。
- A2UI 校验失败后的单次自动修复另设 90 秒上限；超时保留原校验失败，不渲染不完整结果。界面说明正在生成、检查及可能修复，可随时停止。
- 用户取消：连接、等待响应头和读取 SSE 三个阶段均以 25 ms 间隔观察取消信号；部分正文保存为 `stopped`。

传输层不再使用一个覆盖整个流的短总超时，因此正常持续输出不会被误判为超时。SSE 单事件限制为 1 MiB，完整回复限制为 16 MiB；流必须以 `[DONE]` 或 `finish_reason` 正常结束。

## 稳定错误码

后端错误包含 `code`、脱敏 `message`、`retryable`、可选 `httpStatus` 和 `retryAfterSeconds`。主要 Provider 错误码包括：

- `PROVIDER_AUTHENTICATION_FAILED` / `PROVIDER_ACCESS_DENIED`
- `PROVIDER_INVALID_REQUEST` / `PROVIDER_NOT_FOUND`
- `PROVIDER_RATE_LIMITED` / `PROVIDER_UNAVAILABLE`
- `PROVIDER_NETWORK_ERROR` / `PROVIDER_NETWORK_TIMEOUT`
- `PROVIDER_RESPONSE_TIMEOUT` / `PROVIDER_STREAM_IDLE_TIMEOUT`
- `PROVIDER_PROTOCOL_ERROR` / `PROVIDER_STREAM_INTERRUPTED`
- `REQUEST_CANCELLED`

远端响应正文和底层 Credential Manager 错误详情不会直接返回前端，避免把请求内容、凭据或平台内部信息带入 UI 和诊断数据。

## API Key 生命周期

API Key 只写入系统 Credential Manager，SQLite 只记录无密钥 Provider 配置和用于完整清理的 Provider ID。前端无法读取 Key，只能获得 `configured` 状态。

配置与新 Key 通过同一后端命令保存。更新前读取旧 Key 作为内存中的短期回滚值；如果 SQLite 引用写入失败，会恢复旧 Key（或删除本次新建 Key）并恢复旧 Provider 配置。Rust 中读取和临时接收的 Key 使用清零包装，在离开作用域时覆盖其字符串内存；设置页提交后立即清空密码输入状态。
