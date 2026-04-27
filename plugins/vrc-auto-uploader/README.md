# VRChat Auto-Uploader (VRCSM plugin)

Batch-uploads every `.unitypackage` in a folder to VRChat without the 25% "Could not find VRCAvatarDescriptor" failure rate the original [VRC-Auto-Uploader](https://github.com/dwgx/VRC-Auto-Uploader) used to ship with.

## What's different in v0.9.0

| Failure mode | Old behaviour | v0.9.0 fix |
|---|---|---|
| Shader recompilation wiped AutoUploader state mid-batch | `static` fields lost on domain reload → restart from task 0 | `SessionState.GetBool/GetInt` persists `_currentTaskIndex`, `_isRunning`, `_sdkReady` across reloads |
| `AssetDatabase.ImportPackage` finished faster than `Task.Delay(3000)` on small packages, slower on big ones | Fixed 3s sleep | Event-based wait on `importPackageCompleted` / `importPackageFailed` / `importPackageCancelled` with a 120 s timeout, plus a compiler/editor-updating barrier before continuing |
| `.shader .cginc .hlsl .compute .raytrace` in packages triggered extra domain reloads | `BAD_EXTENSIONS = {.cs, .dll, .asmdef, .js}` | Extended to include all shader/compute extensions |
| First `FindAvatarInScenes` miss aborted the whole task | Hard fail | One retry after a forced synchronous `AssetDatabase.Refresh` |
| Single bad SDK popup killed the whole suppression loop | `catch { /* ignore */ }` at outer scope meant one throw stopped all future suppression attempts | Per-popup try/catch inside the loop — a bad dialog only costs itself |

## Install

Installs automatically via the VRCSM plugin store (feed entry `dev.vrcsm.autouploader`). Bundled with the MSI from v0.9.0 onwards.

## Usage

1. Open **VRCSM → Plugins → VRChat Auto-Uploader**.
2. Click **Choose folder…** and pick the root of your avatar packages (recursion supported).
3. Click **Scan** (sanitizer previews what it would strip).
4. Click **Start upload batch**. The panel writes a task manifest; you launch the Python runner once from PowerShell:
   ```
   cd "%LocalAppData%\VRCSM\plugins\dev.vrcsm.autouploader\bin\python"
   python main.py batch --dir "C:\path\to\your\avatars" --plan "C:\path\to\your\avatars\.vrcsm-upload-plan.json" -y
   ```
   The v0.9.4 `AutoUploader.cs` (inside `UnityScripts/`) drives Unity Editor headlessly, uploads each avatar, and writes `upload_results.json` alongside your tasks.
   On first run the Python runner auto-detects Unity 2022.3.x and downloads `vrc-get` into its local `tools/` folder if it is not already installed.

## Roadmap

- **v0.9.1**: `plugin.exec` permission so the panel spawns the Python runner directly (no shell round-trip). Requires the `PluginProcess` C++ runtime landed.
- **v0.9.3**: packaged-path fixes for UnityScripts, Unity registry detection, and clearer first-run vrc-get setup messaging.
- **v0.9.4**: thumbnail selection rejects tiny/thumb/WebP candidates and re-encodes the chosen cover as a valid PNG before upload.
