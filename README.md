# SmartDoc 智能桌面

基于 React + Tauri 构建的桌面应用，提供智能文档编辑与 AI 对话功能。

## 技术栈

- **前端框架**: React 19 + Vite 8
- **桌面框架**: Tauri 1.6
- **UI 组件**: Ant Design 6 + @ant-design/icons
- **状态管理**: Zustand 5
- **编辑器**: md-editor-rt (Markdown 编辑器)
- **路由**: react-router-dom 6
- **语言**: ESLint + JavaScript

## 主要功能

- **ChatPanel**: AI 对话面板，支持多种内容插入模式（替换、追加、光标插入）
- **Workspace**: Markdown 文档编辑工作区
- **TitleBar**: 自定义标题栏
- **UIFactory**: UI 组件工厂

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview

# Tauri 桌面应用开发
npm run tauri
```

## 应用配置

- 窗口标题: Artifacts 智能桌面
- 默认尺寸: 800 x 600
- 无边框窗口模式
- 支持窗口拖拽

## 项目结构

```
src/
├── components/       # 公共组件
│   ├── ChatPanel.jsx    # AI 对话面板
│   ├── TitleBar.jsx     # 自定义标题栏
│   ├── UIFactory.jsx    # UI 工厂组件
│   └── Workspace.jsx    # 编辑器工作区
├── page/
│   ├── SmartDoc.jsx     # 主页面
│   └── store.js          # 状态管理
├── App.jsx           # 根组件
└── main.jsx          # 入口文件
```
