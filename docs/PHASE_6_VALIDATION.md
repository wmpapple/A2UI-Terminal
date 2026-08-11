# 阶段 6 验收说明：语义 Patch、Diff、应用与撤销

## 交付结论

阶段 6 已实现第一条完整桌面闭环：真实文本文件 → 显式上下文 → AI `document_patch` → Rust Schema/安全校验 → 逐块 Diff → 应用已选 → 版本记录 → 撤销。

Web 模式继续只使用确定性 Mock 数据，不调用文件系统或 Patch 后端。

## Patch V1 边界

- 固定 `version: "1.0"` 与 `type: "document_patch"`，所有结构使用 `deny_unknown_fields` 严格反序列化。
- 支持 `replace`、`insert_before`、`insert_after`、`delete` 四种语义块操作。
- 单个 Patch 最多 50 个修改块；限制锚点、替换内容和结果文件大小。
- 每个块必须提供非空、精确且在原文件中唯一出现的锚点；可信 Rust 后端计算锚点 SHA-256，不依赖模型计算 Hash。
- Rust 在审阅时从当前磁盘生成每个目标文件的完整 SHA-256；应用时重新读取并复核，外部变更返回 `FILE_CONFLICT`。
- 路径只能是当前授权工作区中的白名单文本文件；绝对路径、路径穿越、Word/PDF 和不支持扩展名均被拒绝。
- 同一文件的修改按原始偏移量从后向前确定性落地；重叠块和重复锚点被拒绝，不使用正则猜测。
- AI 输出无法解析或未通过 Schema/磁盘校验时，不向 Diff 视图暴露无效 Patch；聊天区显示明确的安全校验提示，原始协议仅在折叠的技术详情中保留。
- Provider 请求显式配置结构化输出额度；Patch 截断或无效时，后台自动以最多 3 个小修改块重试一次，仍失败才提示用户手动重试。

## 应用、版本与撤销

- 前端只能提交 Rust 已校验的 Patch 和用户勾选的块标识；应用命令仍会完整复核，不信任前端状态。
- “全部拒绝”及零勾选不会写磁盘。
- 多文件写入失败时回滚本次已写文件；数据库记录失败时同样回滚磁盘内容。
- SQLite v5 新增 `patch_operations`，并为 `document_versions` 增加操作关联和 `before`/`after` 类型。
- 每次应用保存完整 Patch JSON、摘要、会话/助手消息关联，以及每个文件修改前后的完整正文和 Hash。
- 撤销要求磁盘仍等于该操作的 `after` 版本；撤销通过新操作和新版本恢复 `before` 内容，不删除历史链。
- 文档版本有效期为 30 天；应用启动、应用 Patch 和撤销后都会执行过期清理。
- 删除工作区及“一键清除所有本地数据”会通过外键/清理事务删除对应 Patch 和版本历史，不删除真实项目目录。

## 自动化验证结果

本地验证环境：Windows，仓库隔离 Rust 工具链，Node.js 24 作为 Node 22 CI 基线的补充验证。

```text
npm run check
  format:check 通过
  ESLint 通过
  TypeScript typecheck 通过
  Vitest：12 files / 30 tests 通过
  Vite production build 通过

cargo clippy --all-targets --all-features -- -D warnings
  通过

cargo test --all-targets --all-features
  Rust：35 tests 通过

npm run tauri build
  Windows Release 可执行文件通过
  NSIS：A2UI Terminal_0.1.0_x64-setup.exe
  MSI：A2UI Terminal_0.1.0_x64_en-US.msi
```

Rust 测试包含 10 个真正执行“审阅 → 写入 → 版本 → 撤销”的典型任务，覆盖 JSON、TS、JS、Python、YAML/YML、Markdown、TXT、TSX 和 MJS；另覆盖多文件事务、全部拒绝、非法 Schema、路径穿越、基准冲突、重复锚点、30 天清理和独立文件授权。

## 建议手工验收步骤

1. 启动桌面端并打开一个测试工作区，选择 JSON/TS/JS/Python/YAML 任一文本文件。
2. 在上下文选择器中只勾选当前文件或选区，要求 AI 修改一个能够唯一定位的代码块。
3. 确认 AI 回复完成后自动进入“审阅中心”，每个块都显示文件、操作、风险、理由和前后文本。
4. 取消勾选其中一个块，点击“应用已选修改”；确认仅已选块写入真实文件，编辑器显示最新内容。
5. 点击编辑器工具栏“撤销上次 Patch”；确认文件恢复，并且重新打开文件后内容仍正确。
6. 再生成 Patch 后用外部编辑器修改目标文件，然后尝试应用；应显示外部变更冲突，且不覆盖外部内容。
7. 生成 Patch 后点击“全部拒绝”；确认磁盘文件无变化。
8. Web 模式重复操作；确认只改变 Mock 展示数据，不读取或写入本地文件。

## 验收边界

本阶段没有实现阶段 7 的 A2UI Runtime、Catalog 扩展或 Inspector。请完成以上验证后明确回复“阶段 6 通过，执行阶段 7”；未收到确认前停止后续实施。
