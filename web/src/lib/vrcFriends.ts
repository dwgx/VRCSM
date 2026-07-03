/**
 * VRChat user metadata helpers — location parsing, trust rank resolution,
 * relative-time formatting. Kept out of components because every call here
 * is "stringly typed" (VRChat's API shoves many concepts into one field)
 * and a unit-testable layer is cheaper than hunting regex bugs across four
 * component files.
 *
 * The shape of each helper is lifted from VRCX's `InstanceAccessType.js`
 * and `TrustColor.js` — MIT-licensed source, same rules, same rank names,
 * so a user switching back and forth between the two tools sees identical
 * classifications.
 */

import i18n from "@/i18n";

export type InstanceType =
  | "public"
  | "friends+"
  | "friends"
  | "invite+"
  | "invite"
  | "group"
  | "group-public"
  | "group-plus"
  | "unknown";

export interface LocationInfo {
  /**
   * One of the five "where are they" buckets the UI cares about. `world`
   * is the only case that carries sub-fields.
   */
  kind: "offline" | "private" | "traveling" | "world" | "unknown";
  worldId?: string;
  instanceId?: string;
  instanceType?: InstanceType;
  /** `us` | `use` | `usx` | `eu` | `jp` — raw region code. */
  region?: string;
  /** User id of the instance owner when one is named (friends, invite, group). */
  ownerId?: string;
}

/**
 * VRChat cements the instance type into suffixes on the instanceId:
 *
 *   wrld_<uuid>:12345                                     → public
 *   wrld_<uuid>:12345~hidden(usr_x)                       → friends+ ("hidden")
 *   wrld_<uuid>:12345~friends(usr_x)                      → friends
 *   wrld_<uuid>:12345~private(usr_x)                      → invite
 *   wrld_<uuid>:12345~private(usr_x)~canRequestInvite     → invite+
 *   wrld_<uuid>:12345~group(grp_x)                        → group
 *   wrld_<uuid>:12345~group(grp_x)~groupAccessType(public) → group public
 *   wrld_<uuid>:12345~group(grp_x)~groupAccessType(plus)   → group plus
 *
 * Region is tacked on as `~region(us)` independently of the type.
 *
 * We do the dumbest possible parse: split on `~`, look up each marker by
 * prefix. No regex — too easy to write one that misses a rare case.
 */
export function parseLocation(location: string | null): LocationInfo {
  if (!location) return { kind: "unknown" };
  if (location === "offline") return { kind: "offline" };
  if (location === "private") return { kind: "private" };
  if (location === "traveling") return { kind: "traveling" };
  if (!location.startsWith("wrld_")) return { kind: "unknown" };

  const segments = location.split("~");
  const [head, ...markers] = segments;
  const [worldId, instanceId] = head.split(":", 2);

  let instanceType: InstanceType = "public";
  let region: string | undefined;
  let ownerId: string | undefined;
  let isGroup = false;
  let groupAccessType: string | undefined;
  let canRequestInvite = false;

  for (const raw of markers) {
    const parenStart = raw.indexOf("(");
    const parenEnd = raw.endsWith(")") ? raw.length - 1 : raw.length;
    const name = parenStart === -1 ? raw : raw.slice(0, parenStart);
    const payload =
      parenStart === -1 ? "" : raw.slice(parenStart + 1, parenEnd);

    switch (name) {
      case "region":
        region = payload;
        break;
      case "hidden":
        instanceType = "friends+";
        ownerId = payload;
        break;
      case "friends":
        instanceType = "friends";
        ownerId = payload;
        break;
      case "private":
        instanceType = "invite";
        ownerId = payload;
        break;
      case "canRequestInvite":
        canRequestInvite = true;
        break;
      case "group":
        isGroup = true;
        ownerId = payload;
        break;
      case "groupAccessType":
        groupAccessType = payload;
        break;
      default:
        break;
    }
  }

  if (instanceType === "invite" && canRequestInvite) {
    instanceType = "invite+";
  }
  if (isGroup) {
    if (groupAccessType === "public") instanceType = "group-public";
    else if (groupAccessType === "plus") instanceType = "group-plus";
    else instanceType = "group";
  }

  return {
    kind: "world",
    worldId,
    instanceId,
    instanceType,
    region,
    ownerId,
  };
}

/**
 * Trust rank derived from the `system_trust_*` tags. Order matters — we
 * pick the highest rank the user has. `troll` is admin-set and overrides
 * everything, `veteran` is the internal name for "Trusted User" (blue).
 *
 * Color tokens map to the same HSL values VRCX uses, expressed as CSS
 * vars in `web/src/index.css` so theme switchers can retint them.
 */
export type TrustRank =
  | "troll"
  | "veteran"
  | "trusted"
  | "known"
  | "user"
  | "new"
  | "visitor";

export function trustRank(tags: string[]): TrustRank {
  if (tags.includes("admin_moderator")) return "veteran";
  if (tags.includes("system_troll") || tags.includes("system_probable_troll")) {
    return "troll";
  }
  if (tags.includes("system_trust_veteran")) return "veteran";
  if (tags.includes("system_trust_trusted")) return "trusted";
  if (tags.includes("system_trust_known")) return "known";
  if (tags.includes("system_trust_basic")) return "user";
  if (tags.includes("system_trust_intermediate")) return "new";
  return "visitor";
}

export function trustLabelKey(rank: TrustRank): string {
  return `friends.trust.${rank}`;
}

/**
 * Exact hex color for each trust rank — used for the status-dot ring next
 * to each friend's avatar. These are VRChat's canonical palette:
 *   Visitor=#888  New User=#1778FF  User=#2BCF5C  Known=#FF7B42
 *   Trusted=#8143E6  Veteran/Legend=#FFD000  Troll=red
 */
export function trustDotColor(rank: TrustRank): string {
  switch (rank) {
    case "troll":
      return "#EF4444";
    case "veteran":
      return "#FFD000";
    case "trusted":
      return "#8143E6";
    case "known":
      return "#FF7B42";
    case "user":
      return "#2BCF5C";
    case "new":
      return "#1778FF";
    default:
      return "#888888";
  }
}

/**
 * Tailwind-friendly color tokens per rank. Kept as hard-coded HSL so we
 * don't need per-rank CSS vars in the theme — trust colors are fixed
 * VRChat-lore colors that shouldn't follow the app's accent hue.
 */
export function trustColorClass(rank: TrustRank): string {
  switch (rank) {
    case "troll":
      return "text-red-500";
    case "veteran":
      return "text-purple-400";
    case "trusted":
      return "text-orange-400";
    case "known":
      return "text-emerald-400";
    case "user":
      return "text-sky-400";
    case "new":
      return "text-sky-300";
    default:
      return "text-slate-400";
  }
}

/**
 * `"2 minutes ago"` / `"3 hours ago"` / `"yesterday"` / `"last week"` —
 * VRChat hands us ISO timestamps, the UI wants something human. Empty
 * input falls through to an empty string so the caller can branch on
 * truthiness without guarding twice.
 *
 * Localized via `Intl.RelativeTimeFormat` keyed to the active i18n language,
 * so a zh-CN user sees "3分钟前" instead of leaked English. `Intl` owns the
 * per-locale plural rules and wording, so we don't carry translation keys for
 * every unit. Falls back to a hand-rolled English string only if `Intl`
 * (or the locale) is unavailable in the runtime.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - when) / 1000));

  // Pick the largest unit that fits, then let Intl render it for the locale.
  // Negative values => "ago" (the event is in the past).
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (diffSec < 60) {
    // Sub-minute reads as "now" rather than "0 seconds ago" in every locale.
    value = 0;
    unit = "second";
  } else if (diffSec < 3600) {
    value = -Math.floor(diffSec / 60);
    unit = "minute";
  } else if (diffSec < 86400) {
    value = -Math.floor(diffSec / 3600);
    unit = "hour";
  } else if (diffSec < 86400 * 7) {
    value = -Math.floor(diffSec / 86400);
    unit = "day";
  } else if (diffSec < 86400 * 30) {
    value = -Math.floor(diffSec / (86400 * 7));
    unit = "week";
  } else if (diffSec < 86400 * 365) {
    value = -Math.floor(diffSec / (86400 * 30));
    unit = "month";
  } else {
    value = -Math.floor(diffSec / (86400 * 365));
    unit = "year";
  }

  try {
    const lang = i18n.language || "en";
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    return rtf.format(value, unit);
  } catch {
    // Runtime without Intl.RelativeTimeFormat or an unknown locale — keep the
    // old terse English so the UI never renders blank.
    if (unit === "second") return "just now";
    const abbrev: Record<string, string> = {
      minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y",
    };
    return `${Math.abs(value)}${abbrev[unit] ?? ""} ago`;
  }
}

/**
 * Human label for a region code. Falls through to upper-casing the raw
 * code so an unknown region (future VRChat expansion) still renders
 * something informative rather than nothing at all.
 */
export function regionLabel(region: string | undefined): string {
  if (!region) return "";
  switch (region.toLowerCase()) {
    case "us":
      return "US West";
    case "use":
      return "US East";
    case "usx":
      return "US Central";
    case "eu":
      return "Europe";
    case "jp":
      return "Japan";
    default:
      return region.toUpperCase();
  }
}

export function instanceTypeLabel(t: InstanceType | undefined): string {
  if (!t) return "";
  switch (t) {
    case "public":
      return "Public";
    case "friends+":
      return "Friends+";
    case "friends":
      return "Friends";
    case "invite+":
      return "Invite+";
    case "invite":
      return "Invite";
    case "group":
      return "Group";
    case "group-public":
      return "Group Public";
    case "group-plus":
      return "Group+";
    default:
      return "";
  }
}

/**
 * The five "buckets" the UI groups friends into. `active` lumps
 * `active`/`join me` together; everything with no known status drops into
 * `offline` so we don't have a trailing "unknown" category the user has
 * to deal with.
 */
export type StatusBucket =
  | "joinMe"
  | "active"
  | "askMe"
  | "busy"
  | "offline";

export function statusBucket(status: string | null): StatusBucket {
  switch (status) {
    case "join me":
      return "joinMe";
    case "active":
      return "active";
    case "ask me":
      return "askMe";
    case "busy":
      return "busy";
    default:
      return "offline";
  }
}

/**
 * Count how many friends are currently online. VRChat reports an offline
 * friend with `location === "offline"` (or a null/empty location); anything
 * else — a world id, "private", or "traveling" — means they're connected.
 * Mirrors the filter Dashboard uses so the status-bar tally and the Dashboard
 * card never disagree. Pure + tested.
 */
export function countOnlineFriends(
  friends: ReadonlyArray<{ location?: string | null }>,
): number {
  let n = 0;
  for (const f of friends) {
    if (f.location && f.location !== "offline") n += 1;
  }
  return n;
}

export const STATUS_BUCKET_ORDER: StatusBucket[] = [
  "joinMe",
  "active",
  "askMe",
  "busy",
  "offline",
];

// Colorblind-friendly status indicator: the status colors (green / blue /
// orange / red / grey) are hard to tell apart for ~8% of users, so we pair each
// bucket with a distinct CSS shape. Returned classes are applied on top of the
// existing color dot when the accessibility pref is on. Shapes are chosen to be
// distinguishable in monochrome: ring (joinMe), solid (active), diamond
// (askMe), square (busy), hollow (offline).
export type StatusShape = "ring" | "solid" | "diamond" | "square" | "hollow";

export function statusShape(status: string | null): StatusShape {
  switch (statusBucket(status)) {
    case "joinMe":
      return "ring";
    case "active":
      return "solid";
    case "askMe":
      return "diamond";
    case "busy":
      return "square";
    default:
      return "hollow";
  }
}

// Tailwind class fragment that morphs a base color dot into the shape above.
// Caller supplies the base `rounded-full` + size; these override geometry.
export function statusShapeClass(shape: StatusShape): string {
  switch (shape) {
    case "diamond":
      return "rotate-45 rounded-[1px]";
    case "square":
      return "rounded-[1px]";
    case "ring":
      return "ring-2 ring-inset ring-[hsl(var(--surface))]";
    case "hollow":
      return "bg-transparent border-2 border-current";
    case "solid":
    default:
      return "";
  }
}
