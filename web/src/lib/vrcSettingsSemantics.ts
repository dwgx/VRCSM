/**
 * Semantic editor metadata for the VRChat registry settings exposed by
 * VrcSettings.cpp. The raw storage is just int / float / string / bool
 * blobs — this table tells the Settings UI "VRC_SELECTED_NETWORK_REGION
 * is a dropdown with five options", "FIELD_OF_VIEW is a 40..120 slider
 * in degrees", and so on.
 *
 * Philosophy — only list keys we're confident about. A wrong range on
 * VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE can put a user's avatars in a bad
 * state; when in doubt, we leave the key off the map and fall through
 * to the raw Number/Text/Toggle editor that has always been there.
 *
 * Coverage target is "the 30-ish settings a user most often wants to
 * flip without booting VRChat". It is NOT a replacement for the raw
 * editors — those still handle every key that VRChat writes.
 *
 * Guardrail — the `kind` must match the underlying VrcSettingType the
 * C++ side produces for the key. Settings.tsx verifies this at render
 * time and silently falls back to the raw editor on mismatch, so a
 * wrong `kind` here is a display regression, not data corruption.
 */
export type SemanticEditor =
  | {
      kind: "slider-float";
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      kind: "slider-int";
      min: number;
      max: number;
      step?: number;
      unit?: string;
    }
  | {
      kind: "dropdown-int";
      options: Array<{ value: number; label: string }>;
    }
  | {
      kind: "dropdown-string";
      options: Array<{ value: string; label: string }>;
    };

export interface SemanticEntry {
  editor: SemanticEditor;
}

// ─── Region list ──────────────────────────────────────────────────
// VRChat's public region codes. Used for both selected-region and
// home-region so keep them in one place.
const REGION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "us", label: "US West" },
  { value: "use", label: "US East" },
  { value: "usx", label: "US Central" },
  { value: "eu", label: "Europe" },
  { value: "jp", label: "Japan" },
];

export const VRC_SETTINGS_SEMANTICS: Record<string, SemanticEntry> = {
  // ─── Audio volumes (0.0..1.0) ───────────────────────────────────
  AUDIO_MASTER_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  AUDIO_GAME_VOICE_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  AUDIO_GAME_AVATARS_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  AUDIO_GAME_SFX_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  AUDIO_GAME_PROPS_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  AUDIO_UI_STEAMAUDIO: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  VRC_MIC_TOGGLE_VOLUME: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  VRC_HUD_MIC_OPACITY: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  VRC_CHAT_BUBBLE_AUDIO_VOLUME: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },

  // ─── Graphics ───────────────────────────────────────────────────
  FIELD_OF_VIEW: {
    editor: { kind: "slider-float", min: 40, max: 120, step: 1, unit: "°" },
  },
  FPSCapType: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Uncapped" },
        { value: 1, label: "Custom (see FPS_LIMIT)" },
      ],
    },
  },
  FPS_LIMIT: {
    editor: { kind: "slider-int", min: 30, max: 240, step: 5, unit: "fps" },
  },
  UnityGraphicsQuality: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Very Low" },
        { value: 1, label: "Low" },
        { value: 2, label: "Medium" },
        { value: 3, label: "High" },
        { value: 4, label: "Very High" },
        { value: 5, label: "Ultra" },
      ],
    },
  },
  SHADOW_QUALITY: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Off" },
        { value: 1, label: "Hard only" },
        { value: 2, label: "Soft (Low)" },
        { value: 3, label: "Soft (High)" },
      ],
    },
  },
  LOD_QUALITY: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Low" },
        { value: 1, label: "Medium" },
        { value: 2, label: "High" },
        { value: 3, label: "Very High" },
      ],
    },
  },
  PIXEL_LIGHT_COUNT: {
    editor: { kind: "slider-int", min: 0, max: 8, step: 1 },
  },
  PARTICLE_PHYSICS_QUALITY: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Disabled" },
        { value: 1, label: "Low" },
        { value: 2, label: "Medium" },
        { value: 3, label: "High" },
        { value: 4, label: "Very High" },
      ],
    },
  },
  VRC_ADVANCED_GRAPHICS_ANTIALIASING: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Off" },
        { value: 2, label: "2× MSAA" },
        { value: 4, label: "4× MSAA" },
        { value: 8, label: "8× MSAA" },
      ],
    },
  },
  VRC_MIRROR_RESOLUTION: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 512, label: "512" },
        { value: 1024, label: "1024" },
        { value: 2048, label: "2048" },
        { value: 4096, label: "4096" },
      ],
    },
  },
  VRC_SCREEN_BRIGHTNESS: {
    editor: { kind: "slider-float", min: 0, max: 2, step: 0.05 },
  },
  VRC_SCREEN_CONTRAST: {
    editor: { kind: "slider-float", min: 0, max: 2, step: 0.05 },
  },
  VRC_BLOOM_INTENSITY: {
    editor: { kind: "slider-float", min: 0, max: 2, step: 0.05 },
  },
  VRC_CAMERA_THIRD_PERSON_VIEW_DISTANCE: {
    editor: { kind: "slider-float", min: 1, max: 10, step: 0.1, unit: "m" },
  },
  VRC_LANDSCAPE_FOV: {
    editor: { kind: "slider-float", min: 40, max: 120, step: 1, unit: "°" },
  },
  VRC_PORTRAIT_FOV: {
    editor: { kind: "slider-float", min: 40, max: 120, step: 1, unit: "°" },
  },

  // ─── Network ────────────────────────────────────────────────────
  VRC_SELECTED_NETWORK_REGION: {
    editor: { kind: "dropdown-string", options: REGION_OPTIONS },
  },
  VRC_HOME_REGION: {
    editor: { kind: "dropdown-string", options: REGION_OPTIONS },
  },

  // ─── Avatar safety / display ────────────────────────────────────
  VRC_SAFETY_LEVEL: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Safe" },
        { value: 1, label: "Trusted" },
        { value: 2, label: "Known" },
        { value: 3, label: "Untrusted" },
        { value: 4, label: "None (show all)" },
      ],
    },
  },
  VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY: {
    editor: {
      kind: "dropdown-int",
      options: [
        { value: 0, label: "Excellent only" },
        { value: 1, label: "Good and above" },
        { value: 2, label: "Medium and above" },
        { value: 3, label: "Poor and above" },
        { value: 4, label: "Very Poor and above" },
        { value: 5, label: "Show all" },
      ],
    },
  },

  // ─── Input ──────────────────────────────────────────────────────
  VRC_MOUSE_SENSITIVITY: {
    editor: { kind: "slider-float", min: 0.1, max: 10, step: 0.1 },
  },
  VRC_TOUCH_SENSITIVITY: {
    editor: { kind: "slider-float", min: 0.1, max: 10, step: 0.1 },
  },
  VRC_FINGER_HAPTIC_STRENGTH: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  VRC_FINGER_HAPTIC_SENSITIVITY: {
    editor: { kind: "slider-float", min: 0, max: 1, step: 0.01 },
  },
  VRC_TOUCH_AUTO_ROTATE_SPEED: {
    editor: { kind: "slider-float", min: 0, max: 5, step: 0.1 },
  },

  // ─── Comfort ────────────────────────────────────────────────────
  PlayerHeight: {
    editor: { kind: "slider-float", min: 0.3, max: 2.2, step: 0.01, unit: "m" },
  },
};

/**
 * Look up a semantic entry by key. Returns `undefined` when the key
 * is not in the curated table — callers should fall back to the raw
 * editor in that case.
 */
export function getSemantic(key: string): SemanticEntry | undefined {
  return VRC_SETTINGS_SEMANTICS[key];
}
