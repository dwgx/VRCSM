import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ipc } from "@/lib/ipc";
import { formatDate } from "@/lib/utils";
import type { LocalAvatarItem, Report } from "@/lib/types";

interface UserGroup {
  user_id: string;
  items: LocalAvatarItem[];
}

function Avatars() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .scan()
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo<UserGroup[]>(() => {
    if (!report) return [];
    const map = new Map<string, LocalAvatarItem[]>();
    for (const item of report.local_avatar_data.recent_items) {
      const list = map.get(item.user_id) ?? [];
      list.push(item);
      map.set(item.user_id, list);
    }
    return Array.from(map.entries()).map(([user_id, items]) => ({ user_id, items }));
  }, [report]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Avatars</h1>
        <p className="text-sm text-muted-foreground">
          LocalAvatarData entries grouped by user.
        </p>
      </header>

      {loading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Scanning…
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle>Failed to load</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No LocalAvatarData entries found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.user_id}>
              <CardHeader>
                <CardTitle className="font-mono text-sm">{group.user_id}</CardTitle>
                <CardDescription>{group.items.length} avatar(s)</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-0">
                {group.items.map((item) => (
                  <div
                    key={item.avatar_id}
                    className="flex flex-col gap-1 rounded-md border border-border/40 bg-background/30 p-3"
                  >
                    <div className="font-mono text-xs">{item.avatar_id}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">
                        eye {item.eye_height?.toFixed(2) ?? "—"}
                      </Badge>
                      <Badge variant="outline">{item.parameter_count} params</Badge>
                      <span>modified {formatDate(item.modified_at)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default Avatars;
