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
                    
                    if (!string.IsNullOrEmpty(task.originalDir) && Directory.Exists(task.originalDir))
                    {
                        var imageFiles = Directory.GetFiles(task.originalDir, "*.*", SearchOption.TopDirectoryOnly)
                            .Where(f => f.ToLower().EndsWith(".png") || f.ToLower().EndsWith(".jpg") || f.ToLower().EndsWith(".jpeg") || f.ToLower().EndsWith(".webp"))
                            .ToList();
                            
                        if (imageFiles.Count > 0)
                        {
                            string bestImage = imageFiles.FirstOrDefault(f => f.ToLower().Contains("cover") || f.ToLower().Contains("thumb") || f.ToLower().Contains("main") || f.ToLower().Contains("preview"));
                            if (bestImage == null) bestImage = imageFiles[0];
                            
                            try 
                            {
                                File.Copy(bestImage, thumbPath, true);
                                Log($"Using existing cover image from folder: {Path.GetFileName(bestImage)}");
                                useCameraFallback = false;
                            }
                            catch (Exception ex)
                            {
                                LogError($"Failed to copy image {bestImage}: {ex.Message}");
                            }
                        }
                    }

                    if (useCameraFallback)
                    {
                        try 
                        {
                            Camera cam = new GameObject("ThumbnailCamera").AddComponent<Camera>();
                            cam.backgroundColor = new Color(0.2f, 0.2f, 0.2f);
                            cam.clearFlags = CameraClearFlags.Color;
                            
                            Animator animator = avatarInstance.GetComponentInChildren<Animator>();
                            Vector3 targetPos = avatarInstance.transform.position + Vector3.up * 1.2f;
                            
                            if (animator != null && animator.isHuman)
                            {
                                Transform head = animator.GetBoneTransform(HumanBodyBones.Head);
                                if (head != null) targetPos = head.position;
                            }
                            
                            cam.transform.position = targetPos + avatarInstance.transform.forward * 0.8f;
                            cam.transform.LookAt(targetPos);
                            
                            RenderTexture rt = new RenderTexture(800, 600, 24);
                            cam.targetTexture = rt;
                            Texture2D screenShot = new Texture2D(800, 600, TextureFormat.RGB24, false);
                            
                            cam.Render();
                            RenderTexture.active = rt;
                            screenShot.ReadPixels(new Rect(0, 0, 800, 600), 0, 0);
                            screenShot.Apply();
                            
                            File.WriteAllBytes(thumbPath, screenShot.EncodeToPNG());
                            
                            cam.targetTexture = null;
                            RenderTexture.active = null;
                            UnityEngine.Object.DestroyImmediate(rt);
                            UnityEngine.Object.DestroyImmediate(screenShot);
                            UnityEngine.Object.DestroyImmediate(cam.gameObject);
                            Log("Successfully captured auto-thumbnail fallback.");
                        } 
                        catch (Exception ex) // Fixed duplicate variable issue by hiding behind block scope
                        {
                            LogError($"Failed to capture thumbnail: {ex.Message}");
                            var tex = new Texture2D(800, 600, TextureFormat.RGB24, false);
                            var colors = new Color[800 * 600];
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
