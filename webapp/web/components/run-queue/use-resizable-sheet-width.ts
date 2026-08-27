import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize width for a right-anchored sheet, persisted per user in
 * localStorage. Mirrors the MissionDrawer resize behaviour so both side panels
 * feel the same.
 *
 * Below the `sm` breakpoint the sheet is full width, so the stored width is
 * ignored there (`width` comes back `null`) and the sheet keeps its responsive
 * classes.
 */
export function useResizableSheetWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth
}: {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}) {
  const [width, setWidth] = useState(defaultWidth);
  /* Resizing only applies once the sheet stops being full-bleed at `sm`. */
  const [isResizable, setIsResizable] = useState(false);
  const isDragging = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return;
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= minWidth && parsed <= maxWidth) setWidth(parsed);
  }, [storageKey, minWidth, maxWidth]);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 40rem)');
    const sync = () => setIsResizable(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      isDragging.current = true;
      const startX = event.clientX;
      const startWidth = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!isDragging.current) return;
        /* The sheet is pinned to the right edge, so dragging left widens it. */
        const delta = moveEvent.clientX - startX;
        setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth - delta)));
      };

      const onPointerUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setWidth(current => {
          localStorage.setItem(storageKey, String(current));
          return current;
        });
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [width, storageKey, minWidth, maxWidth]
  );

  return {
    /* `null` means "let the responsive classes decide" (full-width mobile sheet). */
    width: isResizable ? width : null,
    isResizable,
    onResizePointerDown
  };
}
