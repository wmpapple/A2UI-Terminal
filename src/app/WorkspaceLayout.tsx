import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from './i18n/useI18n';
import styles from './AppShell.module.css';

const STORAGE_KEY = 'a2ui.workspace.column-widths.v1';
const SPLITTER_WIDTH = 8;
const MIN_LEFT_WIDTH = 180;
const MIN_CENTER_WIDTH = 360;
const MIN_RIGHT_WIDTH = 280;
const KEYBOARD_STEP = 16;
const DEFAULT_WIDTHS = { left: 230, right: 360 };

interface ColumnWidths {
  left: number;
  right: number;
}

interface DragState {
  kind: 'left' | 'right';
  startX: number;
  startWidths: ColumnWidths;
}

interface WorkspaceLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

function readStoredWidths(): ColumnWidths {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ColumnWidths>;
    if (
      Number.isFinite(stored?.left) &&
      Number.isFinite(stored?.right) &&
      Number(stored.left) > 0 &&
      Number(stored.right) > 0
    ) {
      return { left: Number(stored.left), right: Number(stored.right) };
    }
  } catch {
    // Ignore invalid local preferences and restore the product defaults.
  }
  return DEFAULT_WIDTHS;
}

function constrainWidths(widths: ColumnWidths, containerWidth: number): ColumnWidths {
  const minimumLayoutWidth =
    MIN_LEFT_WIDTH + MIN_CENTER_WIDTH + MIN_RIGHT_WIDTH + SPLITTER_WIDTH * 2;
  if (!Number.isFinite(containerWidth) || containerWidth < minimumLayoutWidth) return widths;

  const sideSpace = containerWidth - MIN_CENTER_WIDTH - SPLITTER_WIDTH * 2;
  const left = clamp(widths.left, MIN_LEFT_WIDTH, sideSpace - MIN_RIGHT_WIDTH);
  const right = clamp(widths.right, MIN_RIGHT_WIDTH, sideSpace - left);
  return { left, right };
}

export function WorkspaceLayout({ left, center, right }: WorkspaceLayoutProps) {
  const { t } = useI18n();
  const [initialWidths] = useState(readStoredWidths);
  const [widths, setWidths] = useState(initialWidths);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef(widths);
  const preferredWidthsRef = useRef(initialWidths);
  const dragRef = useRef<DragState | null>(null);

  const updateWidths = useCallback((next: ColumnWidths, preferred = true) => {
    widthsRef.current = next;
    if (preferred) preferredWidthsRef.current = next;
    setWidths(next);
  }, []);

  const persistWidths = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widthsRef.current));
  }, []);

  const endDragging = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(null);
    persistWidths();
  }, [persistWidths]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const fitToContainer = () => {
      const containerWidth = workspace.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      updateWidths(constrainWidths(preferredWidthsRef.current, containerWidth), false);
    };
    const observer = new ResizeObserver(fitToContainer);
    observer.observe(workspace);
    fitToContainer();
    return () => observer.disconnect();
  }, [updateWidths]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const workspace = workspaceRef.current;
      if (!drag || !workspace) return;
      const delta = event.clientX - drag.startX;
      const desired =
        drag.kind === 'left'
          ? { left: drag.startWidths.left + delta, right: drag.startWidths.right }
          : { left: drag.startWidths.left, right: drag.startWidths.right - delta };
      updateWidths(constrainWidths(desired, workspace.getBoundingClientRect().width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', endDragging);
    window.addEventListener('pointercancel', endDragging);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', endDragging);
      window.removeEventListener('pointercancel', endDragging);
      endDragging();
    };
  }, [endDragging, updateWidths]);

  const startDragging = (kind: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      kind,
      startX: event.clientX,
      startWidths: widthsRef.current,
    };
    setDragging(kind);
  };

  const resizeWithKeyboard = (kind: 'left' | 'right', event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? 0;
    const delta = event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP;
    const desired =
      kind === 'left'
        ? { ...widthsRef.current, left: widthsRef.current.left + delta }
        : { ...widthsRef.current, right: widthsRef.current.right - delta };
    updateWidths(constrainWidths(desired, workspaceWidth));
    persistWidths();
  };

  const resetWidths = () => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? 0;
    updateWidths(constrainWidths(DEFAULT_WIDTHS, workspaceWidth));
    persistWidths();
  };

  const separator = (kind: 'left' | 'right') => (
    <div
      className={`${styles.resizeHandle} ${dragging === kind ? styles.resizeHandleActive : ''}`}
      role="separator"
      aria-label={t(kind === 'left' ? 'resizeFilePanel' : 'resizeAssistantPanel')}
      aria-orientation="vertical"
      aria-valuemin={kind === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH}
      aria-valuenow={Math.round(kind === 'left' ? widths.left : widths.right)}
      tabIndex={0}
      title={t(kind === 'left' ? 'resizeFilePanel' : 'resizeAssistantPanel')}
      onDoubleClick={resetWidths}
      onKeyDown={(event) => resizeWithKeyboard(kind, event)}
      onPointerDown={(event) => startDragging(kind, event)}
    />
  );

  return (
    <div
      ref={workspaceRef}
      className={`${styles.workspace} ${dragging ? styles.workspaceResizing : ''}`}
      data-testid="workspace-layout"
      style={{
        gridTemplateColumns: `${widths.left}px ${SPLITTER_WIDTH}px minmax(${MIN_CENTER_WIDTH}px, 1fr) ${SPLITTER_WIDTH}px ${widths.right}px`,
      }}
    >
      {left}
      {separator('left')}
      {center}
      {separator('right')}
      {right}
    </div>
  );
}
