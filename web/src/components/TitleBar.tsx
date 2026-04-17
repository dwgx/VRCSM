import { MenuBar } from "@/components/MenuBar";
import { Toolbar } from "@/components/Toolbar";

interface TitleBarProps {
  currentPageLabel: string;
  isRescanning: boolean;
  onRescan?: () => void;
  onResetLayout?: () => void;
  onOpenAbout?: () => void;
  vrcRunning: boolean;
}

export function TitleBar({
  currentPageLabel,
  isRescanning,
  onRescan,
  onResetLayout,
  onOpenAbout,
  vrcRunning,
}: TitleBarProps) {
  return (
    <header className="shrink-0 min-w-0 overflow-x-hidden border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <MenuBar
        onRescan={onRescan}
        onResetLayout={onResetLayout}
        onOpenAbout={onOpenAbout}
      />
      <Toolbar
        currentPageLabel={currentPageLabel}
        isRescanning={isRescanning}
        onRescan={onRescan}
        vrcRunning={vrcRunning}
      />
    </header>
  );
}
