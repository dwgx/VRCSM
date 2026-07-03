import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Boxes, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Public-avatar search (the old "模型" page) and owned-avatar management (the
// old Model Database) now live behind one nav entry, switched by tabs.
const Avatars = lazy(() => import("./Avatars"));
const ModelDb = lazy(() => import("./ModelDb"));

type ModelsTab = "browse" | "owned";

const VALID_TABS: ModelsTab[] = ["browse", "owned"];

export default function ModelsHub() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTabState] = useState<ModelsTab>(() => {
    // `/models` redirects here with ?tab=owned so that deep link lands on the
    // owned-avatar manager rather than public search.
    const param = searchParams.get("tab");
    if (param && VALID_TABS.includes(param as ModelsTab)) return param as ModelsTab;
    return "browse";
  });

  const setTab = (next: ModelsTab) => {
    setTabState(next);
    if (searchParams.has("tab")) {
      searchParams.delete("tab");
      setSearchParams(searchParams, { replace: true });
    }
  };

  const tabs: Array<{ key: ModelsTab; labelKey: string; defaultValue: string; icon: typeof Search }> = [
    {
      key: "browse",
      labelKey: "models.tab.browse",
      defaultValue: "Browse",
      icon: Search,
    },
    {
      key: "owned",
      labelKey: "models.tab.owned",
      defaultValue: "My Avatars",
      icon: Boxes,
    },
  ];

  const fallback = (
    <div className="flex items-center justify-center py-20 text-[hsl(var(--muted-foreground))]">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header>
        <h1 className="text-[22px] font-semibold leading-none tracking-tight flex items-center gap-2">
          <Boxes className="size-5 text-[hsl(var(--primary))]" />
          {t("nav.avatars", { defaultValue: "Avatars" })}
        </h1>
        <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
          {tab === "browse"
            ? t("avatars.subtitle")
            : t("modelDb.subtitle", {
                defaultValue:
                  "Manage the avatars your account owns: rename, edit visibility, swap the image, or delete.",
              })}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1.5">
        {tabs.map(({ key, labelKey, defaultValue, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors",
              tab === key
                ? "bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))] shadow-sm"
                : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]",
            )}
          >
            <Icon className="size-3.5" />
            {t(labelKey, { defaultValue })}
          </button>
        ))}
      </div>

      <Suspense fallback={fallback}>
        {tab === "browse" && <Avatars embedded />}
        {tab === "owned" && <ModelDb embedded />}
      </Suspense>
    </div>
  );
}
