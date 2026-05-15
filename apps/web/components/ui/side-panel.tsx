'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

import { useIsMobile } from '@/lib/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'side-panel-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 400;
const MAX_WIDTH = 800;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type SidePanelContextValue = {
  content: ReactNode;
  setContent: (content: ReactNode) => void;
  closePath: string | null;
  setClosePath: (path: string | null) => void;
  isOpen: boolean;
};

const SidePanelContext = createContext<SidePanelContextValue>({
  content: null,
  setContent: () => {},
  closePath: null,
  setClosePath: () => {},
  isOpen: false
});

export function useSidePanel() {
  return useContext(SidePanelContext);
}

// ---------------------------------------------------------------------------
// Provider — wrap around the layout that contains a <SidePanel />
// ---------------------------------------------------------------------------

export function SidePanelProvider({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  const [content, setContent] = useState<ReactNode>(null);
  const [closePath, setClosePath] = useState<string | null>(null);
  const isOpen = content !== null;

  return (
    <SidePanelContext.Provider value={{ content, setContent, closePath, setClosePath, isOpen }}>
      <div className={cn('flex-1 min-h-0', className)}>{children}</div>
    </SidePanelContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Slot — render in a child page/layout to inject content into the panel
// ---------------------------------------------------------------------------

export function SidePanelSlot({ children, closePath }: { children: ReactNode; closePath: string }) {
  const { setContent, setClosePath } = useSidePanel();

  useEffect(() => {
    setContent(children);
    setClosePath(closePath);
    return () => {
      setContent(null);
      setClosePath(null);
    };
  }); // intentionally no deps — always sync children into context

  return null;
}

// ---------------------------------------------------------------------------
// SidePanel — the actual panel chrome (desktop: resizable, mobile: Sheet)
// ---------------------------------------------------------------------------

export function SidePanel() {
  const { content, isOpen, closePath } = useSidePanel();
  const isMobile = useIsMobile();
  const router = useRouter();

  // Keep a reference to the last non-null content so the close animation
  // doesn't flash empty while the panel width transitions to 0.
  const lastContentRef = useRef<ReactNode>(null);
  if (content !== null) lastContentRef.current = content;
  const displayContent = content ?? lastContentRef.current;

  // -- Width state with localStorage persistence -------------------------

  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) setWidth(parsed);
    }
  }, []);

  // -- Drag-to-resize ----------------------------------------------------

  const isDragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - ev.clientX));
      setWidth(newWidth);
    };

    const onPointerUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth(w => {
        localStorage.setItem(STORAGE_KEY, String(w));
        return w;
      });
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, []);

  // Clear stale content after the close transition finishes
  const onTransitionEnd = useCallback(() => {
    if (!isOpen) lastContentRef.current = null;
  }, [isOpen]);

  // -- Mobile: Sheet ------------------------------------------------------

  if (isMobile) {
    return (
      <Sheet
        open={isOpen}
        onOpenChange={open => {
          if (!open && closePath) router.push(closePath);
        }}
      >
        <SheetContent
          side="right"
          className="w-full p-0 sm:max-w-lg "
          showCloseButton={false}
          onPointerDownOutside={event => event.preventDefault()}
        >
          <SheetTitle className="sr-only">Ticket details</SheetTitle>
          <SheetDescription className="sr-only">Side panel with ticket details</SheetDescription>
          {displayContent}
        </SheetContent>
      </Sheet>
    );
  }

  // -- Desktop: resizable panel ------------------------------------------

  return (
    <div
      className={cn(
        'relative flex h-full shrink-0 border-l transition-[width,box-shadow] duration-200 ease-in-out',
        isOpen ? 'shadow-side-left' : 'w-0 overflow-hidden border-l-0 shadow-none'
      )}
      style={isOpen ? { width } : undefined}
      onTransitionEnd={onTransitionEnd}
    >
      {/* Invisible drag handle along the border */}
      <div
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize"
        onPointerDown={onPointerDown}
      />

      {/* Content */}
      <div className=" flex min-w-0 flex-1 flex-col overflow-hidden">{displayContent}</div>
    </div>
  );
}
