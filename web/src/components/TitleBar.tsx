import { MenuBar } from "@/components/MenuBar";
import { Toolbar } from "@/components/Toolbar";

interface TitleBarProps {
  currentPageLabel: string;
  isRescanning: boolean;
  onRescan?: () => void;
  onResetLayout?: () => void;
  onOpenAbout?: () => void;
  onOpenCommandPalette?: () => void;
  vrcRunning: boolean;
}

export function TitleBar({
  currentPageLabel,
  isRescanning,
  onRescan,
  onResetLayout,
  onOpenAbout,
  onOpenCommandPalette,
  vrcRunning,
}: TitleBarProps) {
  return (
    <header className="shrink-0 min-w-0 overflow-x-hidden border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
      <MenuBar
        onRescan={onRescan}
        onResetLayout={onResetLayout}
        onOpenAbout={onOpenAbout}
        onOpenCommandPalette={onOpenCommandPalette}
      />
      <Toolbar
        currentPageLabel={currentPageLabel}
        isRescanning={isRescanning}
        onRescan={onRescan}
        onOpenCommandPalette={onOpenCommandPalette}
        vrcRunning={vrcRunning}
      />
    </header>
  );
}
