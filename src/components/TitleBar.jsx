import React from 'react';
import { appWindow } from '@tauri-apps/api/window';

function TitleBar() {
  return (
    <div
      // 💡 最核心的魔法：加上这个属性，这块 div 就能像原生窗口一样被鼠标拖着走了！
      data-tauri-drag-region
      style={{
        height: '38px',
        background: '#f0f2f5',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 16px',
        userSelect: 'none',
        borderBottom: '1px solid #e5e5e5'
      }}
    >
      {/* 左侧：Logo 和 软件名 */}
      <div
        data-tauri-drag-region
        style={{ fontWeight: 'bold', fontSize: '14px', color: '#333' }}
      >
        ✨ Artifacts AI
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <div
          onClick={() => appWindow.minimize()}
          style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#e0e0e0'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          —
        </div>
        <div
          onClick={() => appWindow.toggleMaximize()}
          style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '4px' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#e0e0e0'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          □
        </div>
        <div
          onClick={() => appWindow.close()}
          style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', color: '#ff4d4f' }}
          onMouseOver={(e) => { e.currentTarget.style.background = '#ff4d4f'; e.currentTarget.style.color = '#fff' }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ff4d4f' }}
        >
          ✕
        </div>
      </div>
    </div>
  );
}

export default TitleBar;