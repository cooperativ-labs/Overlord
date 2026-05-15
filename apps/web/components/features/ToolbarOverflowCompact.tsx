'use client';

import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState
} from 'react';

/** Room needed to show the agent model label before expanding from compact mode. */
const COMPACT_EXPAND_SLACK_PX = 72;

const ToolbarOverflowCompactContext = createContext(false);

export function useToolbarOverflowCompact() {
  return useContext(ToolbarOverflowCompactContext);
}

export function useToolbarOverflowCompactState(containerRef: RefObject<HTMLElement | null>) {
  const [compact, setCompact] = useState(false);
  const compactAtWidthRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = () => {
      const overflowing = element.scrollWidth > element.clientWidth + 1;

      setCompact(previous => {
        if (overflowing) {
          compactAtWidthRef.current = element.clientWidth;
          return true;
        }

        if (previous) {
          const expandAt =
            (compactAtWidthRef.current ?? element.clientWidth) + COMPACT_EXPAND_SLACK_PX;
          if (element.clientWidth < expandAt) return true;
          compactAtWidthRef.current = null;
        }

        return false;
      });
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [containerRef, compact]);

  return compact;
}

export function ToolbarOverflowCompactProvider({
  compact,
  children
}: {
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <ToolbarOverflowCompactContext.Provider value={compact}>
      {children}
    </ToolbarOverflowCompactContext.Provider>
  );
}
