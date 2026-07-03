/*
 * VRC Auto Uploader — Popup Suppressor
 * 
 * Automatically handles SDK popups and dialogs that would block
 * the automated upload pipeline. In particular:
 *   - Suppresses the copyright agreement popup (auto-accepts)
 *   - Handles "SDK update available" prompts
 *   - Closes any other blocking dialog windows
 */

using UnityEngine;
using UnityEngine.UIElements;
using UnityEditor;
using System;
using System.Linq;
using System.Reflection;

namespace VRCAutoUploader
{
    [InitializeOnLoad]
    public static class PopupSuppressor
    {
        private static int _frameCount = 0;

        static PopupSuppressor()
        {
            // Only activate when AutoUploader is running
            string taskFile = System.IO.Path.Combine(
                System.IO.Directory.GetCurrentDirectory(), "upload_tasks.json");

            if (!System.IO.File.Exists(taskFile))
                return;

            EditorApplication.update += SuppressPopups;
            Debug.Log("[AutoUploader] PopupSuppressor active");
        }

        private static void SuppressPopups()
        {
            _frameCount++;

            // Check every ~2 seconds
            if (_frameCount % 120 != 0) return;

            try
            {
                // Close any EditorUtility.DisplayDialog that might be open
                // Unity doesn't provide a direct way to detect/close these,
                // but we can close any popup-type EditorWindows
                var windows = Resources.FindObjectsOfTypeAll<EditorWindow>();
                foreach (var window in windows)
                {
                    string title = window.titleContent?.text ?? "";

                    // Quick patch: if it's the VRChat SDK window, check for UIElement modals (like Copyright agreement)
                    if (title.Contains("VRChat SDK"))
                    {
                        var root = window.rootVisualElement;
                        if (root != null)
                        {
                            var buttons = root.Query<UnityEngine.UIElements.Button>().ToList();
                            foreach (var btn in buttons)
                            {
                                if (btn.text == "OK" && btn.worldBound.height > 0)
                                {
                                    // v0.9.0 defence: wrap each individual click
                                    // attempt in try/catch. A single mis-shaped
                                    // dialog used to throw here and kill the
                                    // whole suppression loop for the rest of
                                    // the Unity session — which then let ALL
                                    // subsequent popups block the upload queue.
                                    try
                                    {
                                        Debug.Log("[AutoUploader] Auto-clicking SDK modal OK button!");
                                        if (!TryClickButton(btn))
                                        {
                                            Debug.LogWarning("[AutoUploader] No working click path for this UIElements version — dialog left open.");
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        Debug.LogWarning($"[AutoUploader] Auto-click threw — skipping this dialog: {ex.Message}");
                                    }
                                }
                            }
                        }
                    }

                    // Auto-close known blocking popups
                    if (title.Contains("VRChat SDK") && title.Contains("Update"))
                    {
                        Debug.Log($"[AutoUploader] Closing popup: {title}");
                        window.Close();
                    }
                }
            }
            catch (Exception)
            {
                // Silently ignore — popup suppression is best-effort
            }
        }

        // Cached reflection handle for the internal Clickable.Invoke(EventBase).
        // Resolved once and reused; null means "not present in this UIElements
        // build" so we fall through to the public SendEvent path instead.
        private static MethodInfo _clickableInvoke;
        private static bool _clickableInvokeResolved;

        // Click a UIElements Button across Unity/UIElements versions. The
        // reflection path (private Clickable.Invoke) is the historically
        // reliable one for SDK modals, but its signature has shifted between
        // Unity 2019 and 2022. When it is absent or fails we fall back to the
        // public SendEvent API, which is stable but occasionally ignored by
        // custom manipulators — hence trying both. Returns true if a click was
        // dispatched by some path.
        private static bool TryClickButton(UnityEngine.UIElements.Button btn)
        {
            if (btn == null) return false;

            // Path 1: private Clickable.Invoke(EventBase) via a pooled submit event.
            if (!_clickableInvokeResolved)
            {
                _clickableInvoke = typeof(UnityEngine.UIElements.Clickable)
                    .GetMethod("Invoke", BindingFlags.NonPublic | BindingFlags.Instance);
                _clickableInvokeResolved = true;
            }
            if (_clickableInvoke != null && btn.clickable != null)
            {
                try
                {
                    using (var e = UnityEngine.UIElements.NavigationSubmitEvent.GetPooled())
                    {
                        _clickableInvoke.Invoke(btn.clickable, new object[] { e });
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[AutoUploader] Clickable.Invoke path failed, trying SendEvent: {ex.Message}");
                }
            }

            // Path 2: public, version-stable SendEvent with a pooled submit event.
            try
            {
                using (var e = UnityEngine.UIElements.NavigationSubmitEvent.GetPooled())
                {
                    e.target = btn;
                    btn.SendEvent(e);
                    return true;
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[AutoUploader] SendEvent click path failed: {ex.Message}");
            }

            return false;
        }
    }
}
