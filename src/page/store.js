import { create } from 'zustand';
import { persist } from 'zustand/middleware';
// 创建一个名为 useChatStore 的自定义 Hook
export const useChatStore = create(persist((set, get) => (
  {

    // ==========================================
    // 1. 数据仓库 (State) - 存放所有核心数据
    // ==========================================

    // 右侧工作区（编辑器）的内容
    documentContent: '# 欢迎来到工作区\n\n请在左侧向 AI 发送指令，如果包含完整代码或文档，将自动在此处渲染。',

    // 左侧主聊天室的对话记录
    chatHistory: [
      { role: 'assistant', content: '你好！我是你的 Artifacts 智能助手。你可以让我帮你写一段 React 组件，或者起草一份 Markdown 报告。' }
    ],

    // AI 是否正在疯狂思考中
    isGenerating: false,

    // ==========================================
    // 2. 操作方法 (Actions) - 只有通过这些方法才能修改数据
    // ==========================================

    // 更新右侧文档内容
    setDocumentContent: (content) => set({ documentContent: content }),

    // 往聊天记录里追加一条新消息 (比如用户发了句话，或者 AI 开始回话)
    addMessage: (message) => set((state) => ({
      chatHistory: [...state.chatHistory, message]
    })),

    // 🚀 核心流式更新法：一字一字追加到 AI 的最后一条回复中
    // 🚀 加强版：流式追加文字，并实时嗅探 <article> 标签
    // 🚀 加强版：流式追加文字，并实时嗅探
    appendContentToLastMessage: (deltaContent) => set((state) => {
      const newHistory = [...state.chatHistory];
      const lastIndex = newHistory.length - 1;

      // 1. 拼接最新完整的回复内容
      const newFullContent = newHistory[lastIndex].content + deltaContent;
      newHistory[lastIndex].content = newFullContent;

      // 2. 增强版嗅探器 (三层防御)
      const articleMatch = newFullContent.match(/<article>([\s\S]*?)(<\/article>|$)/);
      const mdMatch = newFullContent.match(/\x60\x60\x60(?:markdown|md)?\n([\s\S]*?)(\x60\x60\x60|$)/i);

      let newDocContent = state.documentContent;

      if (articleMatch && articleMatch[1]) {
        // 第一层防御：听话的 AI，用了 <article>
        newDocContent = articleMatch[1].trim();
      } else if (mdMatch && mdMatch[1]) {
        // 第二层防御：半听话的 AI，用了 Markdown 代码块
        newDocContent = mdMatch[1].trim();
      } else if (newFullContent.includes('# ') || newFullContent.includes('## ') || newFullContent.includes('### ')) {
        // 🚀 第三层终极防御：AI 完全不听话，直接输出了正文。
        // 我们通过正则提取出从第一个标题（#）开始的所有内容，自动过滤掉前面的废话（比如"好的，这是计划："）
        const fallbackMatch = newFullContent.match(/(#[\s\S]*)$/);
        if (fallbackMatch && fallbackMatch[1]) {
          newDocContent = fallbackMatch[1].trim();
        } else {
          newDocContent = newFullContent; // 实在不行，就把它的所有回复全塞进去
        }
      }

      // 3. 同时更新聊天记录和编辑器内容
      return {
        chatHistory: newHistory,

      };
    }),
    // 切换 Loading 状态
    setIsGenerating: (status) => set({ isGenerating: status }),

    // 获取当前所有的聊天记录（发给大模型时需要用到）
    getChatHistory: () => get().chatHistory,
  }),
  {
    name: 'a2ui-storage', // 这是存在浏览器 localStorage 里的唯一 Key 名字

    // 💡 过滤策略：挑选需要保存的数据
    partialize: (state) => ({
      chatHistory: state.chatHistory,
      documentContent: state.documentContent,
      // 注意：这里故意不写 isGenerating，这样每次刷新它都会重置为默认值 false！
    }),
  }));