import { useEffect, useRef, type RefObject } from 'react';
import { importController } from './importController';
import { useImportStore } from './importStore';

export function useImportDropTarget(
  workspaceId?: string,
  onDragChange?: (active: boolean) => void
): RefObject<HTMLDivElement | null> {
  const elementRef = useRef<HTMLDivElement>(null);
  const receiveDrop = useImportStore((state) => state.receiveDrop);
  const reportError = useImportStore((state) => state.reportError);

  useEffect(() => {
    const targetId = crypto.randomUUID();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenDrag: (() => void) | undefined;
    const element = elementRef.current;
    if (!element) return;

    void importController
      .listenForDragPosition((position) => {
        if (disposed) return;
        const bounds = element.getBoundingClientRect();
        onDragChange?.(
          Boolean(
            position &&
            bounds.width > 0 &&
            bounds.height > 0 &&
            position.x >= bounds.left &&
            position.x < bounds.right &&
            position.y >= bounds.top &&
            position.y < bounds.bottom
          )
        );
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlistenDrag = stopListening;
      })
      .catch(reportError);

    const publishBounds = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      void importController
        .setDropTarget({
          targetId,
          enabled: true,
          workspaceId: workspaceId ?? null,
          bounds: {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          },
        })
        .catch(reportError);
    };

    void importController
      .listenForDrops((outcome) => {
        if (!disposed && outcome.targetId === targetId) receiveDrop(outcome);
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch(reportError);

    publishBounds();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publishBounds);
    observer?.observe(element);
    window.addEventListener('resize', publishBounds);
    window.addEventListener('scroll', publishBounds, true);

    return () => {
      disposed = true;
      unlisten?.();
      unlistenDrag?.();
      observer?.disconnect();
      window.removeEventListener('resize', publishBounds);
      window.removeEventListener('scroll', publishBounds, true);
      void importController
        .setDropTarget({
          targetId,
          enabled: false,
          workspaceId: workspaceId ?? null,
          bounds: null,
        })
        .catch(() => undefined);
    };
  }, [receiveDrop, reportError, workspaceId, onDragChange]);

  return elementRef;
}
