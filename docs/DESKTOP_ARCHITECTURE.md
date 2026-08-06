# 桌面端架构与安全边界

## 进程边界

React WebView 只负责显示和收集用户意图。真实文件、SQLite、系统凭据和后续模型请求均由 Rust 端执行。Web Mock 不加载真实工作区，也不会降级为浏览器文件读写。

当前允许的 IPC 命令只有：

- 获取桌面基础设施状态；
- 写入、判断或删除指定 Provider 的 API Key；
- 经精确确认后清除所有应用本地数据。

前端没有读取 API Key 明文、执行 Shell、发起任意 Rust 网络请求或访问任意路径的命令。

## Tauri 权限

`src-tauri/capabilities/main.json` 绑定唯一的 `main` 窗口。应用命令由 `build.rs` 生成权限清单，再逐项加入 Capability。阶段 4 添加目录选择器时，需要单独增加 Dialog 权限；当前不为未来功能预授权。

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

工作区外键使用 `ON DELETE CASCADE`。版本记录由写入方设置 30 天到期时间，定期清理任务在 Patch/版本阶段实现。数据库迁移通过 `PRAGMA user_version` 保证可重复启动。

## 路径策略

文件命令在进入文件系统前必须同时满足：

1. 工作区根目录已规范化且存在；
2. 文件输入为无 `..`、盘符或绝对前缀的相对路径；
3. 解析符号链接后的最终路径仍位于规范化工作区根目录内；
4. 扩展名在文本白名单内；
5. 目标是已存在的普通文件。

阶段 3 只实现并测试这条路径守卫，不对前端开放真实文件命令。

## 凭据策略

Windows 使用系统 Credential Manager。服务命名空间固定为 `com.a2ui.terminal.provider`，账户名使用经过限制的 Provider ID。前端只能获得 `configured: boolean`，无法取回密钥。

“一键清除所有本地数据”需要精确确认文本，并删除 SQLite 业务数据和已知 Provider 凭据。它不会删除用户工作区中的真实项目文件。
