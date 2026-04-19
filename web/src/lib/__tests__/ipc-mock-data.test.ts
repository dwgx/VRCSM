/**
 * Tests for the extracted ipc-mock-data module.
 * Verifies that mock builders produce structurally valid shapes
 * that match the types the IPC client expects.
 */

import { describe, it, expect } from "vitest";
import {
  mockFavorites,
  buildFavoriteLists,
  buildMockFavoriteLists,
  sortFavoriteItems,
  buildMockReport,
  buildMockSettingsReport,
  buildMockFriends,
} from "../__mocks__/ipc-mock-data";

describe("ipc-mock-data", () => {
  describe("mockFavorites", () => {
    it("has at least one entry", () => {
      expect(mockFavorites.length).toBeGreaterThan(0);
    });

    it("each entry has required fields", () => {
      for (const item of mockFavorites) {
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("target_id");
        expect(item).toHaveProperty("list_name");
        expect(typeof item.sort_order).toBe("number");
      }
    });
  });

  describe("buildFavoriteLists", () => {
    it("returns at least one list summary from mock data", () => {
      const lists = buildFavoriteLists(mockFavorites);
      expect(lists.length).toBeGreaterThan(0);
    });

    it("each summary has required fields", () => {
      const lists = buildFavoriteLists(mockFavorites);
      for (const list of lists) {
        expect(list).toHaveProperty("list_name");
        expect(list).toHaveProperty("item_count");
        expect(list.item_count).toBeGreaterThan(0);
      }
    });

    it("returns empty array for empty input", () => {
      expect(buildFavoriteLists([])).toEqual([]);
    });
  });

  describe("buildMockFavoriteLists", () => {
    it("returns a non-empty array", () => {
      expect(buildMockFavoriteLists().length).toBeGreaterThan(0);
    });
  });

  describe("sortFavoriteItems", () => {
    it("sorts by sort_order then added_at", () => {
      const items = [
        { ...mockFavorites[0], sort_order: 2, added_at: "2026-01-01T00:00:00Z" },
        { ...mockFavorites[0], sort_order: 1, added_at: "2026-01-02T00:00:00Z" },
        { ...mockFavorites[0], sort_order: 1, added_at: "2026-01-01T00:00:00Z" },
      ];
      const sorted = sortFavoriteItems(items);
      expect(sorted[0].sort_order).toBe(1);
      expect(sorted[1].sort_order).toBe(1);
      expect(sorted[2].sort_order).toBe(2);
      // Same sort_order → earlier added_at first
      expect(sorted[0].added_at).toBe("2026-01-01T00:00:00Z");
      expect(sorted[1].added_at).toBe("2026-01-02T00:00:00Z");
    });

    it("does not mutate the input array", () => {
      const original = [...mockFavorites];
      sortFavoriteItems(mockFavorites);
      expect(mockFavorites).toEqual(original);
    });
  });

  describe("buildMockReport", () => {
    it("returns a structurally valid Report", () => {
      const report = buildMockReport();
      expect(report).toHaveProperty("generated_at");
      expect(report).toHaveProperty("base_dir");
      expect(report).toHaveProperty("category_summaries");
      expect(report).toHaveProperty("total_bytes");
      expect(report).toHaveProperty("cache_windows_player");
      expect(report).toHaveProperty("logs");
      expect(report.category_summaries.length).toBeGreaterThan(0);
    });

    it("has valid cache entries", () => {
      const report = buildMockReport();
      const cache = report.cache_windows_player;
      expect(cache.entry_count).toBe(cache.entries.length);
      expect(cache.entries.length).toBe(32);
      for (const entry of cache.entries) {
        expect(entry.bytes).toBeGreaterThan(0);
        expect(typeof entry.entry).toBe("string");
      }
    });

    it("has logs with environment data", () => {
      const report = buildMockReport();
      expect(report.logs.environment).toBeDefined();
      expect(typeof report.logs.environment.processor).toBe("string");
    });
  });

  describe("buildMockSettingsReport", () => {
    it("returns entries grouped by category", () => {
      const settings = buildMockSettingsReport();
      expect(settings.count).toBe(settings.entries.length);
      expect(settings.count).toBeGreaterThan(0);
      expect(Object.keys(settings.groups).length).toBeGreaterThan(0);
    });

    it("each entry has required fields", () => {
      const settings = buildMockSettingsReport();
      for (const entry of settings.entries) {
        expect(entry).toHaveProperty("encodedKey");
        expect(entry).toHaveProperty("key");
        expect(entry).toHaveProperty("group");
        expect(entry).toHaveProperty("description");
        expect(entry).toHaveProperty("type");
      }
    });
  });

  describe("buildMockFriends", () => {
    it("returns 12 friends", () => {
      const result = buildMockFriends();
      expect(result.friends.length).toBe(12);
    });

    it("each friend has required fields", () => {
      const result = buildMockFriends();
      for (const friend of result.friends) {
        expect(friend).toHaveProperty("id");
        expect(friend).toHaveProperty("displayName");
        expect(friend).toHaveProperty("status");
        expect(friend.id).toMatch(/^usr_/);
      }
    });
  });
});
