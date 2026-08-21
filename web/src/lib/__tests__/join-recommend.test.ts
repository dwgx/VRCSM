import { describe, expect, it } from "vitest";
import { rankJoinCandidates } from "@/lib/join-recommend";

describe("rankJoinCandidates", () => {
  const nodes = [
    { user_id: "usr_self", display_name: "Me", is_center: true, sessions: 99, total_seconds: 99 },
    { user_id: "usr_friend", display_name: "Pal", sessions: 10, total_seconds: 100 },
    { user_id: "usr_hist", display_name: "Hist", sessions: 5, total_seconds: 50 },
    { user_id: "usr_online", display_name: "Now", sessions: 1, total_seconds: 10 },
  ];

  it("drops self and existing friends", () => {
    const ranked = rankJoinCandidates(
      nodes,
      new Set(["usr_friend"]),
      "usr_self",
    );
    expect(ranked.map((r) => r.id)).toEqual(["usr_hist", "usr_online"]);
  });

  it("ranks currently online above history-only", () => {
    const ranked = rankJoinCandidates(
      nodes,
      new Set(["usr_friend"]),
      "usr_self",
      new Set(["usr_online"]),
    );
    expect(ranked[0]?.id).toBe("usr_online");
    expect(ranked[1]?.id).toBe("usr_hist");
  });
});
