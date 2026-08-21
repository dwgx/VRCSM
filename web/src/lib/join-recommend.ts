/**
 * Display-only join suggestions. Never invites.
 * Score: history volume, plus a large boost if currently online.
 */
export interface JoinRecommendNode {
  user_id: string;
  display_name?: string | null;
  is_center?: boolean;
  sessions?: number;
  total_seconds?: number;
}

export interface JoinCandidate {
  id: string;
  name: string;
  score: number;
}

export function rankJoinCandidates(
  nodes: readonly JoinRecommendNode[],
  friendIds: ReadonlySet<string>,
  selfUserId: string | null,
  onlineIds: ReadonlySet<string> = new Set(),
  limit = 5,
): JoinCandidate[] {
  const out: JoinCandidate[] = [];
  for (const node of nodes) {
    const id = node.user_id?.trim() ?? "";
    if (!id.startsWith("usr_")) continue;
    if (node.is_center) continue;
    if (selfUserId && id === selfUserId) continue;
    if (friendIds.has(id)) continue;
    const history = (node.sessions ?? 0) * 1000 + (node.total_seconds ?? 0);
    const onlineBoost = onlineIds.has(id) ? 1_000_000 : 0;
    out.push({
      id,
      name: (node.display_name && node.display_name.trim()) || id,
      score: history + onlineBoost,
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}
