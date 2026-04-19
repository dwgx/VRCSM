/**
 * Mock data builders for the IPC dev-mode shim.
 *
 * Extracted from ipc.ts so the production IpcClient class stays lean.
 * These functions are only called when `window.chrome?.webview` is absent
 * (i.e. `pnpm dev` in a normal browser, not inside WebView2).
 */

import type {
  FavoriteItem,
  FavoriteListSummary,
  Friend,
  FriendsListResult,
  Report,
  VrcSettingsReport,
  VrcSettingValueSnapshot,
} from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

// ── Favorites mock state ──────────────────────────────────────────────

export const mockFavorites: FavoriteItem[] = [
  {
    type: "world",
    target_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    list_name: "Library",
    display_name: "Mock World A",
    thumbnail_url: "https://picsum.photos/seed/mock-world-a/512/288",
    added_at: "2026-04-16T13:20:00Z",
    sort_order: 0,
    tags: ["scenic", "sleep"],
    note: "Good ambient world for screenshot sessions and low-key late-night chill.",
    note_updated_at: "2026-04-16T14:00:00Z",
  },
  {
    type: "avatar",
    target_id: "avtr_99999999-8888-7777-6666-555555555555",
    list_name: "Library",
    display_name: "Mock Avatar",
    thumbnail_url: null,
    added_at: "2026-04-17T08:40:00Z",
    sort_order: 0,
    tags: ["meme", "flashy"],
    note: null,
    note_updated_at: null,
  },
];

// ── Favorites helpers ─────────────────────────────────────────────────

export function buildFavoriteLists(items: FavoriteItem[]): FavoriteListSummary[] {
  const map = new Map<string, FavoriteListSummary>();
  for (const item of items) {
    const key = `${item.list_name}::${item.type ?? ""}`;
    const row = map.get(key);
    if (row) {
      row.item_count += 1;
      if ((item.added_at ?? "") > (row.latest_added_at ?? "")) {
        row.latest_added_at = item.added_at;
      }
      continue;
    }
    map.set(key, {
      list_name: item.list_name,
      name: item.list_name,
      type: item.type,
      item_count: 1,
      latest_added_at: item.added_at,
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.latest_added_at ?? "").localeCompare(a.latest_added_at ?? ""),
  );
}

export function buildMockFavoriteLists(): FavoriteListSummary[] {
  return buildFavoriteLists(mockFavorites);
}

export function sortFavoriteItems(items: FavoriteItem[]): FavoriteItem[] {
  return [...items].sort((a, b) =>
    a.sort_order !== b.sort_order
      ? a.sort_order - b.sort_order
      : (a.added_at ?? "").localeCompare(b.added_at ?? ""),
  );
}

// ── Report mock ───────────────────────────────────────────────────────

export function buildMockReport(): Report {
  const entries = Array.from({ length: 32 }).map(() => {
    const bytes = Math.floor(20_000_000 + Math.random() * 380_000_000);
    return {
      entry: Math.floor(0xa0000000 + Math.random() * 0x5fffffff)
        .toString(16)
        .toUpperCase()
        .padStart(16, "0"),
      path: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat/Cache-WindowsPlayer/MOCK",
      bytes,
      bytes_human: `${(bytes / 1024 / 1024).toFixed(2)} MiB`,
      file_count: 2,
      latest_mtime: nowIso(),
      oldest_mtime: nowIso(),
      bundle_format: "UnityFS",
      info_url: "",
    };
  });
  entries.sort((a, b) => b.bytes - a.bytes);
  const total = entries.reduce((s, e) => s + e.bytes, 0);
  return {
    generated_at: nowIso(),
    base_dir: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat (mock)",
    category_summaries: [
      {
        key: "cache_windows_player",
        name: "Cache-WindowsPlayer",
        kind: "dir",
        logical_path: "Cache-WindowsPlayer",
        exists: true,
        lexists: true,
        is_dir: true,
        is_file: false,
        resolved_path: "C:/.../Cache-WindowsPlayer",
        bytes: total,
        bytes_human: `${(total / 1024 / 1024 / 1024).toFixed(2)} GiB`,
        file_count: entries.length * 2,
        latest_mtime: nowIso(),
        oldest_mtime: nowIso(),
      },
      {
        key: "http_cache",
        name: "HTTPCache-WindowsPlayer",
        kind: "dir",
        logical_path: "HTTPCache-WindowsPlayer",
        exists: false,
        lexists: true,
        is_dir: false,
        is_file: false,
        resolved_path: "D:/VRChatCache/HTTPCache-WindowsPlayer (broken)",
        bytes: 0,
        bytes_human: "0 B",
        file_count: 0,
        latest_mtime: null,
        oldest_mtime: null,
      },
      {
        key: "avatars",
        name: "Avatars",
        kind: "dir",
        logical_path: "Avatars",
        exists: true,
        lexists: true,
        is_dir: true,
        is_file: false,
        resolved_path: "C:/.../Avatars",
        bytes: 412_000_000,
        bytes_human: "392.91 MiB",
        file_count: 184,
        latest_mtime: nowIso(),
        oldest_mtime: nowIso(),
      },
    ],
    total_bytes: total + 412_000_000,
    total_bytes_human: `${((total + 412_000_000) / 1024 / 1024 / 1024).toFixed(2)} GiB`,
    existing_category_count: 9,
    broken_links: [
      {
        category: "http_cache",
        logical_path: "HTTPCache-WindowsPlayer",
        source_path: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat/HTTPCache-WindowsPlayer",
        resolved_path: "D:/VRChatCache/HTTPCache-WindowsPlayer",
        target_path: "D:/VRChatCache/HTTPCache-WindowsPlayer",
        target: "D:/VRChatCache/HTTPCache-WindowsPlayer",
        reason: "junction target missing",
      },
      {
        category: "texture_cache",
        logical_path: "TextureCache-WindowsPlayer",
        source_path: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat/TextureCache-WindowsPlayer",
        resolved_path: "D:/VRChatCache/TextureCache-WindowsPlayer",
        target_path: "D:/VRChatCache/TextureCache-WindowsPlayer",
        target: "D:/VRChatCache/TextureCache-WindowsPlayer",
        reason: "junction target missing",
      },
    ],
    cache_windows_player: {
      entry_count: entries.length,
      entries,
      largest_entries: entries.slice(0, 8),
    },
    local_avatar_data: {
      item_count: 6,
      recent_items: Array.from({ length: 6 }).map((_, i) => ({
        user_id: `usr_mock_${i}`,
        avatar_id: `avtr_mock_${i}`,
        path: `LocalAvatarData/usr_mock_${i}/avtr_mock_${i}`,
        eye_height: 1.6 + i * 0.02,
        parameter_count: 24 + i,
        modified_at: nowIso(),
      })),
      parameter_count_histogram: { "0-15": 1, "16-31": 4, "32+": 1 },
    },
    logs: {
      log_files: ["output_log_2026-04-14_17-30-00.txt"],
      log_count: 1,
      settings: {
        cache_directory: "default",
        cache_size_mb: 20480,
        clear_cache_on_start: false,
      },
      environment: {
        vrchat_build: "2026.2.2p3-1621--Release",
        store: "Steam",
        platform: "Windows",
        device_model: "MOCK-PC",
        processor: "AMD Ryzen 9 (Mock)",
        system_memory: "32678 MB",
        operating_system: "Windows 11 Pro (Mock)",
        gpu_name: "NVIDIA RTX 4080 (Mock)",
        gpu_api: "Direct3D 11",
        gpu_memory: "16384 MB",
        xr_device: null,
      },
      settings_sections: [
        {
          name: "General Settings",
          entries: [
            ["Cache Directory", "default"],
            ["Cache Size (MB)", "20480"],
            ["Clear Cache On Start", "False"],
          ],
        },
        {
          name: "Graphics Settings",
          entries: [
            ["Quality Level", "Ultra"],
            ["Target Frame Rate", "90"],
          ],
        },
      ],
      local_user_name: "mock_user",
      local_user_id: "usr_mock-1234-5678",
      recent_world_ids: [
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "wrld_11111111-2222-3333-4444-555555555555",
      ],
      recent_avatar_ids: ["avtr_99999999-8888-7777-6666-555555555555"],
      avatar_names: {
        "avtr_99999999-8888-7777-6666-555555555555": {
          name: "Mock Avatar",
          author: "VRCSM",
        },
      },
      world_names: {
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "Mock World A",
        "wrld_11111111-2222-3333-4444-555555555555": "Mock World B",
      },
      world_event_count: 12,
      avatar_event_count: 5,
      player_events: [
        { kind: "joined", iso_time: "2026.04.15 00:42:02", display_name: "mock_user", user_id: "usr_mock-1234-5678" },
        { kind: "left", iso_time: "2026.04.15 00:58:11", display_name: "mock_user", user_id: "usr_mock-1234-5678" },
      ],
      avatar_switches: [
        { iso_time: "2026.04.15 00:42:01", actor: "mock_user", avatar_name: "Mock Avatar" },
      ],
      screenshots: [
        { iso_time: "2026.04.15 02:18:44", path: "C:\\Users\\mock\\Pictures\\VRChat\\2026-04\\VRChat_2026-04-15_02-18-44.439_1920x1080.png" },
      ],
      world_switches: [
        {
          iso_time: "2026.04.15 00:41:48",
          world_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          instance_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_mock-1234-5678)~region(jp)",
          access_type: "hidden",
          owner_id: "usr_mock-1234-5678",
          region: "jp"
        },
        {
          iso_time: "2026.04.15 01:10:22",
          world_id: "wrld_11111111-2222-3333-4444-555555555555",
          instance_id: "wrld_11111111-2222-3333-4444-555555555555:9999~public~region(us)",
          access_type: "public",
          owner_id: null,
          region: "us"
        }
      ],
    },
  };
}

// ── Settings mock ─────────────────────────────────────────────────────

export function buildMockSettingsReport(): VrcSettingsReport {
  const mk = (
    key: string,
    group: string,
    description: string,
    value: VrcSettingValueSnapshot,
  ) => ({
    encodedKey: `${key}_h123456`,
    key,
    group,
    description,
    ...value,
  });

  const entries = [
    mk("VRC_INPUT_MIC_ENABLED", "audio", "Microphone enabled on launch", {
      type: "bool",
      boolValue: true,
    }),
    mk("VRC_VOICE_VOLUME", "audio", "Voice mix level (0.0–1.0)", {
      type: "float",
      floatValue: 0.85,
    }),
    mk("VRC_WORLD_VOLUME", "audio", "World sound mix level", {
      type: "float",
      floatValue: 0.7,
    }),
    mk("VRC_GRAPHICS_QUALITY", "graphics", "Unity quality preset (0–5)", {
      type: "int",
      intValue: 3,
    }),
    mk(
      "VRC_TARGET_FPS",
      "graphics",
      "Target frame rate when not VR (-1 = uncapped)",
      { type: "int", intValue: 90 },
    ),
    mk("VRC_PERFORMANCE_UI", "graphics", "Show FPS / perf overlay", {
      type: "bool",
      boolValue: false,
    }),
    mk(
      "VRC_NETWORK_DOWNLOAD_LIMIT",
      "network",
      "Concurrent asset downloads cap",
      { type: "int", intValue: 4 },
    ),
    mk(
      "VRC_ALLOW_UNTRUSTED_URL",
      "network",
      "Allow video players to load untrusted URLs",
      { type: "bool", boolValue: false },
    ),
    mk(
      "VRC_AVATAR_HIDE_UNKNOWN",
      "avatars",
      "Default: hide avatars from users outside your friends list",
      { type: "bool", boolValue: false },
    ),
    mk(
      "VRC_AVATAR_MAX_DOWNLOAD_MB",
      "avatars",
      "Largest avatar bundle to auto-download",
      { type: "int", intValue: 200 },
    ),
    mk("VRC_OSC_ENABLED", "osc", "Expose OSC endpoints on launch", {
      type: "bool",
      boolValue: false,
    }),
    mk("VRC_OSC_IN_PORT", "osc", "Incoming OSC UDP port", {
      type: "int",
      intValue: 9000,
    }),
    mk("VRC_OSC_OUT_PORT", "osc", "Outgoing OSC UDP port", {
      type: "int",
      intValue: 9001,
    }),
  ];

  const groups: Record<string, number[]> = {
    audio: [],
    graphics: [],
    network: [],
    avatars: [],
    osc: [],
    comfort: [],
    ui: [],
    privacy: [],
    other: [],
  };
  entries.forEach((entry, index) => {
    const bucket = groups[entry.group];
    if (bucket) bucket.push(index);
    else groups.other.push(index);
  });

  return { entries, count: entries.length, groups };
}

// ── Friends mock ──────────────────────────────────────────────────────

export function buildMockFriends(): FriendsListResult {
  const mockAvatarNames = [
    "Taihou", "Manuka", "Selestia", "Karin", null,
    "Wolferia", null, "Lime", "Rindo", null, "Shinra", "Leefa",
  ];
  const friends: Friend[] = Array.from({ length: 12 }).map((_, i) => ({
    id: `usr_mock_friend_${i.toString().padStart(3, "0")}`,
    username: `friend_${i}`,
    displayName: `Mock Friend ${i + 1}`,
    currentAvatarImageUrl: null,
    currentAvatarThumbnailImageUrl: i % 3 === 0 ? `https://picsum.photos/seed/avtr${i}/128/128` : null,
    currentAvatarName: mockAvatarNames[i] ?? null,
    statusDescription: i % 3 === 0 ? "In a world" : null,
    status: i % 4 === 0 ? "busy" : i % 4 === 1 ? "join me" : "active",
    location: i % 3 === 0 ? `wrld_aaaabbbb-cccc-dddd-eeee-${i.toString().padStart(12, "0")}:12345~hidden(usr_owner)~region(jp)` : "offline",
    last_platform: i % 2 === 0 ? "standalonewindows" : "android",
    bio: i % 5 === 0 ? "Mock bio for dev mode" : null,
    developerType: null,
    last_login: null,
    last_activity: null,
    profilePicOverride: null,
    userIcon: null,
    tags:
      i % 6 === 0
        ? ["system_trust_trusted"]
        : i % 6 === 1
          ? ["system_trust_known"]
          : i % 6 === 2
            ? ["system_trust_basic"]
            : [],
  }));
  return { friends };
}
