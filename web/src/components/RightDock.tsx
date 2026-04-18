import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";

export interface RightDockDescriptor {
  title: string;
  body: ReactNode;
  footer?: ReactNode;
}

interface RightDockContextValue {
  dock: RightDockDescriptor | null;
  setDock: (descriptor: RightDockDescriptor | null) => void;
}

interface RightDockProps {
  fallback?: RightDockDescriptor | null;
}

const RightDockContext = createContext<RightDockContextValue | null>(null);

export function RightDockProvider({ children }: PropsWithChildren) {
  const [dock, setDock] = useState<RightDockDescriptor | null>(null);

  return (
    <RightDockContext.Provider value={{ dock, setDock }}>
      {children}
    </RightDockContext.Provider>
  );
}

export function useRightDock(descriptor: RightDockDescriptor | null): void {
  const context = useContext(RightDockContext);

  useEffect(() => {
    if (!context) return;
    context.setDock(descriptor);
    return () => {
      context.setDock(null);
    };
  }, [context, descriptor]);
}

export function useResolvedRightDock(
  fallback: RightDockDescriptor | null = null,
): RightDockDescriptor | null {
  const context = useContext(RightDockContext);
  return context?.dock ?? fallback;
}

export function RightDock({ fallback = null }: RightDockProps) {
  const activeDock = useResolvedRightDock(fallback);

  if (!activeDock) return null;

  return (
    <aside className="unity-dock flex h-full w-full flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <div className="flex h-8 items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3">
        <div className="unity-tab unity-tab-active min-w-0 max-w-full">
          {activeDock.title}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {activeDock.body}
      </div>
      {activeDock.footer ? (
        <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
          {activeDock.footer}
        </div>
      ) : null}
    </aside>
  );
}
