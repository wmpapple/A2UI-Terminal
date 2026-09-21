# M0 架构决策与接口草案

日期：2026-09-21。状态：待人工审阅。本文的 DTO、表和流程是后续阶段草案，尚未增加到生产代码、IPC、合同 fixture 或迁移中。用户最新要求优先于附件中的具体方案。

## ADR-001：个人资料独立于 Workspace

建议采用应用级 KnowledgeSource，以受管副本为事实来源，Workspace/Context Pack 只保存类型化引用。原始路径仅供本机导入流程使用，不进入模型请求或新增目标 DTO。

显式更新产生 sourceVersion；原始字节 rawHash 与提取文本 extractedHash 分开保存。相同字节可提示重复，不能仅按同名覆盖。首版不监听原文件。文件副本写入临时区、数据库事务提交、失败清理和启动恢复必须共同设计，不能声称 SQLite 回滚自动回滚文件。

删除资料撤销访问，清理副本及派生索引；已有引用保留不可读的来源标识并显示 unavailable。更新使旧版本引用 stale。clear-all 清除受管资料、派生数据和本机记录，不删除用户原文件。Workspace 删除不连带删除应用级资料。

迁移草案：KnowledgeSource、KnowledgeTag、KnowledgeSourceTag；是否增加持久 ImportJob 取决于恢复需求。索引以 sourceId/sourceVersion/parserVersion 为失效边界。迁移从实施时最新 schema 顺延；本轮不创建 0019，不改写 0001–0018。落实阶段：M1-A。

## ADR-002：提取共用解析接口

沿用现有 Rust 解析依赖，从 workspace/document_source 的解析中提取最小接口；文件选择、授权和持久化继续留在 application 用例。输入是后端已验证的受限文件句柄或内部路径，不能接受前端任意路径解析命令。

```text
ParsedDocument
  format, parserVersion, rawHash, extractedHash
  blocks: [{ id, kind, text, locator }]
  warnings: [{ code, message }]

Locator
  textRange(start, end, offsetUnit)
  pdfPage(pageNumber)
  docxParagraph(paragraphIndex)
  unavailable(reason)
```

页码/段落序号对用户从 1 开始。解析器必须保留来源映射后才能声明 locator；不可根据文本长度猜页码。文件大小、格式伪装、解压限制、截断和错误码保持现有边界。F0 先验证旧 fixture 提取行为不变；结构化定位增强在相应阶段验收。

## ADR-003：统一文件与成果目标，后端验证选区

```text
DocumentTarget = WorkspaceFile(workspaceId, sourceId) | Result(resultId)
DocumentSnapshot = target + revisionId + contentHash + format + text
SelectionSnapshot = target + revisionId + contentHash
                  + start + end + offsetUnit + selectedTextHash
```

建议前端偏移单位固定为 UTF-16 code unit；Rust 显式转换并拒绝拆分代理对，合同覆盖中文、emoji、组合字符、CRLF 和空选区。快照基于编辑器实际正文；未保存修改要先进入已有保存/版本路径，不能用磁盘旧版本授权新选区。

后端根据 ID 解析权限、真实位置与当前版本，验证全文 hash、范围和选区 hash；过期即拒绝并重新规划。不通过模糊字符串搜索定位写入，不信任模型返回的路径、风险或范围。Markdown 预览选区不能可靠映射源码时，引导到编辑模式。落实阶段：F0-03/M3。

## ADR-004：原地编辑是目标，展示组件可替换

低风险单目标纯文本替换可在原地展示、接受、放弃；可选 Ghost Diff、inline replacement 或 track changes。UI 组件不负责权限、风险、版本冲突和落盘。

应用仍走统一 Review → Apply → Revision → Undo，由 Rust 判断是否符合快捷路径。结构变更、多文件、删除或无法确定范围的操作使用完整 Review。不得因“低风险”省略用户接受、版本校验和撤销。落实阶段：M3；真实用户任务时间、操作数、误接受与撤销反馈决定交互迭代。

## ADR-005：引用能力分级

PDF 首期页级，DOCX 首期段落级；普通文本保留明确偏移单位。来源版本、片段 hash、请求映射与成果 revision 共同组成可验证链。引用链接不能直接使用模型给出的本地路径。

后端可验证片段属于已授权来源，不代表验证了模型结论。显示“来源已核验”，不显示“事实已核验”。来源删除、更新、无法定位分别显示 unavailable、stale、定位不可用；不伪造精度。落实阶段：M4；高级对象定位后置。

## ADR-006：AI 策略保持可选择

内置服务、仅 BYOK、默认服务 + BYOK 均为候选；本地模型能力保留。用户尚未选定商业路径，本轮不默认选择任何一种，也不配置密钥、服务端计费或远端请求。

建议以既有 Provider 合同复用生成链，Context Manifest 冻结实际接收方和资料。失败回退不得静默切换接收方；需要重新确认。真实成果生成接线与服务端商业策略分别验收。策略最迟在 M1-B 范围冻结时由产品负责人选择；未选前不能宣称默认服务已就绪。

质量以固定样本评估：事实保留、风格符合、长文一致性、引用准确率；按模型/任务组合设最低门槛，记录模型配置、Prompt 版本和输入 hash。M0 交付样本草案，M2 建 Eval 执行和回归机制。不存在当前已验证的“95% 达成预期”。

## ADR-007：上下文与存储复用边界

当前 `application/context.rs` 规划时会清空旧 pending manifests。并发前必须改成按操作/请求隔离并有独立消费、撤销和 TTL；不得直接启动并行长文生成。

新增 Repository 通过 Storage 提供的 crate 内受限事务/读回调访问数据库；commands 不持有裸连接。网络、解析和索引构建不能占用数据库锁。F0 先行为保持地提供复用边界，M1/M6 再增加对应业务能力。

## 当前与目标数据流

```text
当前文件：导入确认 → Workspace 授权来源 → Manifest 确认
          → Provider → Review → Apply → Revision → Undo
当前成果：Task local_scaffold → Result → 保存/版本 → Export
          ResultAssistantPanel 仍为占位，不能视为真实成果 AI 生成

后续目标：文件或 Result 快照 + 授权资料 → 冻结 Manifest
          → Provider → 后端校验提案 → 原地或完整 Review
          → Apply → Result/文件 Revision → 引用映射 → Undo/Export
```

## 独立发布依赖

| 项目               | 当前状态                                    | 适用范围与负责人                    | 关闭证据                                                       |
| ------------------ | ------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| S4.8 签名/安装升级 | 历史发布门未关闭                            | Windows 公开发布；发布负责人        | 签名、安装、升级、卸载和数据保留实测；沿用旧账本另行填写       |
| O-06 遥测          | 默认关闭、仅本机；远端策略未定              | 如选择上传；产品/隐私负责人         | 正式数据字典、同意/撤销与服务接收验证；选择不上传须记录决定    |
| O-08 默认服务      | 未选择/未联调                               | 仅内置或混合方案；产品/服务端负责人 | 配额、费用、认证、错误/限流、隐私和真实生成联调                |
| E2E Chromium 崩溃  | M0 两次全量有导航时崩溃，失败项定向复跑通过 | 测试环境/QA                         | 保留首跑证据并定位环境或浏览器根因；定向通过不等于稳定性已解决 |

上述负责人为角色，尚未指定实际人员。未关闭的发布依赖不会被 M0 的本地验证自动关闭。
