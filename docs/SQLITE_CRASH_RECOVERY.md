# SQLite 迁移与崩溃恢复

## 启动与迁移保证

应用启动会先执行 SQLite `quick_check`，然后配置外键、5 秒锁等待、WAL、`synchronous=FULL` 和 WAL 自动检查点。所有待执行迁移在一个 `BEGIN IMMEDIATE` 等价事务中按连续版本应用，`user_version` 也在同一事务内更新。

任一迁移语句失败时，当前启动涉及的全部表结构和版本号更新都会回滚。迁移完成后再次执行 `quick_check` 和 `foreign_key_check`；损坏数据库返回稳定错误码 `DATABASE_INTEGRITY_ERROR`，不会继续启动并覆盖数据。高于当前应用支持版本的数据库同样会被拒绝。

Schema v8 为 `workspace_drafts` 增加正文 SHA-256，并为工作区恢复查询增加索引。升级已有 v7 数据库时，旧草稿正文会在本地事务内补齐哈希，不修改草稿正文。

Schema v9 新增 `results` 聚合、约束、索引和版本同步触发器。v8→v9 不批量复制旧文件、Surface 或正文；旧数据在显式打开时惰性建立 Result。迁移失败时 `results` 表和 `user_version` 一并回滚，旧 v8 数据保持不变。

Schema v10 新增 `task_templates`、`tasks`、Task/Result 同工作区约束和唯一绑定索引。v9→v10 原样保留现有 Result，并幂等播种 4 个内置模板；失败时新表、触发器、模板数据和 `user_version` 在同一迁移事务中回滚。

Schema v16 新增 `task_runs`、`result_drafts` 和 `export_jobs`。Task 在文件写入前先保存稳定执行意图，文件存在时只接受相同 Hash，再以一个事务创建 Result 并完成 Task；恢复和重复启动均复用同一 Result ID。Result 编辑草稿与真实文件分离，外部变化只标记冲突。Export Job 记录生命周期和输出 Hash；启动恢复只核验已经写入的目标或标记中断，不自动重试、重新生成或覆盖目标。

## 草稿恢复流程

- 工作区文件和 Result 编辑约 250 ms 后，正文、基础磁盘 Hash、正文 Hash 和更新时间写入 SQLite。
- 工作区恢复时一次列出全部待恢复草稿，不需要用户逐个猜测并打开文件。
- 草稿基础 Hash 与当前磁盘 Hash 不同时标记为冲突，必须由用户确认恢复或保留磁盘版本。
- 草稿正文 Hash 已等于磁盘 Hash 时，说明磁盘写入成功但进程来不及清理草稿；启动时自动删除该陈旧记录，避免假冲突。
- 原文件移动或删除时仍保留数据库草稿，并允许用户从侧边栏明确丢弃；不会因文件暂时不可用而自动删除内容。
- 目录文件和用户授权的独立文件使用同一套“先写草稿、再写真实文件”的流程。
- Result 草稿在打开对应成果时提示恢复或保留磁盘版本；首页只显示成果标题与数量，不返回草稿正文。

## Task、Review 与导出恢复

- Task 的 `prepared` 意图包含固定 Result/Revision ID、受控文件名、内容和 Hash。启动时缺文件才使用 `create_new` 创建；已有不匹配文件标为冲突且不删除、不覆盖。
- Review 继续由 schema v11 持久化。应用完成后复用 `application_operation_id`/`output_result_id` 返回既有结果，不在启动时自动应用。
- M04 修正：审阅页通过“保存选择（不应用）”显式持久化勾选决定，不写真实文件；恢复列表包含 pending、accepted、partially_accepted 和 conflicted。已保存但未应用的决定可以调整或整体拒绝；已应用/拒绝等终态不得重新决定。重开时根据块状态恢复勾选，不能把 rejected 默认当成已选。
- 新建 document_patch Review 先校验模型块 ID 在方案内唯一，再用本机 Review UUID 为块 ID 和内部 Patch 引用添加同一命名空间，避免模型在不同方案复用编号导致全局主键冲突。旧记录不重写；数据库/本地状态故障不触发模型格式修复重试。
- Export 在原子目标写入前持久化 `writing` 和输出 Hash；启动时只有目标完整字节 Hash 匹配才转为完成。`preparing`、`generating` 或无法证明提交的 `writing` 转为 `interrupted`。
- 导出绝对路径只保存在本机恢复记录中，不进入前端恢复 DTO、诊断报告或产品事件。

## 自动化验证

Rust 测试从 Schema v0 到每一个历史版本分别构造数据库并升级到最新版，同时验证已有记录保留。v16 故障注入在三张恢复表创建后故意执行无效 SQL，确认表和 `user_version` 均回滚；高于支持版本的数据库保持原版本并拒绝启动。其他测试覆盖损坏数据库、v7 草稿哈希回填、Task 两个文件边界、Result 外部修改冲突、Review 重开/幂等和 Export 提交 Hash 核验。
