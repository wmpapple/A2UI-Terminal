import { useEffect, useRef, type RefObject } from 'react';
import { importController } from './importController';
import { useImportStore } from './importStore';

export function useImportDropTarget(workspaceId?: string): RefObject<HTMLDivElement | null> {
  const elementRef = useRef<HTMLDivElement>(null);
  const receiveDrop = useImportStore((state) => state.receiveDrop);
  const reportError = useImportStore((state) => state.reportError);

  useEffect(() => {
    const targetId = crypto.randomUUID();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const element = elementRef.current;
    if (!element) return;

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
  }, [receiveDrop, reportError, workspaceId]);

  return elementRef;
}
