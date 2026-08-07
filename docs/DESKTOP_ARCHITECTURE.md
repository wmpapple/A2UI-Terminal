# 桌面端架构与安全边界

## 进程边界

React WebView 只负责显示和收集用户意图。真实文件、SQLite、系统凭据和后续模型请求均由 Rust 端执行。Web Mock 不加载真实工作区，也不会降级为浏览器文件读写。

当前允许的 IPC 命令只有：

- 获取桌面基础设施状态；
- 写入、判断或删除指定 Provider 的 API Key；
- 经精确确认后清除所有应用本地数据。
- 通过系统目录选择器创建或恢复工作区授权；
- 按工作区 ID 列出、读取、保存白名单文本文件及草稿；
- 删除工作区数据库记录，但不删除磁盘项目文件。

前端没有读取 API Key 明文、执行 Shell、发起任意 Rust 网络请求或访问任意路径的命令。

## Tauri 权限

`src-tauri/capabilities/main.json` 绑定唯一的 `main` 窗口。应用命令由 `build.rs` 生成权限清单，再逐项加入 Capability。目录选择器由 `select_workspace` Rust 命令在后台打开，前端没有 Dialog 插件权限，也不能向注册命令提交任意绝对路径。

CSP 默认只允许本应用资源。脚本不允许远程源或内联执行；网络连接仅保留 Tauri IPC。Ant Design 的运行时样式暂时需要 `style-src 'unsafe-inline'`，后续替换样式注入方式时再收紧。

## 本地数据

SQLite 文件位于 Tauri 的应用数据目录，而不是源码仓库。初始迁移包含：

- `workspaces`：授权工作区元数据；
- `sessions` / `messages`：工作区会话与完整消息正文；
- `document_versions`：文件版本、Hash 和到期时间；
- `provider_settings`：非敏感 Provider 配置；
- `credential_refs`：用于完整清理系统凭据的 Provider 引用，不含密钥；
- `app_settings`：应用设置。
- `audit_events`：不含密钥和消息正文的安全审计事件骨架。
- `workspace_drafts`：编辑崩溃恢复草稿、基础 Hash 和更新时间。

工作区外键使用 `ON DELETE CASCADE`。版本记录由写入方设置 30 天到期时间，定期清理任务在 Patch/版本阶段实现。数据库迁移通过 `PRAGMA user_version` 保证可重复启动。

## 路径策略

文件命令在进入文件系统前必须同时满足：

1. 工作区根目录已规范化且存在；
2. 文件输入为无 `..`、盘符或绝对前缀的相对路径；
3. 解析符号链接后的最终路径仍位于规范化工作区根目录内；
4. 扩展名在文本白名单内；
5. 目标是已存在的普通文件。

阶段 4 的文件命令只接收工作区 ID 与相对路径。读取额外限制为 2 MB 和有效 UTF-8；保存前必须匹配打开文件时的 SHA-256，否则返回 `FILE_CONFLICT`，不覆盖外部修改。

## 阶段 5 IPC

- Provider：`list_provider_configs`、`save_provider_config`、`set_active_provider`、`test_provider_connection`
- 会话：`list_chat_sessions`、`create_chat_session`
- 生成：`stream_chat`、`stop_chat`

所有命令均在 Tauri 2 capability 中逐项授权。`stream_chat` 使用 IPC Channel 返回增量事件，前端不能取得 API Key。远程 Endpoint 必须是 HTTPS，仅 `localhost`、`127.0.0.1` 和 `::1` 允许 HTTP；Endpoint 和代理 URL 禁止嵌入用户名、密码、查询参数或片段。

SQLite schema v3 为消息增加流状态、请求 ID、Provider ID 和错误码，并新增 `context_snapshots`。快照只保存来源、字符数、估算 Token 与内容 Hash，不保存文件上下文正文；用户和助手消息正文完整保存。

SQLite schema v4 增加 `directory` 与 `standalone` 两类工作区，并通过 `workspace_files` 持久化用户明确授权的独立文件。独立文件可以来自不同目录，重启后仍可恢复会话、读取和写回真实路径；删除工作区只级联删除应用内历史、草稿与授权记录，不删除磁盘原文件。

## 凭据策略

Windows 使用系统 Credential Manager。服务命名空间固定为 `com.a2ui.terminal.provider`，账户名使用经过限制的 Provider ID。前端只能获得 `configured: boolean`，无法取回密钥。

“一键清除所有本地数据”需要精确确认文本，并删除 SQLite 业务数据和已知 Provider 凭据。它不会删除用户工作区中的真实项目文件。
