import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useSelectionToolbarPosition(
  region: RefObject<HTMLElement | null> | undefined,
  selectedText: string,
  enabled: boolean
) {
  const toolbar = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(
    null
  );
  useLayoutEffect(() => {
    if (!enabled || !selectedText.trim() || !region?.current) return;
    const editor = region.current;
    let frame = 0;
    const measure = () => {
      const bounds = editor.getBoundingClientRect();
      const selection = document.getSelection();
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      if (element?.closest('.md-editor-preview-wrapper')) {
        setPosition(null);
        return;
      }
      // DOM coordinates are presentation only; source positions remain authoritative.
      const range =
        selection?.rangeCount && editor.contains(selection.anchorNode)
          ? selection.getRangeAt(0)
          : null;
      const anchor =
        range?.getBoundingClientRect() ??
        editor.querySelector('.cm-selectionBackground')?.getBoundingClientRect();
      if (!anchor || !bounds.width || anchor.bottom < bounds.top || anchor.top > bounds.bottom) {
        setPosition(null);
        return;
      }
      const width = Math.min(400, bounds.width - 16, window.innerWidth - 16);
      const height = toolbar.current?.getBoundingClientRect().height ?? 42;
      const left = Math.max(8, Math.min(anchor.left, bounds.right - width - 8));
      const desiredTop = anchor.top - height - 8;
      const top = desiredTop >= bounds.top ? desiredTop : anchor.bottom + 8;
      setPosition({
        left,
        top: Math.max(bounds.top + 4, Math.min(top, bounds.bottom - height - 4)),
        width,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(editor);
    if (toolbar.current) observer.observe(toolbar.current);
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, region, selectedText]);
  return { toolbar, position };
}
