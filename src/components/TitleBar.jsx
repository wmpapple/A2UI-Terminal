import { appWindow } from '@tauri-apps/api/window';

function TitleBar() {
  const isDesktop = Boolean(window.__TAURI_IPC__);

  const runWindowAction = (action) => {
    if (isDesktop) action();
  };

  return (
    <header
      data-tauri-drag-region
      aria-label="Application title bar"
      style={{
        alignItems: 'center',
        background: '#fff',
        borderBottom: '1px solid #e5e5e5',
        boxSizing: 'border-box',
        display: 'flex',
        height: 40,
        justifyContent: 'space-between',
        padding: '0 12px',
      }}
    >
      <div data-tauri-drag-region style={{ color: '#333', fontSize: 14, fontWeight: 700 }}>
        A2UI Terminal
      </div>
      {isDesktop && (
        <nav aria-label="Window controls" style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => runWindowAction(appWindow.minimize)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Maximize or restore"
            onClick={() => runWindowAction(appWindow.toggleMaximize)}
          >
            □
          </button>
          <button type="button" aria-label="Close" onClick={() => runWindowAction(appWindow.close)}>
            ×
          </button>
        </nav>
      )}
    </header>
  );
}

export default TitleBar;
