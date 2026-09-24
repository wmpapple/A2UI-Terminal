# M2 写作偏好与 Prompt Composer 实施记录

日期：2026-09-24。用户已确认 M1-B 人工验收通过并授权 M2。本轮只实施 M2；M3 Inline AI 未启动。

## 已交付范围

- 新增 Global / Workspace 两层写作偏好，支持启用、规则、术语、禁用词、范文资料引用、版本递增、重置和有效规则预览。
- 新增 schema 22 迁移 `0022_writing_profiles.sql`。Global 独立存在；Workspace Profile 随工作区级联删除；清除全部本地数据后恢复禁用的 Global 默认记录。
- 新增 Rust `ai/prompt.rs`，固定 Composer 版本 `m2.1`。写作优先级为默认行为、Global、Workspace、Task、当前指令；授权、安全、输出协议和审阅要求处于独立不可覆盖层。
- Chat、成果正文生成和任务正文生成共用同一个 Composer。原有 A2UI、Patch、Review 与全文提案协议继续由可信 Rust 侧约束。
- Context Manifest 记录写作偏好的生效层、id/version、hash、Composer 版本、规则快照和 token 估算。规则参与敏感信息检查及 32000 token 预算；清单确认后偏好变化会使旧确认失效并要求重新规划。
- 范文配置只保存个人资料 ID，不会把正文隐式加入请求。只有本次上下文明确选择并确认的资料正文才会发送。
- 新增 `evals/style` 的 40 个固定中文用例和离线结构校验，覆盖数字、日期、否定、事实保留、术语覆盖、反向指令与文档指令注入。校验命令不会调用 Provider，也不虚构模型质量分数。
- 人工验收反馈修复：写作偏好编辑期间，有效规则预览现在会实时合并当前草稿与另一层已保存配置并重新计算 token；未保存时明确显示“保存后规则预览 / 未保存”，不再出现开关已经开启但仍显示旧快照 `0 tokens` 的矛盾状态。
- 人工验收反馈修复：用户界面不再显示 Profile 的内部递增修订号；设置页改为“当前设置已保存 / 有未保存修改”，预览和发送清单只显示生效层。内部 revision 仍用于快照、变更检测和重新确认，不表示存在可浏览的历史版本。
- 人工验收反馈修复：中文界面的有效规则预览和发送清单不再直接显示英文内部 Prompt，而是从结构化快照生成“全局偏好 / 写作规则 / 推荐术语 / 避免使用”等中文展示文本；英文界面继续使用英文展示。

## 工程验证

- Rust：213 项通过、1 项人工预览测试忽略；全部集成测试通过。新增覆盖 Profile 合并、重启持久化、clear-all、工作区级联、快照稳定性、Composer 优先级及清单确认后偏好变化失效。
- 前端：66 个测试文件、292 项测试通过；类型检查、Prettier、生产构建通过。ESLint 无错误，保留既有 `CodeEditor` Hook 依赖警告。新增覆盖“启用未保存草稿后预览立即从 0 tokens 更新”和中英文规则展示隔离的回归测试。
- 合同与权限：schema 22、104 个 Tauri 命令；新增 Profile DTO fixture、三项命令注册和 capability 校验。
- Eval：40 个固定用例结构校验通过，未调用任何外部模型。
- 浏览器：新增“设置 Profile → 生成发送清单 → 查看有效快照”流程通过。全量并发回归首次完成 31/32，唯一失败是 `chrome-headless-shell.exe` 在断言前进程崩溃；完整串行运行中也出现相同的随机原生崩溃。Windows Application Error 明确记录该 Playwright 二进制以 `0xc0000005` 崩溃。失败场景逐项隔离运行可通过，32 个场景均有通过证据；没有删除断言或将技术判断交给用户。记录见 `logs/m2-e2e*.log` 和 `logs/m2-playwright-crash-events.log`。
- 桌面：debug / no-bundle 构建和隔离启动冒烟通过。交付副本另行实际启动，窗口标题、首页、导航和正文均正常渲染；截图为 `logs/m2-writing-profile-review/startup-window.png`。

验证程序为 `logs/m2-writing-profile-review/a2ui-terminal.exe`，SHA-256：`c4f53edd5951c64a779ebe77f7cb514dfd2edc4c6964227e15807b6b777ffa1a`，大小 71,869,440 字节。它是免安装 debug 验证版，不是签名发布包。

## 当前阶段门

当前状态：**M2 产品功能验收已于 2026-09-24 通过**。用户已明确授权进入 M3；后续实施和验收记录见 [M3_EXECUTION.md](M3_EXECUTION.md)。
