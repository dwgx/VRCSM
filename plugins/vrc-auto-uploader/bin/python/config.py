"""
VRC Auto Uploader — Configuration & Environment Detection
Handles finding Unity installations, vrc-get, and persistent settings.
"""

import os
import sys
import json
import glob
import shutil
import platform
import subprocess
import urllib.request
import winreg
from typing import Callable, Optional

CONFIG_FILE = "config.json"
VRC_GET_VERSION = "v1.9.1"
VRC_GET_URL = f"https://github.com/vrc-get/vrc-get/releases/download/{VRC_GET_VERSION}/x86_64-pc-windows-msvc-vrc-get.exe"

UNITY_SEARCH_PATHS = [
    r"C:\Program Files\Unity\Hub\Editor",
    r"D:\Program Files\Unity\Hub\Editor",
    r"E:\Program Files\Unity\Hub\Editor",
    r"F:\Program Files\Unity\Hub\Editor",
    os.path.expandvars(r"%LOCALAPPDATA%\Unity\Hub\Editor"),
    os.path.expandvars(r"%ProgramFiles%\Unity\Hub\Editor"),
]

REQUIRED_UNITY_VERSION = "2022.3.22f1"
COMPATIBLE_PREFIXES = ("2022.3", "2022.2", "2021.3", "2019.4")


def _registry_unity_paths() -> list[str]:
    """Read Unity install locations from Windows Registry."""
    paths = []
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for subkey in (r"SOFTWARE\Unity Technologies\Installer",
                       r"SOFTWARE\Unity\UnityEditor"):
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    i = 0
                    while True:
                        try:
                            name = winreg.EnumKey(key, i)
                        except OSError:
                            break
                        try:
                            with winreg.OpenKey(key, name) as vk:
                                loc, _ = winreg.QueryValueEx(vk, "Location x64")
                                if loc and os.path.isdir(loc):
                                    paths.append(loc)
                        except (FileNotFoundError, OSError):
                            pass
                        i += 1
            except (FileNotFoundError, OSError):
                pass
    hub_pref = os.path.join(os.environ.get("APPDATA", ""), "UnityHub", "secondaryInstallPath.json")
    if os.path.isfile(hub_pref):
        try:
            with open(hub_pref, "r") as f:
                custom = json.load(f)
                if isinstance(custom, str) and os.path.isdir(custom):
                    paths.append(custom)
        except Exception:
            pass
    return paths


def find_all_unity_installations() -> list[dict]:
    """Find all Unity installations with detailed info.
    Returns list of dicts: {version, path, is_recommended, is_compatible}
    """
    installations = []
    seen = set()
    search = list(UNITY_SEARCH_PATHS)
    search.extend(_registry_unity_paths())
    for base in search:
        if not os.path.isdir(base):
            continue
        for version_dir in os.listdir(base):
            candidate = os.path.join(base, version_dir, "Editor", "Unity.exe")
            if os.path.isfile(candidate) and candidate not in seen:
                seen.add(candidate)
                installations.append({
                    "version": version_dir,
                    "path": candidate,
                    "is_recommended": version_dir == REQUIRED_UNITY_VERSION,
                    "is_compatible": any(version_dir.startswith(p) for p in COMPATIBLE_PREFIXES),
                })
            exe_root = os.path.join(base, "Editor", "Unity.exe")
            if os.path.isfile(exe_root) and exe_root not in seen:
                seen.add(exe_root)
                ver = os.path.basename(base)
                installations.append({
                    "version": ver,
                    "path": exe_root,
                    "is_recommended": ver == REQUIRED_UNITY_VERSION,
                    "is_compatible": any(ver.startswith(p) for p in COMPATIBLE_PREFIXES),
                })
    installations.sort(key=lambda x: (not x["is_recommended"], not x["is_compatible"], x["version"]))
    return installations


def find_unity_exe() -> str | None:
    installs = find_all_unity_installations()
    if not installs:
        return None
    # Prefer recommended, then compatible, then any
    for i in installs:
        if i["is_recommended"]:
            return i["path"]
    for i in installs:
        if i["is_compatible"]:
            return i["path"]
    return installs[0]["path"]


def find_vrc_get(tool_dir: str) -> str | None:
    """Find vrc-get.exe: check tool_dir, PATH, then common locations."""
    # 1. Check our own tools directory
    local = os.path.join(tool_dir, "vrc-get.exe")
    if os.path.isfile(local):
        return local

    # 2. Check PATH
    found = shutil.which("vrc-get")
    if found:
        return found

    # 3. Known locations from previous Gemini setup
    known = [r"D:\vrc-get\vrc-get.exe", r"C:\vrc-get\vrc-get.exe"]
    for p in known:
        if os.path.isfile(p):
            return p

    return None


def download_vrc_get(dest_dir: str) -> str:
    """Download the vrc-get binary from GitHub releases."""
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "vrc-get.exe")
    print(f"[setup] Downloading vrc-get {VRC_GET_VERSION}...")
    urllib.request.urlretrieve(VRC_GET_URL, dest)
    # Verify it runs
    result = subprocess.run([dest, "--version"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Downloaded vrc-get failed to execute: {result.stderr}")
    print(f"[setup] vrc-get {result.stdout.strip()} ready at {dest}")
    return dest


class Config:
    """Manages persistent configuration and runtime environment state."""

    def __init__(self, project_root: str):
        self.project_root = os.path.abspath(project_root)
        self.config_path = os.path.join(self.project_root, CONFIG_FILE)
        self.tools_dir = os.path.join(self.project_root, "tools")
        self._data = {}
        self.load()

    def load(self):
        if os.path.isfile(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                self._data = json.load(f)

    def save(self):
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)

    @property
    def unity_exe(self) -> str | None:
        return self._data.get("unity_exe")

    @unity_exe.setter
    def unity_exe(self, value):
        self._data["unity_exe"] = value

    @property
    def vrc_get_exe(self) -> str | None:
        return self._data.get("vrc_get_exe")

    @vrc_get_exe.setter
    def vrc_get_exe(self, value):
        self._data["vrc_get_exe"] = value

    @property
    def temp_project_dir(self) -> str:
        return self._data.get("temp_project_dir",
                              os.path.join(self.project_root, "TempVRCProject"))

    @temp_project_dir.setter
    def temp_project_dir(self, value):
        self._data["temp_project_dir"] = value

    def detect_environment(self, log: Callable[[str, str], None] | None = None) -> bool:
        """Auto-detect Unity and vrc-get. Returns True if all found.
        log(message, level) — level is 'info', 'warn', 'error', 'success'
        """
        if log is None:
            log = lambda msg, lvl="info": print(f"[setup] {msg}")
        ok = True

        # Unity
        if not self.unity_exe or not os.path.isfile(self.unity_exe):
            found = find_unity_exe()
            if found:
                self.unity_exe = found
                log(f"Found Unity: {found}", "success")
            else:
                log(f"No valid Unity installation found!", "error")
                log(f"Install Unity {REQUIRED_UNITY_VERSION} via Unity Hub", "error")
                ok = False
        else:
            log(f"Unity: {self.unity_exe}", "info")

        # vrc-get
        if not self.vrc_get_exe or not os.path.isfile(self.vrc_get_exe):
            found = find_vrc_get(self.tools_dir)
            if found:
                self.vrc_get_exe = found
                log(f"Found vrc-get: {found}", "success")
            else:
                try:
                    log("Downloading vrc-get...", "info")
                    self.vrc_get_exe = download_vrc_get(self.tools_dir)
                    log(f"vrc-get downloaded to {self.vrc_get_exe}", "success")
                except Exception as e:
                    log(f"Could not get vrc-get: {e}", "error")
                    ok = False
        else:
            log(f"vrc-get: {self.vrc_get_exe}", "info")

        self.save()
        return ok

    def validate(self, log: Callable[[str, str], None] | None = None) -> bool:
        """Check that all required tools exist. Auto-heals by re-running detect_environment()."""
        if log is None:
            log = lambda msg, lvl="info": print(f"[!] {msg}")

        needs_unity = not self.unity_exe or not os.path.isfile(self.unity_exe)
        needs_vrcget = not self.vrc_get_exe or not os.path.isfile(self.vrc_get_exe)

        if needs_unity or needs_vrcget:
            log("Some tools not found — running auto-detection...", "warn")
            self.detect_environment(log)

        errors = []
        if not self.unity_exe or not os.path.isfile(self.unity_exe):
            errors.append("No Unity installation found. Install Unity via Unity Hub.")
        if not self.vrc_get_exe or not os.path.isfile(self.vrc_get_exe):
            errors.append("vrc-get could not be found or downloaded. Check your internet connection.")
        for e in errors:
            log(e, "error")
        return len(errors) == 0

    def get_unity_details(self) -> dict:
        """Get detailed info about all Unity installations."""
        installs = find_all_unity_installations()
        current = self.unity_exe
        current_version = None
        if current and os.path.isfile(current):
            # Extract version from path
            parts = current.replace("/", "\\").split("\\")
            for i, p in enumerate(parts):
                if p == "Editor" and i > 0:
                    current_version = parts[i - 1]
                    break
        return {
            "current_path": current,
            "current_version": current_version,
            "is_recommended": current_version == REQUIRED_UNITY_VERSION if current_version else False,
            "is_compatible": current_version.startswith("2022.3") if current_version else False,
            "recommended_version": REQUIRED_UNITY_VERSION,
            "all_installations": installs,
        }
