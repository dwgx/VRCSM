import { memo } from "react";
import { UserPopupBadge } from "./UserPopupBadge";
import { WorldPopupBadge } from "./WorldPopupBadge";
import { AvatarPopupBadge } from "./AvatarPopupBadge";

export type EntityKind = "user" | "world" | "avatar";

interface EntityLinkProps {
  /** Entity id. When `kind` is omitted it is inferred from the id prefix. */
  id: string;
  /** Optional explicit kind. If omitted, inferred from the `usr_`/`wrld_`/`avtr_` prefix. */
  kind?: EntityKind;
  /** Name hint shown before the deferred detail fetch resolves (user/world only). */
  name?: string;
  /** Compact rendering (user badge only). */
  compact?: boolean;
  /** Warm the world detail/asset before the dialog opens (world badge only). */
  prefetch?: boolean;
}

/**
 * Infer the entity kind from a VRChat id prefix. VRChat ids are
 * `usr_…`, `wrld_…`, `avtr_…`. Returns null when the prefix is unknown.
 */
export function inferEntityKind(id: string): EntityKind | null {
  if (id.startsWith("usr_")) return "user";
  if (id.startsWith("wrld_")) return "world";
  if (id.startsWith("avtr_")) return "avatar";
  return null;
}

/**
 * Single click-through entry point for any user/world/avatar mention. Dispatches
 * to the matching popup badge so every entity reference across the app gets the
 * same hover/click drill-in instead of some names being plain text. See
 * docs/BEAT-VRCX-PLAN.md Track C1.
 *
 * Falls back to plain text when the kind cannot be determined and no explicit
 * `kind` is given — never renders a broken badge for an unrecognized id.
 */
export const EntityLink = memo(function EntityLink({
  id,
  kind,
  name,
  compact = false,
  prefetch = false,
}: EntityLinkProps) {
  const resolved = kind ?? inferEntityKind(id) ?? undefined;

  switch (resolved) {
    case "user":
      return <UserPopupBadge userId={id} displayName={name} compact={compact} />;
    case "world":
      return <WorldPopupBadge worldId={id} prefetch={prefetch} />;
    case "avatar":
      return <AvatarPopupBadge avatarId={id} />;
    default:
      // Unknown id shape: render the best label we have as inert text rather
      // than a badge that would fire detail fetches against an invalid id.
      return <span className="text-[hsl(var(--muted-foreground))]">{name ?? id}</span>;
  }
});
