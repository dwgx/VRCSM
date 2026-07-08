#include <gtest/gtest.h>

#include "core/FriendAnalytics.h"

using namespace vrcsm::core::analytics;

// ─── shared helpers ─────────────────────────────────────────────

TEST(FriendAnalytics, ParsePresenceInstantUtcZIsTimezoneStable)
{
    // Trailing 'Z' parses via _mkgmtime → absolute UTC, independent of host TZ.
    const auto a = parsePresenceInstant("2026-01-01T00:00:00Z");
    const auto b = parsePresenceInstant("2026-01-01T01:00:00Z");
    ASSERT_TRUE(a.has_value());
    ASSERT_TRUE(b.has_value());
    EXPECT_EQ(*b - *a, 3600);
}

TEST(FriendAnalytics, ParsePresenceInstantAcceptsVrchatDotFormat)
{
    // The majority of rows (player_events/log_events/world_visits) are stored
    // in VRChat's DOT format "YYYY.MM.DD HH:MM:SS", NOT ISO. The parser must
    // accept it — previously it only accepted ISO, so every real row failed and
    // co-presence analytics dropped all data.
    const auto dot = parsePresenceInstant("2026.07.05 21:01:10");
    ASSERT_TRUE(dot.has_value());
    // One hour later in the same format is exactly 3600s apart.
    const auto dotLater = parsePresenceInstant("2026.07.05 22:01:10");
    ASSERT_TRUE(dotLater.has_value());
    EXPECT_EQ(*dotLater - *dot, 3600);
    // Garbage still rejected.
    EXPECT_FALSE(parsePresenceInstant("not-a-timestamp").has_value());
}

TEST(FriendAnalytics, IntervalOverlapDisjointIsZero)
{
    EXPECT_EQ(intervalOverlap(PresenceInterval{0, 100}, PresenceInterval{200, 300}), 0);
    EXPECT_EQ(intervalOverlap(PresenceInterval{0, 100}, PresenceInterval{50, 150}), 50);
}

TEST(FriendAnalytics, NormalizeSearchQueryCollapsesAndLowercases)
{
    EXPECT_EQ(normalizeSearchQuery("  Hello   WORLD  "), "hello world");
    EXPECT_EQ(normalizeSearchQuery(""), "");
}

// ─── coPresenceEgoNetwork ───────────────────────────────────────

TEST(FriendAnalytics, CoPresenceBuildsConfirmedEdgeForCenter)
{
    // Two users share one instance, overlapping 10:30–11:00 = 1800s.
    // Rows MUST be pre-sorted by (world, instance, time ASC).
    std::vector<PresenceEventRow> rows{
        {"usr_a", "Alice", "wrld_1", "i1", "joined", "2026-01-01T10:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "joined", "2026-01-01T10:30:00Z"},
        {"usr_a", "Alice", "wrld_1", "i1", "left",   "2026-01-01T11:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "left",   "2026-01-01T11:30:00Z"},
    };

    // now far in the future so the 90-day window keeps everything.
    const std::time_t now = parsePresenceInstant("2026-01-02T00:00:00Z").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 60, now);

    EXPECT_EQ(out["center"], "usr_a");
    EXPECT_EQ(out["since_days"], 90);
    EXPECT_EQ(out["min_overlap_sec"], 60);
    ASSERT_EQ(out["nodes"].size(), 2u);
    ASSERT_EQ(out["edges"].size(), 1u);

    const auto& edge = out["edges"][0];
    EXPECT_EQ(edge["source"], "usr_a");
    EXPECT_EQ(edge["target"], "usr_b");
    EXPECT_EQ(edge["kind"], "confirmed"); // touches center
    EXPECT_EQ(edge["overlap_count"], 1);
    EXPECT_EQ(edge["overlap_seconds"], 1800);

    // center flag surfaces on the right node.
    bool sawCenter = false;
    for (const auto& n : out["nodes"])
    {
        if (n["user_id"] == "usr_a")
        {
            EXPECT_TRUE(n["is_center"].get<bool>());
            sawCenter = true;
        }
    }
    EXPECT_TRUE(sawCenter);
}

TEST(FriendAnalytics, CoPresenceWorksWithVrchatDotTimestamps)
{
    // Regression: with real DOT-format timestamps the graph used to come back
    // empty because parsePresenceInstant failed on every row. Same scenario as
    // CoPresenceBuildsConfirmedEdgeForCenter but in the stored DOT format.
    std::vector<PresenceEventRow> rows{
        {"usr_a", "Alice", "wrld_1", "i1", "joined", "2026.07.05 10:00:00"},
        {"usr_b", "Bob",   "wrld_1", "i1", "joined", "2026.07.05 10:30:00"},
        {"usr_a", "Alice", "wrld_1", "i1", "left",   "2026.07.05 11:00:00"},
        {"usr_b", "Bob",   "wrld_1", "i1", "left",   "2026.07.05 11:30:00"},
    };

    const std::time_t now = parsePresenceInstant("2026.07.06 00:00:00").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 60, now);

    ASSERT_EQ(out["nodes"].size(), 2u);
    ASSERT_EQ(out["edges"].size(), 1u);
    EXPECT_EQ(out["edges"][0]["overlap_seconds"], 1800);
}

TEST(FriendAnalytics, CoPresenceDropsBelowMinOverlap)
{
    // 1800s overlap but min_overlap_sec is 3600 → no edge.
    std::vector<PresenceEventRow> rows{
        {"usr_a", "Alice", "wrld_1", "i1", "joined", "2026-01-01T10:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "joined", "2026-01-01T10:30:00Z"},
        {"usr_a", "Alice", "wrld_1", "i1", "left",   "2026-01-01T11:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "left",   "2026-01-01T11:30:00Z"},
    };
    const std::time_t now = parsePresenceInstant("2026-01-02T00:00:00Z").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 3600, now);
    EXPECT_EQ(out["edges"].size(), 0u);
}

// ─── predictFriendOnlineWindows ─────────────────────────────────

TEST(FriendAnalytics, PredictInsufficientDataIsDeterministic)
{
    // No rows → 0 observation days → insufficient_data, regardless of host TZ.
    const std::vector<PredictPresenceRow> rows;
    const auto out = predictFriendOnlineWindows(rows, "usr_x", 3, 4, 1767225600 /*2026-01-01Z*/, -300);

    EXPECT_EQ(out["user_id"], "usr_x");
    EXPECT_EQ(out["status"], "insufficient_data");
    EXPECT_EQ(out["observation_days"], 0);
    EXPECT_EQ(out["half_life_weeks"], 4);
    EXPECT_EQ(out["timezone_offset_minutes"], -300); // passed through, not read from host
    EXPECT_TRUE(out["heatmap"].is_array());
    EXPECT_EQ(out["heatmap"].size(), 0u);
    EXPECT_TRUE(out["top_windows"].is_array());
    EXPECT_EQ(out["top_windows"].size(), 0u);
}

// ─── globalSearch ───────────────────────────────────────────────

TEST(FriendAnalytics, GlobalSearchEnvelopeAndFavoriteItem)
{
    GlobalSearchInput input;
    input.favorites.push_back(FavoriteRow{
        "world", "wrld_abc", "My Worlds", "Cool World",
        std::optional<std::string>{"https://thumb.local/x.png"},
        std::optional<std::string>{"2026-01-01T00:00:00Z"},
        "", ""});

    nlohmann::json request = nlohmann::json::object(); // no type filter → all allowed
    const auto out = globalSearch(input, request, "", "", 20, 0);

    EXPECT_EQ(out["query"], "");
    EXPECT_EQ(out["normalizedQuery"], "");
    EXPECT_EQ(out["mode"], "local");
    ASSERT_TRUE(out["items"].is_array());
    ASSERT_EQ(out["items"].size(), 1u);

    const auto& item = out["items"][0];
    EXPECT_EQ(item["type"], "world");
    EXPECT_EQ(item["id"], "wrld_abc");
    EXPECT_EQ(item["displayName"], "Cool World");
    EXPECT_TRUE(item["localStatus"]["isFavorite"].get<bool>());
    EXPECT_EQ(item["thumbnail"]["kind"], "local-thumb");
    EXPECT_EQ(item["thumbnail"]["source"], "thumb.local");

    // pagination end: only one candidate, so nextOffset is null.
    EXPECT_TRUE(out["nextOffset"].is_null());
    EXPECT_TRUE(out["diagnostics"].is_object());
}

TEST(FriendAnalytics, GlobalSearchTypeFilterExcludesUnrequested)
{
    GlobalSearchInput input;
    input.userEncounters.push_back(UserEncounterRow{
        "usr_1", "Someone", 5,
        std::optional<std::string>{"2026-01-01T00:00:00Z"},
        std::optional<std::string>{"2026-01-02T00:00:00Z"},
        "wrld_1"});

    // Request only worlds → the user encounter must be filtered out.
    nlohmann::json request = {{"types", nlohmann::json::array({"world"})}};
    const auto out = globalSearch(input, request, "", "", 20, 0);
    EXPECT_EQ(out["items"].size(), 0u);
}
