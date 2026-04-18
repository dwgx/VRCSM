import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface CollapsibleCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  contentClassName?: string;
  elevation?: "flat" | "raised" | "bright";
}

export function CollapsibleCard({
  title,
  description,
  children,
  actions,
  defaultOpen = true,
  storageKey,
  className,
  contentClassName,
  elevation = "flat",
}: CollapsibleCardProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const [storedOpen, setStoredOpen] = useUiPrefBoolean(storageKey ?? "__unused__", defaultOpen);
  const open = storageKey ? storedOpen : localOpen;
  const setOpen = storageKey ? setStoredOpen : setLocalOpen;

  return (
    <Card elevation={elevation} className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-[-2px] size-7 shrink-0 text-[hsl(var(--muted-foreground))]"
            onClick={() => setOpen((current) => !current)}
            title={open ? "Collapse section" : "Expand section"}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </CardHeader>
      {open ? <CardContent className={cn(contentClassName)}>{children}</CardContent> : null}
    </Card>
  );
}
