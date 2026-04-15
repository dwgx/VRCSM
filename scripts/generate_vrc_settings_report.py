from __future__ import annotations

import math
import re
import struct
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(r"D:\Project\VRCSM")
SRC_ROOT = Path(r"D:\WorkSpace\VRChat\VRChat_Data\il2cpp_dump_tools\output\src")
DOC_PATH = ROOT / "docs" / "vrc-settings-keys.md"
REG_PATH = r"HKCU\Software\VRChat\VRChat"

SECTION_ORDER = ["Audio", "Graphics", "Network", "Avatars", "Comfort", "Input", "UI", "Privacy", "Other"]

STOP_TOKENS = {
    "vrc", "ui", "usr", "current", "enabled", "mode", "value", "selection", "type",
    "show", "use", "set", "get", "and", "the", "menu", "settings", "setting", "quick",
}

BOOL_HINTS = (
    "enabled", "visible", "show", "allow", "hide", "locked", "muted", "toggle", "use_",
    "use", "has", "can", "is_", "should", "confirm", "simulate", "display", "play",
    "opened", "randomize", "follow", "lock", "grabbable", "immersive", "reduce",
)

FLOAT_HINTS = (
    "volume", "opacity", "scale", "zoom", "posx", "posy", "position", "offset",
    "sensitivity", "ratio", "intensity", "brightness", "contrast", "tilt", "angle",
    "distance", "height", "width_compensation", "range", "near_clip", "cone",
    "throttle", "rate", "mass", "drag", "area", "power", "fov", "field_of_view",
    "dpi_scaling",
)

INT_HINT_EXCLUSIONS = {
    "fps_limit", "pixel_light_count", "resolution", "width", "height", "port", "quality",
    "count", "region", "anchor", "variant", "format", "type", "level", "size", "number",
    "preset", "category", "sort", "access",
}

MANUAL_MEANINGS = {
    "VRC_INPUT_MIC_ENABLED": "Master microphone enable toggle.",
    "VRC_INPUT_MIC_LEVEL_DESK": "Desktop microphone input gain / level.",
    "VRC_INPUT_MIC_NOISE_GATE": "Microphone noise gate threshold.",
    "VRC_INPUT_TALK_TOGGLE": "Push-to-talk versus toggle-talk behavior.",
    "VRC_INPUT_TALK_DEFAULT_ON": "Default mic state when entering a session.",
    "VRC_INPUT_DISABLE_MIC_BUTTON": "Disables the in-game mic toggle button.",
    "UnityGraphicsQuality": "Preset graphics quality tier.",
    "VRC_ADVANCED_GRAPHICS_QUALITY": "Advanced graphics quality preset label.",
    "VRC_ADVANCED_GRAPHICS_ANTIALIASING": "Anti-aliasing sample count / preset.",
    "LOD_QUALITY": "Level-of-detail quality preset.",
    "PARTICLE_PHYSICS_QUALITY": "Particle physics quality preset.",
    "SHADOW_QUALITY": "Shadow quality preset.",
    "PIXEL_LIGHT_COUNT": "Maximum real-time pixel lights.",
    "FIELD_OF_VIEW": "Desktop field of view override or slider value.",
    "VRC_LANDSCAPE_FOV": "Mobile landscape field of view.",
    "VRC_PORTRAIT_FOV": "Mobile portrait field of view.",
    "FPS_LIMIT": "Custom frame-rate cap.",
    "FPSCapType": "Frame-rate cap mode selector.",
    "FPSType": "FPS display or FPS-mode selector.",
    "VRC_SAFETY_LEVEL": "Global avatar safety level preset.",
    "VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY": "Minimum avatar performance rank still shown without fallback hiding.",
    "VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE": "Maximum compressed avatar download size allowed.",
    "VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE": "Maximum uncompressed avatar size allowed.",
    "VRC_AVATAR_FALLBACK_HIDDEN": "Hide fallback avatars instead of showing them.",
    "VRC_SELECTED_NETWORK_REGION": "Preferred / selected Photon region.",
    "BestRegionCache": "Whether to cache and reuse the best-region choice.",
    "VRC_HOME_REGION": "Region used for home-world placement.",
    "VRC_HOME_ACCESS_TYPE": "Home-world access / privacy preset.",
    "VRC_NAMEPLATE_MODE": "Primary nameplate display mode.",
    "VRC_NAMEPLATE_STATUS_MODE": "Extra status line content shown on nameplates.",
    "VRC_NAMEPLATE_SCALE_V2": "Nameplate scale multiplier.",
    "VRC_NAMEPLATE_OPACITY": "Nameplate opacity multiplier.",
    "VRC_HUD_MODE": "HUD layout / visibility mode.",
    "VRC_HUD_ANCHOR": "HUD anchor position selector.",
    "VRC_HUD_OPACITY": "HUD opacity multiplier.",
    "VRC_HUD_MIC_OPACITY": "Mic HUD opacity multiplier.",
    "VRC_SHOW_JOIN_NOTIFICATIONS": "Show friend join notifications.",
    "VRC_SHOW_LEAVE_NOTIFICATIONS": "Show friend leave notifications.",
    "VRC_SHOW_PORTAL_NOTIFICATIONS": "Show portal notifications.",
    "VRC_ONLY_SHOW_FRIEND_JOIN_LEAVE_PORTAL_NOTIFICATIONS": "Restrict join/leave/portal notifications to friends.",
    "VRC_SHOW_INVITES_NOTIFICATION": "Show invite notifications.",
    "VRC_SHOW_FRIEND_REQUESTS": "Show friend-request notifications.",
    "VRC_PLAY_NOTIFICATION_AUDIO": "Play notification sound effects.",
    "AUDIO_MASTER_STEAMAUDIO": "Master output volume.",
    "AUDIO_UI_STEAMAUDIO": "UI sound volume.",
    "AUDIO_GAME_SFX_STEAMAUDIO": "World/game SFX volume.",
    "AUDIO_GAME_VOICE_STEAMAUDIO": "Voice chat volume.",
    "AUDIO_GAME_AVATARS_STEAMAUDIO": "Avatar audio volume.",
    "AUDIO_GAME_PROPS_STEAMAUDIO": "Prop / object audio volume.",
    "AUDIO_MASTER_ENABLED": "Master audio mute toggle.",
    "AUDIO_UI_ENABLED": "UI sound mute toggle.",
    "AUDIO_GAME_SFX_ENABLED": "World/game SFX mute toggle.",
    "AUDIO_GAME_VOICE_ENABLED": "Voice chat mute toggle.",
    "AUDIO_GAME_AVATARS_ENABLED": "Avatar audio mute toggle.",
    "AUDIO_GAME_PROPS_ENABLED": "Prop / object audio mute toggle.",
    "VRC_USE_COLOR_FILTER": "Enable color filter accessibility pass.",
    "VRC_COLOR_FILTER_TO_WORLD": "Apply color filter to the rendered world, not just UI.",
    "VRC_COLOR_BLINDNESS_SIMULATE": "Simulate selected color blindness profile.",
    "VRC_COLOR_FILTER_SELECTION": "Selected color filter preset.",
    "VRC_COLOR_FILTER_INTENSITY": "Color filter strength.",
    "VRC_SCREEN_BRIGHTNESS": "Screen brightness adjustment.",
    "VRC_SCREEN_CONTRAST": "Screen contrast adjustment.",
    "VRC_REDUCE_ANIMATIONS": "Reduce nonessential UI / world animations.",
    "VRC_BLOOM_INTENSITY": "Bloom intensity override.",
    "VRC_ALLOW_UNTRUSTED_URL": "Allow opening untrusted URLs.",
    "BACKGROUND_DEBUG_LOG_COLLECTION": "Background debug log collection toggle.",
    "VRC_ALLOW_DISCORD_FRIENDS": "Allow Discord friends integration.",
    "VRC_HIDE_NOTIFICATION_PHOTOS": "Hide image previews in notifications.",
    "VRC_CURRENT_LANGUAGE": "Selected application language code.",
    "VRC_CLEAR_CACHE_ON_START": "Clear content cache at startup.",
    "PersonalMirror.ShowFaceMirror": "Show personal face mirror in VR.",
    "PersonalMirror.ShowFaceMirrorDesktop": "Show personal face mirror on desktop.",
    "PersonalMirror.FaceMirrorOpacity": "Face mirror opacity in VR.",
    "PersonalMirror.FaceMirrorOpacityDesktop": "Face mirror opacity on desktop.",
    "PersonalMirror.FaceMirrorScale": "Face mirror scale in VR.",
    "PersonalMirror.FaceMirrorScaleDesktop": "Face mirror scale on desktop.",
    "PersonalMirror.FaceMirrorPosX": "Face mirror X offset in VR.",
    "PersonalMirror.FaceMirrorPosY": "Face mirror Y offset in VR.",
    "PersonalMirror.FaceMirrorPosXDesktop": "Face mirror X offset on desktop.",
    "PersonalMirror.FaceMirrorPosYDesktop": "Face mirror Y offset on desktop.",
    "PersonalMirror.FaceMirrorZoom": "Face mirror zoom in VR.",
    "PersonalMirror.FaceMirrorZoomDesktop": "Face mirror zoom on desktop.",
    "PersonalMirror.ShowRemotePlayerInMirror": "Include remote players in the personal mirror.",
    "PersonalMirror.ShowEnvironmentInMirror": "Include environment in the personal mirror.",
    "PersonalMirror.ShowUIInMirror": "Include UI in the personal mirror.",
    "PersonalMirror.MirrorOpacity": "Personal mirror opacity.",
    "PersonalMirror.MirrorScaleX": "Personal mirror X scale.",
    "PersonalMirror.MirrorScaleY": "Personal mirror Y scale.",
    "PersonalMirror.MovementMode": "Personal mirror movement / attachment mode.",
    "PersonalMirror.Grabbable": "Whether the personal mirror can be grabbed.",
    "PersonalMirror.ImmersiveMove": "Immersive movement mode for the personal mirror.",
    "PersonalMirror.MirrorSnapping": "Mirror snap behavior.",
    "VRC_IK_FBT_LOCOMOTION": "Full-body-tracking locomotion toggle.",
    "VRC_IK_USE_METRIC_HEIGHT": "Use metric units for body calibration height.",
    "VRC_IK_LEGACY_CALIBRATION": "Legacy full-body calibration path.",
    "VRC_IK_ONE_HANDED_CALIBRATION": "One-handed calibration flow toggle.",
    "VRC_IK_DISABLE_SHOULDER_TRACKING": "Disable shoulder tracking contribution.",
    "VRC_IK_FREEZE_TRACKING_ON_DISCONNECT": "Freeze FBT pose when trackers disconnect.",
    "VRC_IK_SHOULDER_WIDTH_COMPENSATION": "Shoulder-width compensation toggle.",
    "VRC_TRACKING_SELFIE_FACE_TRACKING_QUALITY_LEVEL": "Selfie face tracking quality preset.",
    "UI.Settings.Osc": "OSC settings landing / feature toggle state.",
    "VRC_INPUT_OSC": "OSC input/output enabled.",
    "VRC_TRACKING_SEND_VR_SYSTEM_HEAD_AND_WRIST_OSC_DATA": "Send headset/wrist tracking over OSC.",
    "VRC_TRACKING_SHOULD_SHOW_OSC_TRACKING_DATA_REMINDER": "Show OSC tracking data reminder prompt.",
}

MANUAL_VALUES = {
    "VRC_SAFETY_LEVEL": "Observed `2`; enum-backed safety preset.",
    "UnityGraphicsQuality": "Observed `2`; paired label currently `High`.",
    "VRC_ADVANCED_GRAPHICS_QUALITY": "Observed `High`.",
    "VRC_ADVANCED_GRAPHICS_ANTIALIASING": "Observed `4`; likely MSAA sample count / AA preset.",
    "VRC_SELECTED_NETWORK_REGION": "Observed `0`; likely `Auto/Best` region selection.",
    "VRC_HOME_REGION": "Observed `1`; small integer region enum.",
    "VRC_HOME_ACCESS_TYPE": "Observed `3`; small integer home privacy enum.",
    "FPS_LIMIT": "Observed `310`.",
    "VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY": "Observed `5`; likely avatar performance enum threshold.",
    "VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE": "Observed `209715200` bytes (200 MiB).",
    "VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE": "Observed `524288000` bytes (500 MiB).",
}

TOP_30_KEYS = [
    ("AUDIO_MASTER_STEAMAUDIO", "Master volume."),
    ("AUDIO_GAME_VOICE_STEAMAUDIO", "Voice chat volume."),
    ("AUDIO_GAME_SFX_STEAMAUDIO", "World SFX volume."),
    ("AUDIO_GAME_AVATARS_STEAMAUDIO", "Avatar audio volume."),
    ("AUDIO_MASTER_ENABLED", "Fast mute/unmute."),
    ("VRC_INPUT_MIC_ENABLED", "Mic master toggle."),
    ("VRC_INPUT_MIC_LEVEL_DESK", "Mic gain."),
    ("VRC_INPUT_MIC_NOISE_GATE", "Mic noise gate."),
    ("VRC_INPUT_TALK_TOGGLE", "Push-to-talk vs toggle."),
    ("UnityGraphicsQuality", "One-click quality preset."),
    ("VRC_ADVANCED_GRAPHICS_ANTIALIASING", "AA quality."),
    ("SHADOW_QUALITY", "Shadow quality."),
    ("LOD_QUALITY", "LOD quality."),
    ("FPS_LIMIT", "Custom frame cap."),
    ("FIELD_OF_VIEW", "Desktop FOV."),
    ("VRC_SELECTED_NETWORK_REGION", "Preferred region."),
    ("BestRegionCache", "Auto-region cache behavior."),
    ("VRC_SAFETY_LEVEL", "Global safety level."),
    ("VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY", "Performance visibility floor."),
    ("VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE", "Avatar download size cap."),
    ("VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE", "Avatar uncompressed size cap."),
    ("VRC_AVATAR_FALLBACK_HIDDEN", "Hide fallback avatars."),
    ("VRC_NAMEPLATE_MODE", "Nameplate mode."),
    ("VRC_NAMEPLATE_OPACITY", "Nameplate opacity."),
    ("VRC_HUD_MODE", "HUD mode."),
    ("VRC_HUD_OPACITY", "HUD opacity."),
    ("VRC_SHOW_JOIN_NOTIFICATIONS", "Join notifications."),
    ("VRC_USE_COLOR_FILTER", "Accessibility filter toggle."),
    ("VRC_COLOR_FILTER_SELECTION", "Accessibility filter preset."),
    ("PersonalMirror.ShowFaceMirror", "Personal face mirror toggle."),
]

LIVE_PATTERNS = [
    ("Audio", re.compile(r"^(AUDIO_|VRC_INPUT_MIC_|VRC_MIC_|VRC_EARMUFF_|VRC_PLAY_NOTIFICATION_AUDIO|VRC_INPUT_TALK_)")),
    ("HUD / UI", re.compile(r"^(VRC_HUD_|VRC_NAMEPLATE_|VRC_SHOW_|VRC_ONLY_SHOW_|VRC_TIME_FORMAT_|VRC_CLOCK_VARIANT|VRC_USE_COLOR_FILTER|VRC_COLOR_|VRC_SCREEN_|VRC_REDUCE_ANIMATIONS|VRC_BLOOM_INTENSITY)")),
    ("Avatar safety / visibility", re.compile(r"^(VRC_SAFETY_LEVEL|VRC_AVATAR_|avatarProxy|currentShowMaxNumberOfAvatarsEnabled|VRC_SHOW_SOCIAL_RANK|VRC_AV_INTERACT_)")),
    ("Comfort / tracking", re.compile(r"^(VRC_COMFORT_|SeatedPlayEnabled|VRC_IK_|VRC_TRACKING_|PersonalMirror\\.|VRC_ACTION_MENU_|VRC_FINGER_|VRC_UI_HAPTICS_|VRC_INTERACT_HAPTICS_|VRC_AVATAR_HAPTICS_)")),
    ("Frame pacing / camera", re.compile(r"^(FPS_LIMIT|FPSCapType|FPSType|FIELD_OF_VIEW|VRC_LANDSCAPE_FOV|VRC_PORTRAIT_FOV)")),
]

STARTUP_PATTERNS = [
    ("Display bootstrap", re.compile(r"^(Screenmanager |UnitySelectMonitor|Screenmanager|LocationContext)")),
    ("Migration / one-shot flags", re.compile(r"^(ForceSettings_|FOLDOUT_STATES$|migrated-local-pmods-|has_seen_|HasSeen|CosmeticsSectionRedirect_|InQueueWidgetInfoShowcaseID)")),
    ("Opaque auth / install tokens", re.compile(r"^[0-9A-F]{32}$")),
    ("Service / integration bootstrap", re.compile(r"^(unity\\.player_|VRC_CURRENT_LANGUAGE|VRC_MOBILE_NOTIFICATIONS_SERVICE_ENABLED|VRC_ALLOW_DISCORD_FRIENDS|BACKGROUND_DEBUG_LOG_COLLECTION|VRC_CLEAR_CACHE_ON_START)")),
]

RELOAD_PATTERNS = [
    ("Reconnect / relaunch likely", re.compile(r"^(VRC_SELECTED_NETWORK_REGION|BestRegionCache|VRC_HOME_REGION|VRC_HOME_ACCESS_TYPE|VRC_INPUT_OSC|UI\\.Settings\\.Osc|UnityGraphicsQuality|VRC_ADVANCED_GRAPHICS_|LOD_QUALITY|PARTICLE_PHYSICS_QUALITY|SHADOW_QUALITY|PIXEL_LIGHT_COUNT)")),
]


@dataclass
class SourceLine:
    rel_path: str
    line_no: int
    text: str
    tokens: set[str]


def run_reg_query() -> list[dict]:
    cp = subprocess.run(["reg", "query", REG_PATH, "/s"], capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
    entries = []
    for line in cp.stdout.splitlines():
        match = re.match(r"^\s{4,}(.+?)\s+(REG_\w+)\s+(.*)$", line.rstrip())
        if not match:
            continue
        full_name, reg_type, raw_value = match.groups()
        key_name = re.sub(r"_h\d+$", "", full_name)
        entries.append({"full_name": full_name, "key": key_name, "reg_type": reg_type, "raw_value": raw_value.strip()})
    return entries


def tokenize(text: str) -> set[str]:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    return set(t.lower() for t in re.findall(r"[A-Za-z][A-Za-z0-9_]+", text))


def build_source_index() -> tuple[list[SourceLine], dict[str, list[int]]]:
    lines = []
    inverted: dict[str, list[int]] = defaultdict(list)
    for path in SRC_ROOT.rglob("*.cs"):
        rel_path = str(path.relative_to(SRC_ROOT)).replace("\\", "/")
        try:
            content = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for idx, line in enumerate(content, 1):
            tokens = tokenize(line)
            src_line = SourceLine(rel_path, idx, line.strip(), tokens)
            line_id = len(lines)
            lines.append(src_line)
            for token in tokens:
                inverted[token].append(line_id)
    return lines, inverted


def normalize_key_for_matching(key: str) -> str:
    key = re.sub(r"usr_[0-9a-fA-F-]{36}", "userid", key)
    key = re.sub(r"avtr_[0-9a-fA-F-]{36}", "avatarid", key)
    key = re.sub(r"wrld_[0-9a-fA-F-]{36}", "worldid", key)
    key = re.sub(r"grp_[0-9a-fA-F-]{36}", "groupid", key)
    key = re.sub(r"[0-9a-fA-F]{32}", "hexid", key)
    return key


def key_terms(key: str) -> list[str]:
    normalized = normalize_key_for_matching(key)
    parts = re.split(r"[^A-Za-z0-9]+", normalized)
    terms = []
    for part in parts:
        if not part:
            continue
        for token in re.sub(r"([a-z])([A-Z])", r"\1 \2", part).split():
            token = token.lower()
            if len(token) < 3 or token in STOP_TOKENS:
                continue
            terms.append(token)
    unique_terms = []
    seen = set()
    for term in terms:
        if term not in seen:
            unique_terms.append(term)
            seen.add(term)
    return unique_terms[:8]


def infer_section(key: str) -> str:
    k = key.lower()
    if k.startswith("audio_") or "mic" in k or "voice" in k or "earmuff" in k or "talk_" in k:
        return "Audio"
    if any(x in k for x in ["graphics", "screenmanager", "shadow", "lod", "field_of_view", "fov", "fps", "mirror", "bloom", "quality", "pixel_light"]):
        return "Graphics"
    if any(x in k for x in ["region", "bandwidth", "port", "network", "locationcontext", "home_region", "bestregion"]):
        return "Network"
    if any(x in k for x in ["avatar", "safety", "social_rank", "proxy", "impostor", "gesture"]):
        return "Avatars"
    if any(x in k for x in ["comfort", "playspace", "seated", "calibration", "tracking", "ik_", "locomotion", "height_ratio", "shoulder", "wrist", "knee"]):
        return "Comfort"
    if any(x in k for x in ["input_", "osc", "controller", "finger", "hand", "touch", "mouse", "keyboard", "steamvr", "openxr", "daydream", "generic", "gaze", "wave", "embodied", "quest"]):
        return "Input"
    if any(x in k for x in ["hud", "nameplate", "notification", "color_filter", "clock", "time_format", "wing", "foldout", "sortselection", "recently", "emoji", "sticker", "props", "background_material", "menuplacement", "callout", "live_now", "ui."]):
        return "UI"
    if any(x in k for x in ["allow_discord", "allow_untrusted_url", "debug_log", "analytics", "notification_photos", "focus_view"]):
        return "Privacy"
    return "Other"


def decode_reg_binary(hex_string: str) -> bytes:
    hex_string = re.sub(r"[^0-9A-Fa-f]", "", hex_string)
    if len(hex_string) % 2:
        hex_string = hex_string[:-1]
    if not hex_string:
        return b""
    try:
        return bytes.fromhex(hex_string)
    except ValueError:
        return b""


def float_from_dword(text: str) -> float | None:
    match = re.search(r"0x([0-9A-Fa-f]+)", text)
    if not match:
        return None
    value = int(match.group(1), 16) & 0xFFFFFFFF
    try:
        return struct.unpack("<f", struct.pack("<I", value))[0]
    except struct.error:
        return None


def int_from_dword(text: str) -> int | None:
    match = re.search(r"0x([0-9A-Fa-f]+)", text)
    return int(match.group(1), 16) if match else None


def infer_type(entry: dict) -> str:
    key = entry["key"].lower()
    if entry["reg_type"] == "REG_BINARY":
        return "string"
    if key.startswith("forcesettings_"):
        return "int"
    if key.startswith("audio_") and not key.endswith("_enabled"):
        return "float"
    int_value = int_from_dword(entry["raw_value"])
    if int_value in (0, 1) and any(hint in key for hint in BOOL_HINTS):
        return "int (bool)"
    if any(hint in key for hint in FLOAT_HINTS) and not any(exc in key for exc in INT_HINT_EXCLUSIONS):
        return "float"
    float_value = float_from_dword(entry["raw_value"])
    if float_value is not None and math.isfinite(float_value):
        if abs(float_value) <= 1000 and int_value not in range(-1000, 1001):
            if any(hint in key for hint in ("opacity", "scale", "zoom", "intensity", "sensitivity", "brightness", "contrast", "ratio", "offset", "angle", "height", "fov", "volume")):
                return "float"
    return "int"


def preview_value(entry: dict, inferred_type: str) -> str:
    key = entry["key"]
    if key in MANUAL_VALUES:
        return MANUAL_VALUES[key]
    if entry["reg_type"] == "REG_BINARY":
        data = decode_reg_binary(entry["raw_value"]).rstrip(b"\x00")
        if not data:
            return "Empty string / empty blob."
        if data.startswith((b"{", b"[")):
            return f"JSON/string blob; current length {len(data)} bytes."
        if all(32 <= b < 127 for b in data):
            text = data.decode("utf-8", errors="replace")
            if len(text) > 48:
                text = text[:45] + "..."
            return f"Current `{text}`."
        return f"Binary/string blob; current length {len(data)} bytes."
    int_value = int_from_dword(entry["raw_value"])
    if inferred_type == "int (bool)":
        return f"`0/1`; current `{int_value}`."
    if inferred_type == "float":
        value = float_from_dword(entry["raw_value"])
        if value is not None and math.isfinite(value) and (value == 0 or 1e-5 <= abs(value) <= 1e5):
            return f"Current `{value:.4g}`."
        return f"Raw DWORD `{entry['raw_value']}`; non-obvious float encoding."
    return f"Current `{int_value}`."


def humanize_identifier(text: str) -> str:
    text = normalize_key_for_matching(text)
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = text.replace("_", " ").replace(".", " ")
    return re.sub(r"\s+", " ", text).strip() or "Unknown"


def infer_meaning(entry: dict) -> str:
    key = entry["key"]
    lower = key.lower()
    if key in MANUAL_MEANINGS:
        return MANUAL_MEANINGS[key]
    if re.fullmatch(r"[0-9A-F]{32}", key):
        return "Opaque token / encrypted identifier blob; likely auth, install, or migration material."
    if lower.startswith("forcesettings_"):
        return "One-shot migration / compatibility flag used to force a settings migration step."
    if lower.startswith("hasseen") or lower.startswith("has_seen_"):
        return "One-time UI callout / tutorial / promo seen flag."
    if lower.startswith("sortselection_"):
        return "Stored sort option for a specific list or browser page."
    if "recentlyused" in lower or lower.startswith("savedworldsearches") or lower.endswith("_history"):
        return "Persisted recent-history or saved-list UI data."
    if "customgroup" in lower:
        return "Custom emoji / sticker / prop grouping data."
    if lower.startswith("wing_"):
        return "Wing UI selection or sort state."
    if lower.startswith("usr_") or "_usr_" in lower:
        return "Per-user scoped persisted UI or preferences data."
    if lower.startswith("background_material"):
        return "Selected UI background / material choice."
    if lower.startswith("screenmanager"):
        return "Unity display / fullscreen / window state."
    if lower.startswith("unity.player_"):
        return "Unity session telemetry / runtime counter."
    if lower.startswith("personalmirror."):
        return "Personal mirror behavior or transform setting."
    if lower.startswith("vrc_tracking_") or lower.startswith("vrc_ik_"):
        return "Tracking / calibration / FBT setting."
    if lower.startswith("audio_"):
        return "Audio subsystem persisted setting."
    if lower.startswith("vrc_input_"):
        return "Input subsystem persisted setting."
    if lower.startswith("vrc_nameplate_"):
        return "Nameplate presentation setting."
    if lower.startswith("vrc_hud_"):
        return "HUD placement or visibility setting."
    if lower.startswith("vrc_avatar_") or lower.startswith("avatarproxy"):
        return "Avatar visibility / download / fallback setting."
    if lower.startswith("vrc_color_") or lower.startswith("vrc_use_color_filter"):
        return "Accessibility color filter setting."
    if lower.startswith("vrc_home_"):
        return "Home-world placement or privacy setting."
    if lower.startswith("ui."):
        return "UI state or feature preference."
    return humanize_identifier(key) + "."


def class_name_from_line(text: str) -> str | None:
    method = re.search(r"public\s+\w+(?:<[^>]+>)?\s+([A-Za-z0-9_\.]+)\s*\(", text)
    if method:
        return method.group(1)
    cls = re.search(r"class\s+([A-Za-z0-9_]+)", text)
    return cls.group(1) if cls else None


def find_source_refs(key: str, section: str, lines: list[SourceLine], inverted: dict[str, list[int]]) -> tuple[str, str]:
    terms = key_terms(key)
    if not terms:
        return "Unresolved", "Unresolved"
    candidate_ids = set()
    for term in terms:
        candidate_ids.update(inverted.get(term, []))
    if not candidate_ids:
        return humanize_identifier(key), "Unresolved"
    scored = []
    for idx in candidate_ids:
        line = lines[idx]
        token_hits = len(set(terms) & line.tokens)
        if not token_hits:
            continue
        score = token_hits * 3.0
        text_l = line.text.lower()
        if "public void" in text_l or "public class" in text_l:
            score += 2.0
        if "settings" in text_l:
            score += 1.5
        if section.lower() in line.rel_path.lower():
            score += 1.5
        if "/ui/" in line.rel_path.lower() and section in {"UI", "Avatars", "Audio"}:
            score += 1.0
        if any(t in text_l for t in ("safety", "audio", "mirror", "hud", "region", "tracking", "avatar", "color", "notification")):
            score += 0.5
        scored.append((score, line))
    if not scored:
        return humanize_identifier(key), "Unresolved"
    scored.sort(key=lambda item: (-item[0], item[1].rel_path, item[1].line_no))
    best = scored[:2]
    csharp_name = class_name_from_line(best[0][1].text) or humanize_identifier(key)
    return csharp_name, "<br>".join(f"{line.rel_path}:{line.line_no}" for _, line in best)


def writable_bucket(key: str) -> str:
    for label, pattern in LIVE_PATTERNS:
        if pattern.search(key):
            return f"Likely live-applied: {label}"
    for label, pattern in RELOAD_PATTERNS:
        if pattern.search(key):
            return f"Likely reload/reconnect: {label}"
    for label, pattern in STARTUP_PATTERNS:
        if pattern.search(key):
            return f"Likely startup-only: {label}"
    return "Persisted state / unclear from stub dump"


def build_report(entries: list[dict]) -> str:
    lines, inverted = build_source_index()
    rows_by_section: dict[str, list[dict]] = defaultdict(list)
    writable_groups: dict[str, list[str]] = defaultdict(list)
    for entry in entries:
        section = infer_section(entry["key"])
        inferred_type = infer_type(entry)
        csharp_name, source_ref = find_source_refs(entry["key"], section, lines, inverted)
        row = {
            "PlayerPrefs Key": entry["key"],
            "C# Name": csharp_name,
            "Type": inferred_type,
            "Meaning": infer_meaning(entry),
            "Values / Range": preview_value(entry, inferred_type),
            "Source File:Line": source_ref,
            "Present in Reg": "Yes",
        }
        rows_by_section[section].append(row)
        writable_groups[writable_bucket(entry["key"])].append(entry["key"])
    for section_rows in rows_by_section.values():
        section_rows.sort(key=lambda row: row["PlayerPrefs Key"].lower())
    section_counts = Counter({section: len(rows_by_section.get(section, [])) for section in SECTION_ORDER})
    out = []
    out.append("# VRChat PlayerPrefs / Registry Settings Reference")
    out.append("")
    out.append("Generated on 2026-04-14 from:")
    out.append(f"- Registry snapshot: `{REG_PATH}`")
    out.append(f"- IL2CPP stub export: `{SRC_ROOT}`")
    out.append("")
    out.append("> Note")
    out.append("> The `src` export is a signature/RVA tree with empty method bodies, so the raw `PlayerPrefs` string literals are not preserved in plain C#. This report uses the live registry snapshot as the authoritative key list, then attaches the closest semantically relevant source file/line matches available from the dump. Treat `Source File:Line` as best-effort semantic anchors, not exact `PlayerPrefs.SetX/GetX(...)` expression lines.")
    out.append("")
    out.append(f"Observed registry value count in the 2026-04-14 snapshot: **{len(entries)}**.")
    out.append("")
    for section in SECTION_ORDER:
        out.append(f"## {section}")
        out.append("")
        out.append("| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |")
        out.append("|---|---|---|---|---|---|---|")
        for row in rows_by_section.get(section, []):
            clean = {k: str(v).replace("\n", " ") for k, v in row.items()}
            out.append(
                f"| {clean['PlayerPrefs Key']} | {clean['C# Name']} | {clean['Type']} | "
                f"{clean['Meaning']} | {clean['Values / Range']} | "
                f"{clean['Source File:Line']} | {clean['Present in Reg']} |"
            )
        out.append("")
    out.append("## UI sections")
    out.append("")
    out.append("| Section | Key Count |")
    out.append("|---|---:|")
    for section in SECTION_ORDER:
        out.append(f"| {section} | {section_counts[section]} |")
    out.append("")
    out.append("## Top 30 keys to expose in a VRCSM GUI")
    out.append("")
    for idx, (key, why) in enumerate(TOP_30_KEYS, 1):
        out.append(f"{idx}. `{key}`: {why}")
    out.append("")
    out.append("## Writable without restart?")
    out.append("")
    out.append("This is inferred from the kind of setting and the surrounding module names available in the stub dump. Because the actual setter bodies are stripped, treat this as a practical integration guide rather than a binary guarantee.")
    out.append("")
    preferred_order = [
        "Likely live-applied: Audio",
        "Likely live-applied: HUD / UI",
        "Likely live-applied: Avatar safety / visibility",
        "Likely live-applied: Comfort / tracking",
        "Likely live-applied: Frame pacing / camera",
        "Likely reload/reconnect: Reconnect / relaunch likely",
        "Likely startup-only: Display bootstrap",
        "Likely startup-only: Migration / one-shot flags",
        "Likely startup-only: Opaque auth / install tokens",
        "Likely startup-only: Service / integration bootstrap",
        "Persisted state / unclear from stub dump",
    ]
    for bucket in preferred_order:
        keys = writable_groups.get(bucket, [])
        if not keys:
            continue
        out.append(f"### {bucket}")
        out.append("")
        sample = ", ".join(f"`{k}`" for k in keys[:24])
        suffix = "" if len(keys) <= 24 else f", plus {len(keys) - 24} more."
        out.append(sample + suffix)
        out.append("")
    out.append("## Source-only keys")
    out.append("")
    out.append("No additional raw PlayerPrefs key literals could be recovered confidently from the provided stub-only IL2CPP C# export beyond the keys confirmed in the live registry snapshot above.")
    out.append("")
    return "\n".join(out) + "\n"


def main() -> None:
    entries = run_reg_query()
    DOC_PATH.parent.mkdir(parents=True, exist_ok=True)
    DOC_PATH.write_text(build_report(entries), encoding="utf-8")
    print(f"{DOC_PATH} {len(entries)}")


if __name__ == "__main__":
    main()
