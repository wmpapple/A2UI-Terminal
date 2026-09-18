# A2UI Terminal V2 威胁模型

> 基线：S4.6；2026-09-18。范围是 Windows 桌面应用、WebView 前端、可信 Rust 内核、SQLite/Credential Manager、本机文件系统和已配置 AI Provider。本文不把 Web Mock 视为生产安全边界。

## 1. 资产与安全目标

受保护资产包括文档正文、Prompt 与模型回复、文件名和绝对路径、工作区授权、Context Manifest、Result/Task/Review/历史版本、A2UI 消息、Provider Endpoint/Proxy/API Key、匿名产品事件以及用户导出的文件。核心目标是：未经明确授权不读取或发送正文；AI 输出不能直接获得文件、网络、Shell 或动态代码能力；持久修改必须先审阅；清理不能误删真实成果文件；诊断和产品事件不能成为侧信道。

## 2. 信任边界

1. **不可信输入**：用户选择的文件、拖放路径、CSV/XLSX/ZIP/PDF/DOCX 内容、AI Provider 返回、A2UI/DataPart、Patch/Review 候选和导出目标名称。
2. **受限前端**：React/WebView 负责展示和收集意图，不持有 Credential Manager 密钥，不自行遍历文件系统，不裁决 Patch、A2UI、导入、导出或 Context Manifest。
3. **可信 Rust 内核**：唯一负责路径规范化、授权复核、大小/格式限制、A2UI Catalog/Schema/Action 校验、Review 应用、原子写入、公式注入转义、凭据访问和清理事务。
4. **本机持久层**：SQLite 保存应用记录；Credential Manager 保存 Provider Key；项目文件、`my-results` 托管文件和用户导出文件是独立文件资产。
5. **外部边界**：仅用户配置并确认的 Provider/Updater 可以联网。当前匿名产品事件没有上传端点。

## 3. 攻击者与假设

- 恶意或被攻陷的 Provider 可返回畸形 JSON、越权 Action、路径、HTML/脚本、超大消息或诱导性文本。
- 恶意本地文件可伪装扩展名、包含公式前缀、压缩炸弹、隐藏/敏感名称、无效编码或并发变化。
- 普通本机用户可能误选敏感文件、误清理或误以为诊断/指标包含正文。
- 不防御已经完全控制当前 Windows 用户账户、可读取其进程内存或替换已签名应用二进制的攻击者；正式签名与分发链属于 S4.7/S4.8 发布门禁。

## 4. 威胁、控制与验证

| 面           | 主要威胁                                                                   | 强制控制                                                                                                                            | S4.6 证据                                                                 |
| ------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 导入         | `.env`/密钥误读、路径穿越、隐藏文件、压缩炸弹、TOCTOU                      | Rust 规范化与重新检查；敏感/隐藏路径拒绝；数量、单项和展开大小上限；确认前不持久化授权                                              | `contracts/v2/security-audit.json` 的 `.env` 被拒绝；既有 import/ZIP 回归 |
| 导出         | CSV/XLSX 公式执行、扩展名错配、旧 revision、覆盖/半成品、HTML/图片外部加载 | 可信 revision 快照；格式/扩展名绑定；公式型文本前置单引号且 XLSX 写字符串；临时文件原子提交；Markdown HTML 惰性文本、图片只保留 alt | 同一攻击 fixture 验证 `= + - @`；Export 回归                              |
| 检索         | 未授权文件进入索引、路径/正文越界返回、跨工作区混入、资源耗尽              | 只索引 Result 与已授权来源；敏感路径排除；内存索引；查询/文档/片段上限；响应不含绝对路径                                            | 攻击 fixture 的 `absolutePath` 输入被严格 DTO 拒绝；Search 回归           |
| A2UI         | 远程代码、未知 Catalog/组件/Action、隐藏不可达节点、直接文件写入           | 固定 v0.9.1 与本地 Basic Catalog；不接收 inline Catalog、HTML、脚本、URL、命令；Action allowlist；持久修改只生成 Review             | 攻击 fixture 的外部 Catalog 被拒绝；A2UI conformance/action-review 回归   |
| Patch/Review | 越权路径、重复/重叠锚点、并发覆盖、绕过审阅                                | Rust 路径守卫、Hash/revision 冲突检测、逐块决定、幂等应用与可验证撤销                                                               | Patch/Review 单元和集成回归                                               |
| Provider     | Key 泄露、错误把远端标为本机、旧清单重放                                   | Key 仅 Credential Manager；临时字符串清零；仅 loopback 算本机；Manifest 一次消费且绑定 Provider/Prompt/来源 Hash                    | Provider/Context Manifest 回归                                            |
| 诊断/指标    | 正文、路径、文件名、Prompt、回复、Endpoint、密钥或稳定身份泄漏             | 诊断只含版本、平台和数量；隐私布尔声明全部敏感载荷为 false；指标固定事件/枚举且默认关闭                                             | `build_diagnostic_report` 与合同测试                                      |
| 清理         | 遗留数据库/凭据/偏好，或误删真实文件                                       | 精确确认词；先删全部已知 Credential Key，后执行 SQLite 事务；成功后清 WebView storage 和内存索引；不调用项目/托管/导出文件删除      | 全表清理测试与保留磁盘文件断言                                            |
| 依赖/供应链  | 未锁定版本、缺失许可证/来源、上游漂移                                      | npm/Cargo 锁文件与完整性；直接依赖 NOTICE；A2UI fixture 固定 commit；随包许可证；发布前重新审计                                     | `npm run audit:third-party`                                               |

## 5. 失败原则

- 校验失败默认拒绝；不得“修复”不可信执行协议后继续执行。
- 失败、取消和冲突不得改变 Result 正文、Review 决定或来源文件。
- 错误面向普通用户给出稳定、脱敏提示；原始 Provider 响应、路径和正文不写日志或诊断。
- 清理在任何凭据删除或数据库事务失败时报告失败；前端只在 Rust 成功后清除本地偏好并重载。

## 6. 剩余风险与后续门禁

- Windows 当前用户被完全攻陷时，Credential Manager、SQLite 与本机文件仍可能被同一用户上下文读取。
- Provider 收到用户最终确认发送的内容后，其保留与处理受该 Provider 条款约束。
- 第三方许可证检查是工程证据，不替代法律意见；应用自身仍标记 `UNLICENSED`。
- 正式签名、安装器、更新签名/回滚、SBOM/漏洞扫描及发布演练在 S4.7/S4.8 完成前不得宣称生产发布就绪。

## 7. 变更规则

新增 IPC、Capability、网络目标、持久表、导入格式、A2UI 组件/Action、诊断字段或遥测字段时，必须同步更新本威胁模型、PRIVACY、合同 fixture、安全回归和第三方审计；新增能力默认不授权。
