/**
 * RelationshipGraph component test — renders the co-presence ego-network SVG
 * from a fixed graph and asserts the honest-labeling contract: confirmed edges
 * (touching the center) render solid, inferred edges (between two non-center
 * users) render dashed, and every node + the disclaimer legend appear.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelationshipGraph } from "../RelationshipGraph";
import type { CoPresenceGraph } from "@/lib/ipc";

function buildGraph(): CoPresenceGraph {
  const now = Math.floor(Date.now() / 1000);
  return {
    center: "usr_self",
    since_days: 90,
    min_overlap_sec: 60,
    nodes: [
      { user_id: "usr_self", display_name: "Me", sessions: 10, total_seconds: 80_000, last_seen: now, is_center: true },
      { user_id: "usr_alice", display_name: "Alice", sessions: 6, total_seconds: 30_000, last_seen: now, is_center: false },
      { user_id: "usr_bob", display_name: "Bob", sessions: 4, total_seconds: 12_000, last_seen: now, is_center: false },
    ],
    edges: [
      { source: "usr_self", target: "usr_alice", kind: "confirmed", overlap_count: 6, overlap_seconds: 25_000, last_overlap: now },
      { source: "usr_alice", target: "usr_bob", kind: "co_presence", overlap_count: 3, overlap_seconds: 4_000, last_overlap: now },
    ],
  };
}

describe("RelationshipGraph", () => {
  it("renders one SVG with a node group per graph node", () => {
    render(<RelationshipGraph graph={buildGraph()} />);
    const svg = document.querySelector('svg[role="img"]');
    expect(svg).toBeTruthy();
    // Each node renders its label text; assert all three appear.
    expect(screen.getByText("Me")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("draws confirmed edges solid and inferred edges dashed", () => {
    render(<RelationshipGraph graph={buildGraph()} />);
    const lines = Array.from(document.querySelectorAll("line"));
    expect(lines.length).toBe(2);
    const dashed = lines.filter((l) => l.getAttribute("stroke-dasharray"));
    const solid = lines.filter((l) => !l.getAttribute("stroke-dasharray"));
    // Exactly one inferred (dashed) edge and one confirmed (solid) edge.
    expect(dashed.length).toBe(1);
    expect(solid.length).toBe(1);
  });

  it("shows the honesty disclaimer legend (confirmed vs inferred)", () => {
    render(<RelationshipGraph graph={buildGraph()} />);
    const body = document.body.textContent ?? "";
    expect(/confirmed/i.test(body)).toBe(true);
    expect(/inferred|not confirmed/i.test(body)).toBe(true);
  });

  it("renders an empty-state message for a graph with no nodes", () => {
    const empty: CoPresenceGraph = {
      center: "usr_self",
      since_days: 90,
      min_overlap_sec: 60,
      nodes: [],
      edges: [],
    };
    render(<RelationshipGraph graph={empty} />);
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(/no co-presence/i.test(document.body.textContent ?? "")).toBe(true);
  });
});
