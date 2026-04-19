"""
VRC Auto Uploader — Smart Archive Extractor
Extracts .unitypackage files from nested archives with intelligent filtering.
"""
from typing import Callable, Optional

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

# v0.9.2 — name override / skip plan written by the panel via fs.writePlan.
# Lives at the user-picked root; sibling to every avatar subdir.
PLAN_FILENAME = ".vrcsm-upload-plan.json"


def load_upload_plan(base_dir: str) -> dict:
    """Read the panel-written plan if present.

    Schema (see plugins/vrc-auto-uploader/main.js, v0.9.2):
        {
            "renameMap": {origDir: uploadName, ...},
            "skip":      [origDir, ...],
            ...
        }
    Returns an empty dict on any error so callers can treat 'no plan'
    and 'broken plan' the same way (folder name = avatar name).
    """
    plan_path = os.path.join(base_dir, PLAN_FILENAME)
    if not os.path.isfile(plan_path):
        return {}
    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data

# Packages matching these patterns are shader/plugin dependencies, not model bodies
EXCLUDE_PATTERNS = [
    re.compile(r"poiyomi", re.IGNORECASE),
    re.compile(r"poi[_\s]?toon", re.IGNORECASE),
    re.compile(r"liltoon", re.IGNORECASE),
    re.compile(r"lilxyzw", re.IGNORECASE),
    re.compile(r"dynamic[_\s]?bone", re.IGNORECASE),
    re.compile(r"modular[_\s]?avatar", re.IGNORECASE),
    re.compile(r"gesture[_\s]?manager", re.IGNORECASE),
    re.compile(r"av3[_\s]?manager", re.IGNORECASE),
    re.compile(r"vrcsdk", re.IGNORECASE),
    re.compile(r"vrc[_\s]?sdk", re.IGNORECASE),
    re.compile(r"avatar[_\s]?3\.0", re.IGNORECASE),
]

ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}


def is_shader_or_plugin(filename: str) -> bool:
    """Check if a .unitypackage is likely a shader/plugin rather than a model."""
    stem = Path(filename).stem
    return any(p.search(stem) for p in EXCLUDE_PATTERNS)


def find_existing_packages(directory: str) -> list[str]:
    """Find all .unitypackage files already present in a directory tree."""
    results = []
    for root, _, files in os.walk(directory):
        for f in files:
            if f.lower().endswith(".unitypackage"):
                results.append(os.path.join(root, f))
    return results


def find_archives(directory: str) -> list[str]:
    """Find all archive files in a directory tree."""
    results = []
    for root, _, files in os.walk(directory):
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in ARCHIVE_EXTENSIONS:
                results.append(os.path.join(root, f))
    return results


def extract_archive(archive_path: str, dest_dir: str) -> bool:
    """Extract an archive using Windows built-in tar or 7z if available."""
    os.makedirs(dest_dir, exist_ok=True)
    ext = Path(archive_path).suffix.lower()

    # Try tar first (built into Windows 10/11, supports zip and some others)
    if ext == ".zip":
        try:
            result = subprocess.run(
                ["tar", "-xf", archive_path, "-C", dest_dir],
                capture_output=True, text=True, timeout=600
            )
            if result.returncode == 0:
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    # Try PowerShell Expand-Archive for .zip
    if ext == ".zip":
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f'Expand-Archive -Path "{archive_path}" -DestinationPath "{dest_dir}" -Force'],
                capture_output=True, text=True, timeout=600
            )
            if result.returncode == 0:
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    # Try 7z for .rar and .7z (and as fallback for .zip)
    for sevenzip in ["7z", r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"]:
        try:
            result = subprocess.run(
                [sevenzip, "x", archive_path, f"-o{dest_dir}", "-y", "-bso0"],
                capture_output=True, text=True, timeout=600
            )
            if result.returncode == 0:
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    # Last resort: tar for anything
    try:
        result = subprocess.run(
            ["tar", "-xf", archive_path, "-C", dest_dir],
            capture_output=True, text=True, timeout=600
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def pick_best_package(packages: list[str]) -> str | None:
    """From a list of .unitypackage files, pick the most likely model body.
    
    Strategy:
    1. Filter out known shader/plugin packages
    2. From remaining, pick the largest file (model bodies are usually the biggest)
    """
    # Filter out dependencies
    candidates = [p for p in packages if not is_shader_or_plugin(os.path.basename(p))]

    # If all were filtered out, fall back to all of them
    if not candidates:
        candidates = packages

    # Pick largest
    if not candidates:
        return None

    return max(candidates, key=lambda p: os.path.getsize(p))


def extract_model_dir(model_dir: str) -> dict:
    """Process a single model directory: find or extract .unitypackage files.
    
    Returns a result dict with:
        - name: directory basename
        - status: 'found' | 'extracted' | 'no_archive' | 'extract_failed' | 'no_package'
        - package: path to best .unitypackage (if found)
        - all_packages: list of all .unitypackage paths found
    """
    name = os.path.basename(model_dir)
    result = {"name": name, "status": "unknown", "package": None, "all_packages": [], "dir": model_dir}

    # 1. Check for existing .unitypackage files
    existing = find_existing_packages(model_dir)
    if existing:
        best = pick_best_package(existing)
        # Move to model root if nested
        if best and os.path.dirname(best) != model_dir:
            dest = os.path.join(model_dir, os.path.basename(best))
            if not os.path.exists(dest):
                shutil.move(best, dest)
            best = dest
        result["status"] = "found"
        result["package"] = best
        result["all_packages"] = existing
        return result

    # 2. Look for archives
    archives = find_archives(model_dir)
    if not archives:
        result["status"] = "no_archive"
        return result

    # Sort by size descending, try largest first
    archives.sort(key=lambda p: os.path.getsize(p), reverse=True)

    for archive in archives:
        temp_dir = os.path.join(model_dir, "_temp_extract")
        try:
            if not extract_archive(archive, temp_dir):
                continue

            # Search extracted content for .unitypackage
            extracted = find_existing_packages(temp_dir)
            if extracted:
                best = pick_best_package(extracted)
                if best:
                    dest = os.path.join(model_dir, os.path.basename(best))
                    if os.path.exists(dest):
                        # Avoid overwrite, add suffix
                        stem = Path(dest).stem
                        dest = os.path.join(model_dir, f"{stem}_extracted.unitypackage")
                    shutil.move(best, dest)
                    result["status"] = "extracted"
                    result["package"] = dest
                    result["all_packages"] = [dest]
                    return result

            # Check for nested archives inside the extraction
            nested_archives = find_archives(temp_dir)
            for nested in nested_archives:
                nested_temp = os.path.join(temp_dir, "_nested")
                if extract_archive(nested, nested_temp):
                    nested_pkgs = find_existing_packages(nested_temp)
                    if nested_pkgs:
                        best = pick_best_package(nested_pkgs)
                        if best:
                            dest = os.path.join(model_dir, os.path.basename(best))
                            shutil.move(best, dest)
                            result["status"] = "extracted"
                            result["package"] = dest
                            result["all_packages"] = [dest]
                            return result
                try:
                    shutil.rmtree(nested_temp, ignore_errors=True)
                except Exception:
                    pass

        finally:
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    result["status"] = "extract_failed"
    return result


def scan_model_directory(base_dir: str,
                         progress_callback: Callable[[int, int, str, str], None] | None = None,
                         log: Callable[[str, str], None] | None = None,
                         plan: Optional[dict] = None) -> list[dict]:
    """Scan an entire model directory and process each subdirectory.

    progress_callback(current, total, name, status) — called per model
    log(message, level) — 'info', 'success', 'warn', 'error'
    plan — optional v0.9.2 upload plan from the panel; when supplied
    we apply the rename map to result["name"] and drop subdirs the
    user explicitly skipped. If omitted we auto-load `.vrcsm-upload-
    plan.json` from base_dir so the runner always honours the panel
    even when the caller didn't pass --plan.
    """
    if log is None:
        log = lambda msg, lvl="info": print(msg)
    results = []
    if not os.path.isdir(base_dir):
        log(f"[extractor] Directory not found: {base_dir}", "error")
        return results

    if plan is None:
        plan = load_upload_plan(base_dir)
    rename_map = plan.get("renameMap") if isinstance(plan.get("renameMap"), dict) else {}
    skip_list = plan.get("skip") if isinstance(plan.get("skip"), list) else []
    skip_set = {str(s) for s in skip_list}
    if rename_map or skip_set:
        log(
            f"[extractor] Applying plan: {len(rename_map)} rename(s), {len(skip_set)} skipped.",
            "info",
        )

    subdirs = sorted([
        d for d in os.listdir(base_dir)
        if os.path.isdir(os.path.join(base_dir, d))
        and not d.startswith(".")
        and not d.startswith("_")
        and d not in ("TempVRCProject", "VRC-Auto-Uploader", "tools")
        and d not in skip_set
    ])

    total = len(subdirs)
    for i, dirname in enumerate(subdirs, 1):
        dirpath = os.path.join(base_dir, dirname)
        log(f"[{i}/{total}] Processing: {dirname}...", "info")
        result = extract_model_dir(dirpath)
        # Apply rename map. The folder name remains the index key
        # (origDir) so the panel UI and the plan stay aligned with
        # what's on disk; only the *avatar* name shown to VRChat
        # changes.
        upload_name = rename_map.get(dirname)
        if upload_name and upload_name != dirname:
            result["origName"] = result.get("name", dirname)
            result["name"] = upload_name
            log(f"  → rename: {dirname} → {upload_name}", "info")
        if result["status"] == "found":
            log(f"  ✓ found: {os.path.basename(result['package'])}", "success")
        elif result["status"] == "extracted":
            log(f"  ✓ extracted: {os.path.basename(result['package'])}", "success")
        elif result["status"] == "no_archive":
            log(f"  ⚠ no archives or packages found", "warn")
        elif result["status"] == "extract_failed":
            log(f"  ✗ extraction failed", "error")
        else:
            log(f"  ? {result['status']}", "warn")
        if progress_callback:
            progress_callback(i, total, dirname, result["status"])
        results.append(result)

    return results
