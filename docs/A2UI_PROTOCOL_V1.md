# A2UI Protocol V1

## 信任模型

模型输出始终是不可信输入。桌面端只有 Rust 校验通过的 Surface 才能进入前端 Runtime；Web 只使用仓库内确定性 Mock。Runtime 不执行 HTML、Script、iframe、URL、系统命令、动态 npm 组件或模型生成代码。

## 完整 Surface

```json
{
  "version": "1.0",
  "type": "a2ui_surface",
  "surfaceId": "profile-form",
  "revision": 1,
  "root": {
    "id": "root",
    "component": "Column",
    "props": { "gap": "md" },
    "children": [
      {
        "id": "name",
        "component": "TextField",
        "props": { "name": "name", "label": "Name" },
        "children": [],
        "actions": {
          "change": { "type": "set_state", "target": "name" }
        }
      }
    ],
    "actions": {}
  },
  "data": { "name": "" }
}
```

`surfaceId`、组件 `id` 和 data key 只能使用字母、数字、`-`、`_`、`.`，长度不超过 80。`revision` 从 1 开始。

## 增量更新

```json
{
  "version": "1.0",
  "type": "a2ui_update",
  "surfaceId": "profile-form",
  "revision": 2,
  "operations": [
    { "op": "set_data", "key": "name", "value": "Ada" },
    {
      "op": "replace_props",
      "nodeId": "name",
      "props": { "name": "name", "label": "Display name" }
    }
  ]
}
```

支持的操作：

- `set_data`：设置一个顶层 data 字段。
- `remove_data`：移除一个顶层 data 字段。
- `replace_props`：替换指定节点的完整 Props。
- `replace_children`：替换指定节点的直接子树。

更新必须引用已存在 Surface，revision 必须严格等于当前 revision + 1。应用后会重新校验整棵树；任何失败都不会修改持久化 Surface。

## Basic Catalog

首批只注册 13 个组件：

- 布局：`Row`、`Column`、`Stack`
- 展示：`Text`、`Card`、`Badge`、`Progress`
- 输入：`TextField`、`Select`、`Checkbox`
- 交互：`Button`、`Tabs`、`Form`

每个组件拥有独立 Props 白名单和类型/枚举限制。未知字段、`on*`、`html`、`innerHTML`、`dangerouslySetInnerHTML`、`srcDoc`、`script`、`iframe`、`command` 均被拒绝。

Select 的 `options` 默认作为推荐值，用户仍可输入未列出的文本。只有显式设置 `allowCustom: false` 时才限制为固定选项；该字段必须是布尔值。

## Action 权限

| Action          | 风险 | 处理方式                                   |
| --------------- | ---- | ------------------------------------------ |
| `set_state`     | 低   | 更新当前 Surface 的顶层 data，并记录事件   |
| `submit_form`   | 低   | 仅记录本地表单事件，不向外部发送           |
| `request_patch` | 中   | 返回 `review_required`，必须复用 Diff 审阅 |
| 其他/未声明     | 高   | 默认拒绝，不执行，并记录拒绝事件           |

前端只提交 `surfaceId + componentId + eventName + payload`。Rust 会从已持久化组件树重新查找 Action 声明，防止前端伪造 Action 类型。

规范输出应使用 Action 对象，例如 `{"submit":{"type":"submit_form"}}`。为兼容模型偶发的紧凑输出，Runtime 也会先将白名单字符串简写 `"submit_form"`、`"request_patch"` 规范化为同等对象；规范化不会绕过后续事件绑定、target 与权限校验，未知 Action 仍默认拒绝。`set_state` 仍必须使用对象并提供安全 `target` 才能通过校验。

兼容层还会将常见事件别名 `on_click/onClick`、`on_change/onChange`、`on_submit/onSubmit`、`on_tab_change/onTabChange` 转为对应的声明式事件，并将 Select 的字符串选项转为相同 label/value 的对象。别名与正式事件同时出现会因重复声明被拒绝；规范化后的 Surface 仍须完整通过 Schema 与 Action 权限校验。

如果 TextField、Select 或 Checkbox 提供了安全 `name` 但漏掉 `change` Action，Rust 会补充仅写入同名 Surface data 的 `set_state` 声明。这样模型遗漏绑定时输入仍可用，同时所有变更依然经过后端权限判断和事件审计。

## 资源限制

- 原始消息最大 256 KiB。
- 单个 Surface 最多 200 个节点。
- 组件树最大深度 12。
- 单节点最多 32 个 Props、50 个直接子节点。
- JSON 数据最大深度 6；单数组/对象最多 100 项。
- 单字符串最大 4096 字节。
- 单次增量最多 50 个操作。
- Action payload 最大 32 KiB。

## Inspector 数据

SQLite 保存最近的原始消息、Schema 错误/警告、校验耗时、最终组件树、data 和 Action 事件。非法消息也会保存，但不会创建或更新 Surface。Inspector 可以复制包含这些字段的最小复现 JSON，且不包含 API Key。
