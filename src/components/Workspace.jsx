import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { MdEditor } from 'md-editor-rt';
import 'md-editor-rt/lib/style.css';
import { useChatStore } from '../page/store';

const Workspace = forwardRef((props, ref) => {
  const documentContent = useChatStore((state) => state.documentContent);
  const setDocumentContent = useChatStore((state) => state.setDocumentContent);
  const editorRef = useRef(null);

  // 向外暴露精准的 API
  useImperativeHandle(ref, () => ({
    // 1. 无情覆盖全文
    setContent: (newText) => {
      setDocumentContent(newText);
    },
    // 2. 温柔追加到末尾
    appendContent: (newText) => {
      setDocumentContent(prev => prev + '\n\n' + newText);
    },
    // 🌟 3. 精准操作：插入光标位置 / 替换鼠标选中的内容
    insertAtCursor: (newText) => {
      editorRef.current?.focus(); // 确保编辑器先获取焦点
      editorRef.current?.insert(() => {
        return {
          targetValue: newText,
          select: false, // 插入后不选中新文本，光标放在末尾
          deviationStart: 0,
          deviationEnd: 0
        };
      });
    }
  }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
      <MdEditor
        ref={editorRef}
        value={documentContent}
        onChange={setDocumentContent}
        style={{ height: '100%', flex: 1 }}
      />
    </div>
  );
});

export default Workspace;