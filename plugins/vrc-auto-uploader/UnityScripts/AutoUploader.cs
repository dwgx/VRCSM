using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using VRC.Core;
using VRC.SDK3.Avatars.Components;
using VRC.SDK3A.Editor;
using VRC.SDKBase.Editor;
using VRC.SDKBase.Editor.Api;

namespace VRCAutoUploader
{
    [Serializable]
    public class UploadTask
    {
        public string name;
        public string packagePath;
        public string avatarName;
        public string originalDir;
        public string blueprintId;
    }

    [Serializable]
    public class UploadTaskList
    {
        public UploadTask[] tasks;
    }

    [Serializable]
    public class UploadResult
    {
        public string name;
        public string status;
        public string error;
        public string blueprintId;
    }

    [Serializable]
    public class UploadResultList
    {
        public List<UploadResult> results = new List<UploadResult>();
    }

    [InitializeOnLoad]
    public static class AutoUploader
    {
        private static readonly string ProjectRoot = Directory.GetCurrentDirectory();
        private static readonly string TaskFilePath = Path.Combine(ProjectRoot, "upload_tasks.json");
        private static readonly string ResultFilePath = Path.Combine(ProjectRoot, "upload_results.json");
        private static readonly string LockFilePath = Path.Combine(ProjectRoot, "autouploader.lock");
        private const int ThumbnailWidth = 1200;
        private const int ThumbnailHeight = 900;

        private sealed class ThumbnailCandidate
        {
            public string FilePath;
            public int Width;
            public int Height;
            public long Bytes;
            public int Score;
            public bool WeakName;
        }

        private static UploadTaskList _taskList;
        private static UploadResultList _resultList;
        private static IVRCSdkAvatarBuilderApi _builder;

        // v0.9.0: domain-reload persistence for mid-batch fields. Any shader
        // compile / DLL reimport triggers a Unity domain reload which nukes
        // static fields, leaving AutoUploader thinking it's cold-starting and
        // restarting from task 0. SessionState survives the reload.
        private const string KeyCurrentTaskIndex = "VRCAutoUploader.CurrentTaskIndex";
        private const string KeyIsRunning = "VRCAutoUploader.IsRunning";
        private const string KeySdkReady = "VRCAutoUploader.SdkReady";

        private static int _currentTaskIndex
        {
            get => SessionState.GetInt(KeyCurrentTaskIndex, -1);
            set => SessionState.SetInt(KeyCurrentTaskIndex, value);
        }
        private static bool _isRunning
        {
            get => SessionState.GetBool(KeyIsRunning, false);
            set => SessionState.SetBool(KeyIsRunning, value);
        }
        private static bool _sdkReady
        {
            get => SessionState.GetBool(KeySdkReady, false);
            set => SessionState.SetBool(KeySdkReady, value);
        }

        static AutoUploader()
        {
            if (!File.Exists(TaskFilePath)) return;
            Log("=== VRC Auto Uploader Initialized ===");
            EditorApplication.delayCall += OnEditorReady;
        }

        public static void Execute()
        {
            Log("Execute() called via -executeMethod");
            if (!_isRunning && File.Exists(TaskFilePath))
            {
                EditorApplication.delayCall += OnEditorReady;
            }
        }

        [MenuItem("VRCAutoUploader/Manual Start")]
        public static void ManualStart()
        {
            Log("Manual start triggered by user.");
            _isRunning = false;
            if (File.Exists(TaskFilePath)) OnEditorReady();
        }

        private static void OnEditorReady()
        {
            if (_isRunning) return;
            _isRunning = true;

            try
            {
                string json = File.ReadAllText(TaskFilePath);
                _taskList = JsonUtility.FromJson<UploadTaskList>(json);
                _resultList = new UploadResultList();

                if (File.Exists(ResultFilePath))
                {
                    try
                    {
                        var resJson = File.ReadAllText(ResultFilePath);
                        var oldRes = JsonUtility.FromJson<UploadResultList>(resJson);
                        if (oldRes != null && oldRes.results != null) _resultList = oldRes;
                    }
                    catch (Exception) { }
                }

                if (_taskList?.tasks == null || _taskList.tasks.Length == 0)
                {
                    Log("No tasks found. Exiting.");
                    Finish();
                    return;
                }

                _currentTaskIndex = _resultList.results.Count - 1;
                Log($"Loaded {_taskList.tasks.Length} tasks. Resume index: {_currentTaskIndex + 1}");

                EditorApplication.ExecuteMenuItem("VRChat SDK/Show Control Panel");

                VRCSdkControlPanel.OnSdkPanelEnable += OnSdkPanelReady;
                EditorApplication.update += PollForSdkReady;
            }
            catch (Exception ex)
            {
                LogError($"Failed to initialize: {ex.Message}");
                Finish();
            }
        }

        private static void OnSdkPanelReady(object sender, EventArgs e)
        {
            _sdkReady = true;
            VRCSdkControlPanel.OnSdkPanelEnable -= OnSdkPanelReady;
        }

        private static int _pollCount = 0;
        private static void PollForSdkReady()
        {
            _pollCount++;
            if (_pollCount % 120 != 0) return;

            if (VRCSdkControlPanel.TryGetBuilder<IVRCSdkAvatarBuilderApi>(out var builder))
            {
                _builder = builder;
                _sdkReady = true;
            }

            if (_sdkReady && _builder != null)
            {
                EditorApplication.update -= PollForSdkReady;
                Log("SDK Builder API acquired — starting tasks");
                StartNextTask();
            }

            if (_pollCount > 120 * 60 * 15)
            {
                EditorApplication.update -= PollForSdkReady;
                LogError("Timeout waiting for SDK. Are you logged in?");
                Finish();
            }
        }

        private static async void StartNextTask()
        {
            _currentTaskIndex++;
            if (_currentTaskIndex >= _taskList.tasks.Length)
            {
                Log($"All tasks complete! ({_resultList.results.Count} processed)");
                Finish();
                return;
            }

            var task = _taskList.tasks[_currentTaskIndex];
            Log($"═══ Task [{_currentTaskIndex + 1}/{_taskList.tasks.Length}]: {task.name} ═══");
            var result = new UploadResult { name = task.name };

            try
            {
                if (!File.Exists(task.packagePath))
                {
                    result.status = "failed"; result.error = "Package not found";
                    _resultList.results.Add(result); StartNextTask(); return;
                }

                Log("Creating clean scene...");
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                Log($"Importing package: {Path.GetFileName(task.packagePath)}");

                // v0.9.0 race fix: event-based wait for ImportPackage completion
                // instead of blind Task.Delay(3000). Large packages blew past the
                // 3-second window, arriving at FindAvatarInScenes before MonoScript
                // resolution finished — which is exactly how 15/60 historical runs
                // failed with "Could not find VRCAvatarDescriptor". 120s timeout.
                var importTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                AssetDatabase.ImportPackageCallback onDone = (_) => importTcs.TrySetResult(true);
                AssetDatabase.ImportPackageFailedCallback onFail = (_, err) =>
                    importTcs.TrySetException(new Exception(err));
                AssetDatabase.ImportPackageCallback onCancel = (_) => importTcs.TrySetCanceled();
                AssetDatabase.importPackageCompleted += onDone;
                AssetDatabase.importPackageFailed += onFail;
                AssetDatabase.importPackageCancelled += onCancel;
                try
                {
                    AssetDatabase.ImportPackage(task.packagePath, false);
                    var timeout = Task.Delay(TimeSpan.FromSeconds(120));
                    var finished = await Task.WhenAny(importTcs.Task, timeout);
                    if (finished == timeout)
                    {
                        throw new TimeoutException(
                            $"ImportPackage did not complete within 120s for {Path.GetFileName(task.packagePath)}");
                    }
                    await importTcs.Task;
                }
                finally
                {
                    AssetDatabase.importPackageCompleted -= onDone;
                    AssetDatabase.importPackageFailed -= onFail;
                    AssetDatabase.importPackageCancelled -= onCancel;
                }

                // Wait for any triggered compilation / domain reload to settle.
                // Shader/cginc files (now stripped by the v0.9.0 sanitizer fix)
                // used to force a reload right here; keep the guard as defence.
                while (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    await Task.Yield();
                }

                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                await Task.Delay(500); // MonoScript resolution buffer

                GameObject avatarInstance = FindAndInstantiateAvatar() ?? FindAvatarInScenes();

                // Retry path: on first miss, give the AssetDatabase one more chance
                // to surface recently-imported prefabs. Happens after domain-reload
                // events that aren't fully visible to the first scan.
                if (avatarInstance == null)
                {
                    Log("Avatar not found on first scan — retrying after forced reimport...");
                    AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                    await Task.Delay(1000);
                    avatarInstance = FindAndInstantiateAvatar() ?? FindAvatarInScenes();
                }

                if (avatarInstance == null)
                {
                    result.status = "failed"; result.error = "Could not find VRCAvatarDescriptor";
                    LogError(result.error); _resultList.results.Add(result); CleanupImportedAssets(); StartNextTask(); return;
                }

                var pipelineManager = avatarInstance.GetComponent<PipelineManager>();
                if (pipelineManager == null) { pipelineManager = avatarInstance.AddComponent<PipelineManager>(); }
                
                if (!string.IsNullOrEmpty(task.blueprintId))
                {
                    pipelineManager.blueprintId = task.blueprintId;
                    Log($"Overwriting existing avatar with Blueprint ID: {task.blueprintId}");
                }
                else
                {
                    pipelineManager.blueprintId = "";
                }

                if (!string.IsNullOrEmpty(task.avatarName)) avatarInstance.name = task.avatarName;

                if (_builder == null && !VRCSdkControlPanel.TryGetBuilder<IVRCSdkAvatarBuilderApi>(out _builder))
                {
                    result.status = "failed"; result.error = "Builder not available"; _resultList.results.Add(result); StartNextTask(); return;
                }

                CancellationTokenSource cts = new CancellationTokenSource();
                _builder.OnSdkBuildProgress += (sender, msg) => Log($"Build: {msg}");

                try
                {
                    string thumbPath = Path.Combine(Application.temporaryCachePath, "vrc_thumb.png");
                    bool useCameraFallback = true;
                    
                    if (TryPrepareFolderThumbnail(task.originalDir, thumbPath))
                    {
                        useCameraFallback = false;
                    }

                    if (useCameraFallback)
                    {
                        try 
                        {
                            Camera cam = new GameObject("ThumbnailCamera").AddComponent<Camera>();
                            cam.backgroundColor = new Color(0.2f, 0.2f, 0.2f);
                            cam.clearFlags = CameraClearFlags.Color;
                            cam.fieldOfView = 32f;
                            cam.nearClipPlane = 0.01f;
                            cam.farClipPlane = 1000f;
                            
                            Animator animator = avatarInstance.GetComponentInChildren<Animator>();
                            Bounds bounds = CalculateAvatarBounds(avatarInstance);
                            float avatarHeight = Mathf.Max(bounds.size.y, 1.2f);
                            Vector3 targetPos = bounds.center;
                            targetPos.y = bounds.min.y + avatarHeight * 0.58f;
                            
                            if (animator != null && animator.isHuman)
                            {
                                Transform head = animator.GetBoneTransform(HumanBodyBones.Head);
                                if (head != null) targetPos = Vector3.Lerp(targetPos, head.position, 0.7f);
                            }
                            
                            Vector3 forward = avatarInstance.transform.forward;
                            if (forward.sqrMagnitude < 0.001f) forward = Vector3.forward;
                            float distance = Mathf.Max(bounds.extents.magnitude * 1.6f, 2.2f);
                            cam.transform.position = targetPos + forward.normalized * distance + Vector3.up * (avatarHeight * 0.03f);
                            cam.transform.LookAt(targetPos);
                            
                            RenderTexture previous = RenderTexture.active;
                            RenderTexture rt = null;
                            Texture2D screenShot = null;
                            try
                            {
                                rt = new RenderTexture(ThumbnailWidth, ThumbnailHeight, 24);
                                cam.targetTexture = rt;
                                screenShot = new Texture2D(ThumbnailWidth, ThumbnailHeight, TextureFormat.RGB24, false);

                                cam.Render();
                                RenderTexture.active = rt;
                                screenShot.ReadPixels(new Rect(0, 0, ThumbnailWidth, ThumbnailHeight), 0, 0);
                                screenShot.Apply();

                                File.WriteAllBytes(thumbPath, screenShot.EncodeToPNG());
                            }
                            finally
                            {
                                cam.targetTexture = null;
                                RenderTexture.active = previous;
                                if (rt != null) UnityEngine.Object.DestroyImmediate(rt);
                                if (screenShot != null) UnityEngine.Object.DestroyImmediate(screenShot);
                                UnityEngine.Object.DestroyImmediate(cam.gameObject);
                            }
                            Log("Successfully captured auto-thumbnail fallback.");
                        } 
                        catch (Exception ex) // Fixed duplicate variable issue by hiding behind block scope
                        {
                            LogError($"Failed to capture thumbnail: {ex.Message}");
                            var tex = new Texture2D(ThumbnailWidth, ThumbnailHeight, TextureFormat.RGB24, false);
                            var colors = new Color[ThumbnailWidth * ThumbnailHeight];
                            for (int i = 0; i < colors.Length; i++) colors[i] = Color.grey;
                            tex.SetPixels(colors);
                            tex.Apply();
                            File.WriteAllBytes(thumbPath, tex.EncodeToPNG());
                            UnityEngine.Object.DestroyImmediate(tex);
                        }
                    }

                    var newAv = new VRCAvatar { 
                        Name = avatarInstance.name, 
                        Description = "Uploaded automatically by Uploader", 
                        Tags = new List<string>(), 
                        ReleaseStatus = "private" 
                    };

                    // Save the scene to avoid VRC SDK prompting the user to save "Untitled" scene
                    string tempScenePath = "Assets/TempUploadScene.unity";
                    EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), tempScenePath);

                    await _builder.BuildAndUpload(avatarInstance, newAv, thumbPath, cts.Token);
                    var pm = avatarInstance.GetComponent<PipelineManager>();
                    string newId = pm != null ? pm.blueprintId : "unknown";

                    result.status = "success"; result.blueprintId = newId;
                }
                catch (Exception ex)
                {
                    result.status = "failed"; result.error = ex.Message; LogError(ex.Message);
                }
                finally { cts.Dispose(); }
            }
            catch (Exception ex)
            {
                result.status = "failed"; result.error = ex.Message; LogError(ex.Message);
            }

            _resultList.results.Add(result);
            SaveResults();
            CleanupImportedAssets();
            await Task.Delay(2000);
            StartNextTask();
        }

        private static bool TryPrepareFolderThumbnail(string originalDir, string thumbPath)
        {
            if (string.IsNullOrEmpty(originalDir) || !Directory.Exists(originalDir)) return false;

            List<ThumbnailCandidate> candidates = new List<ThumbnailCandidate>();
            foreach (var file in Directory.GetFiles(originalDir, "*.*", SearchOption.TopDirectoryOnly))
            {
                string ext = Path.GetExtension(file).ToLowerInvariant();
                if (ext == ".webp")
                {
                    Log($"Skipping WebP thumbnail candidate (cannot safely upload as PNG): {Path.GetFileName(file)}");
                    continue;
                }
                if (ext != ".png" && ext != ".jpg" && ext != ".jpeg") continue;

                if (!TryReadImageInfo(file, out int width, out int height, out long bytes, out string readError))
                {
                    Log($"Skipping unreadable thumbnail candidate: {Path.GetFileName(file)} ({readError})");
                    continue;
                }

                int minSide = Math.Min(width, height);
                if (minSide < 512)
                {
                    Log($"Skipping small thumbnail candidate: {Path.GetFileName(file)} ({width}x{height})");
                    continue;
                }

                bool weakName = IsWeakThumbnailName(file);
                candidates.Add(new ThumbnailCandidate
                {
                    FilePath = file,
                    Width = width,
                    Height = height,
                    Bytes = bytes,
                    WeakName = weakName,
                    Score = ScoreThumbnailCandidate(file, width, height, bytes, weakName)
                });
            }

            ThumbnailCandidate best = candidates
                .Where(candidate => !candidate.WeakName)
                .OrderByDescending(candidate => candidate.Score)
                .FirstOrDefault()
                ?? candidates
                    .OrderByDescending(candidate => candidate.Score)
                    .FirstOrDefault();

            if (best == null)
            {
                Log("No usable folder cover image found; capturing Unity camera thumbnail.");
                return false;
            }

            if (!TryReencodeThumbnailAsPng(best.FilePath, thumbPath, out string encodeError))
            {
                LogError($"Failed to sanitize thumbnail {Path.GetFileName(best.FilePath)}: {encodeError}");
                return false;
            }

            Log($"Using sanitized cover image: {Path.GetFileName(best.FilePath)} ({best.Width}x{best.Height})");
            return true;
        }

        private static bool TryReadImageInfo(string filePath, out int width, out int height, out long bytes, out string error)
        {
            width = 0;
            height = 0;
            bytes = 0;
            error = "";
            Texture2D texture = null;

            try
            {
                byte[] data = File.ReadAllBytes(filePath);
                bytes = data.LongLength;
                texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!ImageConversion.LoadImage(texture, data, false))
                {
                    error = "decode failed";
                    return false;
                }
                width = texture.width;
                height = texture.height;
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
            finally
            {
                if (texture != null) UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static bool TryReencodeThumbnailAsPng(string filePath, string thumbPath, out string error)
        {
            error = "";
            Texture2D texture = null;

            try
            {
                byte[] data = File.ReadAllBytes(filePath);
                texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!ImageConversion.LoadImage(texture, data, false))
                {
                    error = "decode failed";
                    return false;
                }

                byte[] png = ImageConversion.EncodeToPNG(texture);
                if (png == null || png.Length == 0)
                {
                    error = "PNG encode failed";
                    return false;
                }

                File.WriteAllBytes(thumbPath, png);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
            finally
            {
                if (texture != null) UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static bool IsWeakThumbnailName(string filePath)
        {
            string name = Path.GetFileNameWithoutExtension(filePath).ToLowerInvariant();
            return name.Contains("thumb") ||
                name.Contains("thumbnail") ||
                name.Contains("icon") ||
                name.Contains("small") ||
                name.Contains("mini") ||
                name.Contains("blur");
        }

        private static int ScoreThumbnailCandidate(string filePath, int width, int height, long bytes, bool weakName)
        {
            string name = Path.GetFileNameWithoutExtension(filePath).ToLowerInvariant();
            int minSide = Math.Min(width, height);
            int score = Math.Min(minSide, 1600);
            score += (int)Math.Min(bytes / 1024, 500);

            if (name.Contains("cover")) score += 700;
            if (name.Contains("main")) score += 500;
            if (name.Contains("hero")) score += 450;
            if (name.Contains("avatar")) score += 350;
            if (name.Contains("preview")) score += 250;

            float aspect = height > 0 ? width / (float)height : 0f;
            if (aspect >= 1.2f && aspect <= 1.9f) score += 120;
            else if (aspect >= 0.8f && aspect <= 1.2f) score += 60;

            if (weakName) score -= 900;
            return score;
        }

        private static Bounds CalculateAvatarBounds(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null)
                .ToArray();

            if (renderers.Length == 0)
            {
                return new Bounds(root.transform.position + Vector3.up, Vector3.one);
            }

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
            {
                bounds.Encapsulate(renderers[i].bounds);
            }
            return bounds;
        }

        private static GameObject FindAndInstantiateAvatar()
        {
            var guids = AssetDatabase.FindAssets("t:Prefab");
            List<(string path, GameObject prefab)> candidates = new List<(string, GameObject)>();
            foreach (var guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.StartsWith("Assets/")) continue;
                if (path.Contains("Editor/VRCAutoUploader")) continue;
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab != null && prefab.GetComponent<VRCAvatarDescriptor>()) candidates.Add((path, prefab));
            }
            if (candidates.Count == 0) return null;
            var best = candidates.OrderBy(c => c.path.Count(ch => ch == '/')).First();
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(best.prefab);
            instance.transform.position = Vector3.zero;
            return instance;
        }

        private static GameObject FindAvatarInScenes()
        {
            var sceneGuids = AssetDatabase.FindAssets("t:Scene");
            foreach (var guid in sceneGuids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.StartsWith("Assets/")) continue;
                try
                {
                    var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
                    foreach (var rootObj in scene.GetRootGameObjects())
                    {
                        if (rootObj.GetComponentInChildren<VRCAvatarDescriptor>() != null)
                        {
                            UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(rootObj, EditorSceneManager.GetActiveScene());
                            EditorSceneManager.CloseScene(scene, true);
                            return rootObj;
                        }
                    }
                    EditorSceneManager.CloseScene(scene, true);
                }
                catch { }
            }
            return null;
        }

        private static void CleanupImportedAssets()
        {
            var assetDirs = Directory.GetDirectories(Path.Combine(ProjectRoot, "Assets"));
            foreach (var dir in assetDirs)
            {
                if (Path.GetFileName(dir) == "Editor") continue;
                try { FileUtil.DeleteFileOrDirectory(dir); FileUtil.DeleteFileOrDirectory(dir + ".meta"); } catch { }
            }
            AssetDatabase.Refresh();
        }

        private static void SaveResults()
        {
            try { File.WriteAllText(ResultFilePath, JsonUtility.ToJson(_resultList, true)); } catch { }
        }

        private static void Finish()
        {
            SaveResults();
            try { if (File.Exists(LockFilePath)) File.Delete(LockFilePath); } catch { }
            Log("=== VRC Auto Uploader Finished ===");
            EditorApplication.delayCall += () => { EditorApplication.Exit(0); };
        }

        private static void Log(string msg) { Debug.Log($"[AutoUploader] {msg}"); AppendToLocalLog($"[INFO] {msg}"); }
        private static void LogError(string msg) { Debug.LogError($"[AutoUploader] {msg}"); AppendToLocalLog($"[ERROR] {msg}"); }
        private static void AppendToLocalLog(string msg) { try { File.AppendAllText(Path.Combine(ProjectRoot, "autouploader.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}\n"); } catch { } }
    }
}
