import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OSC_STUDIO_SCENES } from "@/lib/osc-studio";

interface AddMessageMenuProps {
  onAddBlank: () => void;
  onAddRaw: () => void;
  onAddScene: (sceneId: string) => void;
}

/**
 * Single entry point for growing the message list. Presets ("scenes") live here
 * as quick-add items rather than as a competing top-level concept — one click
 * appends a ready-made card to the current profile.
 */
export function AddMessageMenu({ onAddBlank, onAddRaw, onAddScene }: AddMessageMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Plus className="size-3.5" />
          {t("osc.add.button", { defaultValue: "Add message" })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuItem onClick={onAddBlank}>
          <MessageSquarePlus className="size-3.5" />
          {t("osc.add.chatbox", { defaultValue: "Blank chatbox message" })}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddRaw}>
          <Plus className="size-3.5" />
          {t("osc.add.raw", { defaultValue: "Blank OSC value message" })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <Sparkles className="size-3" />
          {t("osc.add.presets", { defaultValue: "Presets" })}
        </DropdownMenuLabel>
        {OSC_STUDIO_SCENES.map((scene) => (
          <DropdownMenuItem key={scene.id} onClick={() => onAddScene(scene.id)}>
            {scene.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
