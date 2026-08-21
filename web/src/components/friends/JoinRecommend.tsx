import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { friendStubFromIdentity } from "@/lib/self-player";
import { rankJoinCandidates } from "@/lib/join-recommend";
import type { Friend } from "@/lib/types";
import { Button } from "@/components/ui/button";

/**
 * Display-only join suggestions from co-presence. Never invites.
 */
export function JoinRecommend({
  friends,
  selfUserId,
  onOpen,
}: {
  friends: readonly Friend[];
  selfUserId: string | null;
  onOpen: (friend: Friend) => void;
}) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Array<{ id: string; name: string }>>([]);
  const friendKey = friends.map((f) => f.id).sort().join("|");

  useEffect(() => {
    if (!selfUserId) {
      setNames([]);
      return;
    }
    const friendIds = new Set(friendKey ? friendKey.split("|") : []);
    let cancelled = false;
    void ipc
      .dbCoPresenceGraph(selfUserId, 90, 60)
      .then((graph) => {
        if (cancelled) return;
        setNames(
          rankJoinCandidates(graph.nodes ?? [], friendIds, selfUserId, new Set(), 5).map(
            (row) => ({ id: row.id, name: row.name }),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [friendKey, selfUserId]);

  if (names.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {t("friends.recommend.title", { defaultValue: "Seen in your worlds" })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((row) => (
          <Button
            key={row.id}
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            onClick={() => {
              const stub = friendStubFromIdentity(row.id, row.name);
              if (stub) onOpen(stub);
            }}
          >
            {row.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
