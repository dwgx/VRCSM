import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { userColor } from "@/lib/user-color";
import type { CoPresenceGraph, CoPresenceNode } from "@/lib/ipc";

interface RelationshipGraphProps {
  graph: CoPresenceGraph;
  /** Called when a node is clicked, with the node's user_id. */
  onSelect?: (userId: string) => void;
}

interface LaidOutNode {
  node: CoPresenceNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const WIDTH = 640;
const HEIGHT = 440;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

// Node radius scales with sqrt(sessions) so area (not radius) tracks frequency.
function radiusFor(node: CoPresenceNode): number {
  if (node.is_center) return 22;
  const base = 7;
  return base + Math.min(16, Math.sqrt(Math.max(0, node.sessions)) * 2.2);
}

/**
 * Zero-dependency force-directed ego-network. We run a small fixed number of
 * deterministic simulation ticks (no animation loop, no rAF dependency) so the
 * layout is stable across renders and cheap enough for the smoke tests. The
 * center node is pinned to the middle; everyone else is repelled from each
 * other (Coulomb) and pulled toward connected nodes (Hooke), with a gentle
 * gravity to the center so disconnected mates don't drift off-canvas.
 *
 * Honest labeling: "confirmed" edges (touching the center — we logged them from
 * our own instance) render solid; "co_presence" edges (inferred between two
 * other users) render dashed and dimmer. We never imply a confirmed friendship.
 */
function layout(graph: CoPresenceGraph): LaidOutNode[] {
  const nodes: LaidOutNode[] = graph.nodes.map((node, i) => {
    if (node.is_center) {
      return { node, x: CENTER_X, y: CENTER_Y, vx: 0, vy: 0, r: radiusFor(node) };
    }
    // Seed non-center nodes on a deterministic ring (golden-angle spread) so the
    // starting layout is reproducible — no Math.random, so tests are stable.
    const angle = i * 2.399963; // golden angle in radians
    const ring = 120 + (i % 3) * 40;
    return {
      node,
      x: CENTER_X + Math.cos(angle) * ring,
      y: CENTER_Y + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      r: radiusFor(node),
    };
  });

  const idx = new Map<string, number>();
  nodes.forEach((n, i) => idx.set(n.node.user_id, i));

  const ITER = 220;
  const K_REPEL = 5200;   // Coulomb constant
  const K_SPRING = 0.012; // Hooke constant
  const REST_LEN = 110;
  const GRAVITY = 0.006;
  const DAMP = 0.85;

  for (let step = 0; step < ITER; step++) {
    // Repulsion between every pair.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const dist = Math.sqrt(d2);
        const force = K_REPEL / d2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // Spring attraction along edges.
    for (const e of graph.edges) {
      const ai = idx.get(e.source);
      const bi = idx.get(e.target);
      if (ai === undefined || bi === undefined) continue;
      const a = nodes[ai];
      const b = nodes[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const disp = dist - REST_LEN;
      const fx = (dx / dist) * disp * K_SPRING;
      const fy = (dy / dist) * disp * K_SPRING;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Gravity toward center + integrate.
    for (const n of nodes) {
      if (n.node.is_center) { n.vx = 0; n.vy = 0; continue; }
      n.vx += (CENTER_X - n.x) * GRAVITY;
      n.vy += (CENTER_Y - n.y) * GRAVITY;
      n.vx *= DAMP;
      n.vy *= DAMP;
      n.x += n.vx;
      n.y += n.vy;
      // Keep inside the viewport with a margin.
      n.x = Math.max(n.r + 4, Math.min(WIDTH - n.r - 4, n.x));
      n.y = Math.max(n.r + 4, Math.min(HEIGHT - n.r - 4, n.y));
    }
  }

  return nodes;
}

export function RelationshipGraph({ graph, onSelect }: RelationshipGraphProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const laidOut = useMemo(() => layout(graph), [graph]);
  const posById = useMemo(() => {
    const m = new Map<string, LaidOutNode>();
    for (const n of laidOut) m.set(n.node.user_id, n);
    return m;
  }, [laidOut]);

  // Reset hover when the graph identity changes.
  useEffect(() => { setHovered(null); }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className="py-10 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("socialGraph.graphEmpty", { defaultValue: "No co-presence data yet. Edges appear once VRCSM has logged players sharing your instances." })}
      </div>
    );
  }

  const focusedNode = hovered !== null ? posById.get(hovered)?.node : undefined;

  return (
    <div className="flex flex-col gap-2">
      {/* Announce the hovered/focused node to assistive tech so keyboard users
          get the same context sighted users get on hover. */}
      <div className="sr-only" aria-live="polite" role="status">
        {focusedNode
          ? t("socialGraph.nodeFocused", {
              defaultValue: "{{name}} focused",
              name: focusedNode.display_name || focusedNode.user_id,
            })
          : ""}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto rounded-md bg-[hsl(var(--surface)/0.4)] border border-[hsl(var(--border)/0.4)]"
        role="img"
        aria-label={t("socialGraph.graphAria", { defaultValue: "Co-presence relationship graph" })}
      >
        {/* Edges first so nodes paint on top. */}
        <g>
          {graph.edges.map((e) => {
            const a = posById.get(e.source);
            const b = posById.get(e.target);
            if (!a || !b) return null;
            const confirmed = e.kind === "confirmed";
            const active = hovered === null || hovered === e.source || hovered === e.target;
            const weight = Math.max(1, Math.min(4, Math.log2(1 + e.overlap_count)));
            return (
              <line
                key={`${e.source}__${e.target}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={confirmed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                strokeWidth={weight}
                strokeDasharray={confirmed ? undefined : "4 3"}
                strokeOpacity={active ? (confirmed ? 0.65 : 0.35) : 0.08}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Nodes. */}
        <g>
          {laidOut.map(({ node, x, y, r }) => {
            const color = node.is_center
              ? "hsl(var(--primary))"
              : userColor(node.user_id).css;
            const dim = hovered !== null && hovered !== node.user_id
              && !graph.edges.some((e) =>
                (e.source === hovered && e.target === node.user_id) ||
                (e.target === hovered && e.source === node.user_id));
            return (
              <g
                key={node.user_id}
                transform={`translate(${x} ${y})`}
                style={{ cursor: "pointer", opacity: dim ? 0.25 : 1, outline: "none" }}
                onMouseEnter={() => setHovered(node.user_id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.user_id)}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect?.(node.user_id)}
                // Keyboard access: Enter/Space activates like a click. Matches the
                // role="button" div pattern in Avatars.tsx (tabIndex + Enter/Space).
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect?.(node.user_id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={node.display_name || node.user_id}
                className="focus-visible:outline-none [&>circle]:focus-visible:stroke-[hsl(var(--primary))] [&>circle]:focus-visible:[stroke-width:3]"
              >
                <circle
                  r={r}
                  fill={color}
                  fillOpacity={node.is_center ? 0.9 : 0.78}
                  stroke="hsl(var(--background))"
                  strokeWidth={node.is_center ? 2.5 : 1.5}
                />
                <text
                  y={r + 11}
                  textAnchor="middle"
                  className="fill-[hsl(var(--foreground))] font-mono"
                  style={{ fontSize: node.is_center ? 11 : 9, pointerEvents: "none" }}
                >
                  {(node.display_name || node.user_id).slice(0, 16)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend + honesty disclaimer. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[hsl(var(--muted-foreground))]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[2px] bg-[hsl(var(--primary))]" />
          {t("socialGraph.legendConfirmed", { defaultValue: "Confirmed co-presence (your instance)" })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-[2px] border-t border-dashed border-[hsl(var(--muted-foreground))]" />
          {t("socialGraph.legendInferred", { defaultValue: "Inferred co-presence (others, not confirmed friends)" })}
        </span>
      </div>
    </div>
  );
}
