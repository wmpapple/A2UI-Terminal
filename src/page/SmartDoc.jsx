import React, { useRef } from 'react';
import ChatPanel from '../components/ChatPanel.jsx';
import Workspace from '../components/Workspace.jsx';
import TitleBar from '../components/TitleBar.jsx';

function SmartDoc() {
  const workspaceRef = useRef(null);

  // 🌟 桥接方法升级：支持接收 mode（'replace' | 'append' | 'insert'）
  const handleInsertContent = (rawText, mode = 'replace') => {
    if (workspaceRef.current) {

      // 终极排版清洗器
      let cleanText = rawText;
      if (typeof cleanText === 'string') {
        cleanText = cleanText.replace(/\\\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"');
      }

      // 🧠 智能分发逻辑
      if (mode === 'append' && workspaceRef.current.appendContent) {
        workspaceRef.current.appendContent(cleanText);
      } else if (mode === 'insert' && workspaceRef.current.insertAtCursor) {
        // 调用光标插入
        workspaceRef.current.insertAtCursor(cleanText);
      } else if (workspaceRef.current.setContent) {
        // 默认全量覆盖
        workspaceRef.current.setContent(cleanText);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TitleBar />
      <div style={{ flex: 1, display: 'flex', padding: '16px', gap: '16px', background: '#f0f2f5', boxSizing: 'border-box', overflow: 'hidden' }}>
        <ChatPanel onInsertContent={handleInsertContent} />
        <Workspace ref={workspaceRef} />
      </div>
    </div>
  );
}

export default SmartDoc;