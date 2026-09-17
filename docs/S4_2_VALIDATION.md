# S4.2 本地模型探测与简单模型策略验证记录

> 状态：实现与自动验证已完成，等待用户人工验收；完成人工验收前 S4.2 不得标记为完成，也不得开始 S4.3。

## 1. 范围与基线

- 日期：2026-09-17（Asia/Shanghai）
- 基线 commit：`a165978`；S4.1 与验收修正仍保留在同一未提交工作树
- 对应实施记录：LOG-0138、LOG-0139、LOG-0140
- 范围：MDL-05、PRV-04；固定 Ollama/LM Studio 回环探测、已保存自定义回环兼容端点、普通模式状态、专业模式技术明细
- 明确不做：局域网扫描、端口枚举、mDNS/服务发现、自动下载/启动模型、自动保存或激活 Provider、内置试用服务、模型能力基准或 S4.3 产品事件

## 2. 实现结论

Rust 新增只读 `get_processing_options` 与 `probe_local_providers`。探测候选只有：

1. `127.0.0.1:11434/v1`（Ollama）；
2. `127.0.0.1:1234/v1`（LM Studio）；
3. 用户已在 `custom` Provider 中明确保存，且主机精确为 `localhost`、`127.0.0.1` 或 `[::1]` 的兼容端点。

`localhost` 在发起请求前规范为 `127.0.0.1`；非回环主机不会成为探测候选。每个候选独立返回可用/不可用，不可用不会使整个命令失败，也不会改变现有云端 Provider、Key、活动 Provider 或上下文审核状态。

设置页在简单模式只显示“本机处理/云端处理”、当前可用状态和发现的本机服务数量；不显示 Endpoint、模型 ID、Temperature、Proxy 或 Key。只有专业模式的既有 Provider 高级设置弹窗显示探测端点和有界模型名称列表。

## 3. 网络、安全与隐私边界

- 不新增 schema 或持久探测记录；schema 保持 v13。
- 使用无代理的本机 HTTP 客户端，禁止重定向；连接超时 350 ms、单候选总超时 1500 ms。
- 只执行 `GET /v1/models`；不提交 Prompt、文件、聊天、Context、Key 或请求正文。
- 响应最大 256 KiB；最多保留 100 个模型 ID，每个最多 256 字符；不保存原始响应。
- 探测结果不自动修改 Endpoint、Model、活动 Provider 或凭据；探测失败与 Provider 配置错误分开显示。
- 两项命令只加入主窗口最小 Capability；不新增 Shell、文件、剪贴板、遥测或远程网络权限。
- O-08 保持开放：本阶段不假定或伪造平台内置试用模型。

## 4. 合同与界面

- `get_processing_options` 不接收前端 Endpoint，只返回活动 Provider ID、处理位置、可用状态和本机服务计数。
- `probe_local_providers` 不接收参数；候选完全由 Rust 固定值和可信存储中的已保存配置生成。
- 共享 fixture `contracts/v2/provider-processing.json` 同时由 Rust serde 与 TypeScript guard 消费，不包含 API Key、Proxy、路径、Prompt 或正文。
- 提供 `scripts/s4-2-local-provider-fixture.mjs` 作为人工验收用回环服务；它只绑定 `127.0.0.1`，只响应 `/v1/models`，不进入生产运行路径。

## 5. 自动验证结果

| 验证                                                                                            | 结果                                    |
| ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| `npm run typecheck`                                                                             | 通过                                    |
| `npm run lint`                                                                                  | 通过                                    |
| `npm test`                                                                                      | 43 个文件、203 项通过                   |
| `npm run build`                                                                                 | 通过；仅保留既有 bundle size 提示       |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -j1`                                     | 174 项通过、1 项人工 PDF 预览按设计忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures -j1`                  | 14 项通过                               |
| `cargo test --manifest-path src-tauri/Cargo.toml --test command_registration -j1`               | 1 项通过                                |
| `cargo test --manifest-path src-tauri/Cargo.toml --test architecture_boundaries -j1`            | 6 项通过                                |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | 单核临时配置下通过                      |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、Prettier、`git diff --check`       | 通过                                    |
| `node scripts/s4-2-local-provider-fixture.mjs --port=17777` + `GET /v1/models` 人工脚本冒烟     | 通过                                    |

定向覆盖包括：精确回环接受、局域网/通配/伪 localhost/带凭据 URL 拒绝、固定候选与显式自定义候选、模型响应解析、普通模式技术参数隐藏、专业模式明细、探测失败与 Provider 配置隔离、双端共享合同和最小命令权限。

完整 Rust 首轮与单核复跑均遇到既有 `heartbeats_and_reasoning_do_not_extend_content_deadline` 本机套接字瞬时 `PROVIDER_PROTOCOL_ERROR`；单项复跑通过，取消 ProcessorAffinity 后完整 175 项复跑为 174 项通过、1 项按设计忽略。Clippy 首次在 Windows Rust stable 1.98.0 发生编译器 ICE/`STATUS_STACK_BUFFER_OVERRUN`，按项目既有单核临时设置原命令复跑通过。两类环境波动均未作为代码通过证据。

## 6. 待人工验收

真实桌面模式切换、启动/停止本机服务、状态刷新以及专业模式技术字段仍需人工检查。请按 [S4_2_MANUAL_ACCEPTANCE.md](S4_2_MANUAL_ACCEPTANCE.md) 完成 M01—M06；用户明确回复 `S4.2 验收通过` 前不得开始 S4.3。
