# VRChat PlayerPrefs / Registry Settings Reference

Generated on 2026-04-14 from:
- Registry snapshot: `HKCU\Software\VRChat\VRChat`
- IL2CPP stub export: `D:\WorkSpace\VRChat\VRChat_Data\il2cpp_dump_tools\output\src`

> Note
> The `src` export is a signature/RVA tree with empty method bodies, so the raw `PlayerPrefs` string literals are not preserved in plain C#. This report uses the live registry snapshot as the authoritative key list, then attaches the closest semantically relevant source file/line matches available from the dump. Treat `Source File:Line` as best-effort semantic anchors, not exact `PlayerPrefs.SetX/GetX(...)` expression lines.

Observed registry value count in the 2026-04-14 snapshot: **597**.

## Audio

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| AUDIO_GAME_AVATARS_ENABLED | AudioSettings | int (bool) | Avatar audio mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_AVATARS_STEAMAUDIO | AudioSettings | float | Avatar audio volume. | Current `2`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_PROPS_ENABLED | AudioSettings | int (bool) | Prop / object audio mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_PROPS_STEAMAUDIO | AudioSettings | float | Prop / object audio volume. | Raw DWORD `0xe0000000`; non-obvious float encoding. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_SFX_ENABLED | AudioSettings | int (bool) | World/game SFX mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_SFX_STEAMAUDIO | AudioSettings | float | World/game SFX volume. | Raw DWORD `0xa0000000`; non-obvious float encoding. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_VOICE_ENABLED | AudioSettings | int (bool) | Voice chat mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_GAME_VOICE_STEAMAUDIO | AudioSettings | float | Voice chat volume. | Raw DWORD `0xa0000000`; non-obvious float encoding. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_MASTER_ENABLED | AudioSettings | int (bool) | Master audio mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_MASTER_STEAMAUDIO | AudioSettings | float | Master output volume. | Current `0`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_UI_ENABLED | AudioSettings | int (bool) | UI sound mute toggle. | `0/1`; current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| AUDIO_UI_STEAMAUDIO | AudioSettings | float | UI sound volume. | Current `0`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:196<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:723 | Yes |
| ForceSettings_MicToggle | AudioSelectPreviousMicSelectNextMic_9619 | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `2`. | VRC/Audio/Audio.cs:75<br>VRC/Audio/Audio.cs:82 | Yes |
| ForceSettings_MigrateMicSettings | AudioSelectPreviousMicSelectNextMic_9619 | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | VRC/Audio/Audio.cs:75<br>VRC/Audio/Audio.cs:82 | Yes |
| VRC_ANDROID_MIC_MODE | AudioSelectPreviousMicSelectNextMic_9619 | int | VRC ANDROID MIC MODE. | Current `0`. | VRC/Audio/Audio.cs:75<br>VRC/Audio/Audio.cs:82 | Yes |
| VRC_EARMUFF_MODE | VRC EARMUFF MODE | int | VRC EARMUFF MODE. | Current `0`. | VRC/Core/Component/L.cs:1359<br>VRC/Core/Component/U_2.cs:387 | Yes |
| VRC_EARMUFF_MODE_AVATARS | GetAvatarsResult | int | VRC EARMUFF MODE AVATARS. | Current `1`. | Global/G.cs:139<br>Global/_Special_21.cs:339 | Yes |
| VRC_EARMUFF_MODE_CONE_VALUE | GetReachCone | float | VRC EARMUFF MODE CONE VALUE. | Current `0`. | ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:1677<br>ThirdParty/Unity/UnityEngine/R.cs:853 | Yes |
| VRC_EARMUFF_MODE_FALLOFF | GetFalloff | int | VRC EARMUFF MODE FALLOFF. | Current `0`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:179<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:180 | Yes |
| VRC_EARMUFF_MODE_FOLLOW_HEAD | ResetAudioHeadRotation | int (bool) | VRC EARMUFF MODE FOLLOW HEAD. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:181<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:247 | Yes |
| VRC_EARMUFF_MODE_LOCK_ROTATION | get_cursorLockBehavior | int (bool) | VRC EARMUFF MODE LOCK ROTATION. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:92<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:93 | Yes |
| VRC_EARMUFF_MODE_OFFSET_VALUE | GetStartOffset | float | VRC EARMUFF MODE OFFSET VALUE. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:1009<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:1347 | Yes |
| VRC_EARMUFF_MODE_RADIUS | iplUnitySetDirectivityFadeoutRadius | int | VRC EARMUFF MODE RADIUS. | Current `0`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:147<br>VRC/SDKBase/SDKBase.cs:345 | Yes |
| VRC_EARMUFF_MODE_REDUCED_VOLUME | CinemachineVolumeSettings | float | VRC EARMUFF MODE REDUCED VOLUME. | Raw DWORD `0xa0000000`; non-obvious float encoding. | ThirdParty/Cinemachine/Cinemachine/PostFX/PostFX.cs:33<br>ThirdParty/Unity/UnityEngine/Audio/Audio.cs:21 | Yes |
| VRC_EARMUFF_MODE_SHOW_ICON_IN_NAMEPLATE | GestureIcon | int (bool) | VRC EARMUFF MODE SHOW ICON IN NAMEPLATE. | `0/1`; current `1`. | Global/G.cs:104<br>ThirdParty/Other/Steamworks/Data/Data.cs:588 | Yes |
| VRC_EARMUFF_MODE_VISUAL_AIDE | BaseVisualElementScheduledItem | int | VRC EARMUFF MODE VISUAL AIDE. | Current `1`. | Global/B.cs:37<br>Global/S_2.cs:479 | Yes |
| VRC_HUD_MIC_OPACITY | AudioSelectPreviousMicSelectNextMic_9619 | float | Mic HUD opacity multiplier. | Current `0`. | VRC/Audio/Audio.cs:75<br>VRC/Audio/Audio.cs:82 | Yes |
| VRC_INPUT_DISABLE_MIC_BUTTON | TryDisableInputAction | int | Disables the in-game mic toggle button. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:158<br>ThirdParty/Unity/UnityEngine/InputSystem/Composites/Composites.cs:19 | Yes |
| VRC_INPUT_MIC_DEVICE_NAME_Desktop | GetAudioInputDeviceName | string | Input subsystem persisted setting. | Empty string / empty blob. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:881<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:894 | Yes |
| VRC_INPUT_MIC_DEVICE_NAME_VR | GetAudioInputDeviceName | string | Input subsystem persisted setting. | Empty string / empty blob. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:881<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:894 | Yes |
| VRC_INPUT_MIC_ENABLED | AudioSelectPreviousMicSelectNextMic_9619 | int (bool) | Master microphone enable toggle. | `0/1`; current `0`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510 | Yes |
| VRC_INPUT_MIC_LEVEL_DESK | UnityEngine.InputSystem.LowLevel.IEventMerger.MergeForward | int | Desktop microphone input gain / level. | Current `2684354560`. | ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:28<br>ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:29 | Yes |
| VRC_INPUT_MIC_LEVEL_VR | UnityEngine.InputSystem.LowLevel.IEventMerger.MergeForward | int | Input subsystem persisted setting. | Current `2684354560`. | ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:28<br>ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:29 | Yes |
| VRC_INPUT_MIC_MODE | AudioSelectPreviousMicSelectNextMic_9619 | int | Input subsystem persisted setting. | Current `1`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510 | Yes |
| VRC_INPUT_MIC_NOISE_GATE | AudioSelectPreviousMicSelectNextMic_9619 | int | Microphone noise gate threshold. | Current `1073741824`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Cinemachine/Cinemachine/Cinemachine.cs:1565 | Yes |
| VRC_INPUT_MIC_NOISE_SUPPRESSION | AudioSelectPreviousMicSelectNextMic_9619 | int | Input subsystem persisted setting. | Current `0`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Cinemachine/Cinemachine/Cinemachine.cs:1565 | Yes |
| VRC_INPUT_MIC_ON_JOIN | AudioSelectPreviousMicSelectNextMic_9619 | int | Input subsystem persisted setting. | Current `1`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510 | Yes |
| VRC_INPUT_TALK_DEFAULT_ON | DefaultInputActions | int | Default mic state when entering a session. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:65<br>ThirdParty/Unity/UnityEngine/UIElements/D.cs:47 | Yes |
| VRC_INPUT_TALK_TOGGLE | get_MaskInputToggle | int (bool) | Push-to-talk versus toggle-talk behavior. | `0/1`; current `1`. | VRC/UI/Elements/Menus/Menus.cs:134<br>VRC/UI/Elements/Menus/Menus.cs:122 | Yes |
| VRC_MIC_ICON_VISIBILITY | VRC MIC ICON VISIBILITY | int | VRC MIC ICON VISIBILITY. | Current `1`. | VRC/Core/Base/B_3.cs:674<br>VRC/Audio/Audio.cs:75 | Yes |
| VRC_MIC_TOGGLE_VOLUME | AudioSelectPreviousMicSelectNextMic_9619 | int (bool) | VRC MIC TOGGLE VOLUME. | `0/1`; current `0`. | VRC/Audio/Audio.cs:75<br>ThirdParty/Cinemachine/Cinemachine/PostFX/PostFX.cs:33 | Yes |
| VRC_USE_OUTLINE_MIC_ICON | VRC USE OUTLINE MIC ICON | int (bool) | VRC USE OUTLINE MIC ICON. | `0/1`; current `0`. | VRC/Core/Base/B_2.cs:1993<br>VRC/Audio/Audio.cs:75 | Yes |

## Graphics

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| FaceMirrorOwner | Face Mirror Owner | int | Face Mirror Owner. | Current `0`. | Global/M.cs:686<br>Global/P.cs:359 | Yes |
| FIELD_OF_VIEW | TargetFieldOfView | float | Desktop field of view override or slider value. | Current `0`. | ThirdParty/Other/UnityStandardAssets/Cameras/Cameras.cs:104<br>ThirdParty/Unity/UnityEngine/C.cs:180 | Yes |
| FPS_LIMIT | FPS LIMIT | int | Custom frame-rate cap. | Observed `310`. | VRC/Core/Base/B_2.cs:1854<br>VRC/Core/Base/B_3.cs:1593 | Yes |
| FPSCapType | FPSCap Type | int | Frame-rate cap mode selector. | Current `0`. | Unresolved | Yes |
| FPSType | FPSType | int | FPS display or FPS-mode selector. | Current `2`. | Unresolved | Yes |
| LOD_QUALITY | QualitySettings | int | Level-of-detail quality preset. | Current `1`. | ThirdParty/Unity/UnityEngine/Q.cs:8<br>ThirdParty/Unity/UnityEngine/T.cs:92 | Yes |
| PARTICLE_PHYSICS_QUALITY | PARTICLE PHYSICS QUALITY | int | Particle physics quality preset. | Current `2`. | VRC/Core/Base/B_2.cs:1855<br>VRC/Udon/Wrapper/Modules/E_6.cs:3139 | Yes |
| PersonalMirror.FaceMirrorOpacity | PersonalMirrorIcons | float | Face mirror opacity in VR. | Raw DWORD `0xe0000000`; non-obvious float encoding. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.FaceMirrorOpacityDesktop | PersonalMirrorIcons | float | Face mirror opacity on desktop. | Current `0`. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.FaceMirrorPosX | PersonalMirrorIcons | float | Face mirror X offset in VR. | Current `0`. | Global/P.cs:355<br>VRC/SDKBase/SDKBase.cs:758 | Yes |
| PersonalMirror.FaceMirrorPosXDesktop | PersonalMirrorIcons | float | Face mirror X offset on desktop. | Current `0`. | Global/P.cs:355<br>VRC/SDKBase/SDKBase.cs:758 | Yes |
| PersonalMirror.FaceMirrorPosY | PersonalMirrorIcons | float | Face mirror Y offset in VR. | Current `0`. | Global/P.cs:355<br>VRC/SDKBase/SDKBase.cs:758 | Yes |
| PersonalMirror.FaceMirrorPosYDesktop | PersonalMirrorIcons | float | Face mirror Y offset on desktop. | Current `0`. | Global/P.cs:355<br>VRC/SDKBase/SDKBase.cs:758 | Yes |
| PersonalMirror.FaceMirrorScale | PersonalMirrorIcons | float | Face mirror scale in VR. | Raw DWORD `0xe0000000`; non-obvious float encoding. | Global/P.cs:355<br>Global/M.cs:684 | Yes |
| PersonalMirror.FaceMirrorScaleDesktop | PersonalMirrorIcons | float | Face mirror scale on desktop. | Current `0`. | Global/P.cs:355<br>Global/M.cs:684 | Yes |
| PersonalMirror.FaceMirrorSpoutEnabled | Personal Mirror Face Mirror Spout Enabled | int (bool) | Personal mirror behavior or transform setting. | `0/1`; current `0`. | VRC/Core/Base/B_2.cs:1762<br>Global/P.cs:355 | Yes |
| PersonalMirror.FaceMirrorZoom | PersonalMirrorIcons | float | Face mirror zoom in VR. | Raw DWORD `0xe0000000`; non-obvious float encoding. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.FaceMirrorZoomDesktop | PersonalMirrorIcons | float | Face mirror zoom on desktop. | Raw DWORD `0x60000000`; non-obvious float encoding. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.Grabbable | PersonalMirrorIcons | int (bool) | Whether the personal mirror can be grabbed. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.ImmersiveMove | PersonalMirrorIcons | int (bool) | Immersive movement mode for the personal mirror. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.MirrorOpacity | PersonalMirrorIcons | float | Personal mirror opacity. | Current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.MirrorScaleX | PersonalMirrorIcons | float | Personal mirror X scale. | Current `0`. | Global/P.cs:355<br>Global/M.cs:684 | Yes |
| PersonalMirror.MirrorScaleY | PersonalMirrorIcons | float | Personal mirror Y scale. | Current `0`. | Global/P.cs:355<br>Global/M.cs:684 | Yes |
| PersonalMirror.MirrorSnapping | PersonalMirrorIcons | int | Mirror snap behavior. | Current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.MovementMode | PersonalMirrorIcons | int | Personal mirror movement / attachment mode. | Current `1`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.ShowBorder | PersonalMirrorIcons | int (bool) | Personal mirror behavior or transform setting. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.ShowCalibrationMirror | PersonalMirrorIcons | int (bool) | Personal mirror behavior or transform setting. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.ShowEnvironmentInMirror | PersonalMirrorIcons | int (bool) | Include environment in the personal mirror. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PersonalMirror.ShowFaceMirror | PersonalMirrorIcons | int (bool) | Show personal face mirror in VR. | `0/1`; current `0`. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.ShowFaceMirrorDesktop | PersonalMirrorIcons | int (bool) | Show personal face mirror on desktop. | `0/1`; current `0`. | Global/P.cs:355<br>Global/M.cs:686 | Yes |
| PersonalMirror.ShowRemotePlayerInMirror | PersonalMirrorIcons | int (bool) | Include remote players in the personal mirror. | `0/1`; current `0`. | Global/P.cs:355<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:3225 | Yes |
| PersonalMirror.ShowUIInMirror | PersonalMirrorIcons | int (bool) | Include UI in the personal mirror. | `0/1`; current `0`. | Global/P.cs:355<br>VRC/Core/Base/B_2.cs:1760 | Yes |
| PIXEL_LIGHT_COUNT | get_pixelLightCount | int | Maximum real-time pixel lights. | Current `3`. | ThirdParty/Unity/UnityEngine/L.cs:153<br>ThirdParty/Unity/UnityEngine/L.cs:154 | Yes |
| Screenmanager Fullscreen mode | _IsFullscreen | int | Unity display / fullscreen / window state. | Current `3`. | Global/_Special_16.cs:666<br>ThirdParty/Unity/UnityEngine/Rendering/PostProcessing/PostProcessing.cs:733 | Yes |
| Screenmanager Fullscreen mode Default | LoadDefaultSettings | int | Unity display / fullscreen / window state. | Current `3`. | ThirdParty/Other/TMPro/TMPro.cs:1115<br>ThirdParty/Other/TMPro/TMPro.cs:1642 | Yes |
| Screenmanager Resolution Height | GetAvatarEyeHeightAsMeters | int | Unity display / fullscreen / window state. | Current `967`. | VRC/SDKBase/SDKBase.cs:357<br>VRC/SDKBase/SDKBase.cs:358 | Yes |
| Screenmanager Resolution Height Default | get_isDefaultHeight | int | Unity display / fullscreen / window state. | Current `768`. | ThirdParty/Other/TMPro/TMPro.cs:2252<br>ThirdParty/Other/TMPro/TMPro.cs:1115 | Yes |
| Screenmanager Resolution Use Native | NativeDisableContainerSafetyRestrictionAttribute | int (bool) | Unity display / fullscreen / window state. | `0/1`; current `0`. | ThirdParty/Other/Unity/Collections/LowLevel/Unsafe/Unsafe.cs:167<br>Global/D_2.cs:72 | Yes |
| Screenmanager Resolution Use Native Default | LoadDefaultSettings | int (bool) | Unity display / fullscreen / window state. | `0/1`; current `1`. | ThirdParty/Other/TMPro/TMPro.cs:1115<br>ThirdParty/Other/TMPro/TMPro.cs:1642 | Yes |
| Screenmanager Resolution Width | Screenmanager Resolution Width | int | Unity display / fullscreen / window state. | Current `1902`. | VRC/SDKBase/SDKBase.cs:1252<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:559 | Yes |
| Screenmanager Resolution Width Default | get_isDefaultWidth | int | Unity display / fullscreen / window state. | Current `1024`. | ThirdParty/Other/TMPro/TMPro.cs:2251<br>ThirdParty/Other/TMPro/TMPro.cs:1115 | Yes |
| Screenmanager Resolution Window Height | _HideMirrorWindow | int | Unity display / fullscreen / window state. | Current `967`. | Global/_Special_16.cs:616<br>Global/_Special_16.cs:676 | Yes |
| Screenmanager Resolution Window Width | Screenmanager Resolution Window Width | int | Unity display / fullscreen / window state. | Current `1902`. | VRC/SDKBase/SDKBase.cs:1252<br>Global/_Special_16.cs:616 | Yes |
| Screenmanager Stereo 3D | GetTanFovAndOffsetForStereoEye | int | Unity display / fullscreen / window state. | Current `1`. | Global/O_2.cs:476<br>Global/S.cs:873 | Yes |
| Screenmanager Window Position X | get_useIPDInPositionTracking | float | Unity display / fullscreen / window state. | Raw DWORD `0x8`; non-obvious float encoding. | Global/O.cs:1558<br>Global/O.cs:1559 | Yes |
| Screenmanager Window Position Y | get_useIPDInPositionTracking | float | Unity display / fullscreen / window state. | Raw DWORD `0x1`; non-obvious float encoding. | Global/O.cs:1558<br>Global/O.cs:1559 | Yes |
| SHADOW_QUALITY | DynamicShadowSettings | int | Shadow quality preset. | Current `2`. | ThirdParty/Other/UnityStandardAssets/Utility/Utility.cs:66<br>ThirdParty/Unity/UnityEngine/Q.cs:8 | Yes |
| UnityGraphicsQuality | ExternUnityEngineAudioSettings | int | Preset graphics quality tier. | Observed `2`; paired label currently `High`. | VRC/Udon/Wrapper/Modules/E.cs:2288<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:139 | Yes |
| VRC_ADVANCED_GRAPHICS_ANTIALIASING | GraphicsSettings | int | Anti-aliasing sample count / preset. | Observed `4`; likely MSAA sample count / AA preset. | ThirdParty/Unity/UnityEngine/Rendering/Rendering.cs:266<br>Global/E_2.cs:185 | Yes |
| VRC_ADVANCED_GRAPHICS_QUALITY | QualitySettings | string | Advanced graphics quality preset label. | Observed `High`. | ThirdParty/Unity/UnityEngine/Q.cs:8<br>ThirdParty/Unity/UnityEngine/Rendering/Rendering.cs:266 | Yes |
| VRC_BLOOM_INTENSITY | Bloom | float | Bloom intensity override. | Current `0`. | ThirdParty/Unity/UnityEngine/Rendering/PostProcessing/PostProcessing.cs:31<br>Global/L.cs:105 | Yes |
| VRC_LANDSCAPE_FOV | VRC LANDSCAPE FOV | float | Mobile landscape field of view. | Current `0`. | VRC/Core/Base/B_2.cs:1853<br>Global/F.cs:443 | Yes |
| VRC_MIRROR_RESOLUTION | VRC MIRROR RESOLUTION | int | VRC MIRROR RESOLUTION. | Current `0`. | VRC/Core/Base/B_2.cs:1850<br>VRC/SDKBase/SDKBase.cs:738 | Yes |
| VRC_PORTRAIT_FOV | FovCache | int | Mobile portrait field of view. | Current `0`. | Global/F.cs:443<br>Global/F.cs:452 | Yes |
| VRC_TRACKING_ENABLE_SELFIE_FACE_TRACKING_AUTO_QUALITY | VRC TRACKING ENABLE SELFIE FACE TRACKING AUTO QUALITY | int | Tracking / calibration / FBT setting. | Current `1`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_SELFIE_FACE_TRACKING_QUALITY_LEVEL | VRC TRACKING SELFIE FACE TRACKING QUALITY LEVEL | int | Selfie face tracking quality preset. | Current `4`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |

## Network

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| BestRegionCache | get_IsBestRegion | int | Whether to cache and reuse the best-region choice. | Current `1`. | ThirdParty/Photon/Photon/Realtime/Realtime.cs:22<br>ThirdParty/Photon/Photon/Realtime/Realtime.cs:12 | Yes |
| LocationContext | WithNetworkCallingContext | int | Location Context. | Current `0`. | VRC/SDK3/UdonNetworkCalling/UdonNetworkCalling.cs:36<br>Global/A.cs:137 | Yes |
| LocationContext_World | WorldMetadata | string | Location Context World. | Empty string / empty blob. | VRC/Core/Networking/FlatBuffers/FlatBuffers32/FlatBuffers32.cs:699<br>VRC/Core/Networking/FlatBuffers/FlatBuffers32/FlatBuffers32.cs:726 | Yes |
| VRC_ASK_TO_PORTAL | PortalSkinMap | int | VRC ASK TO PORTAL. | Current `1`. | Global/P.cs:797<br>ThirdParty/Unity/UnityEngine/O.cs:96 | Yes |
| VRC_COMFORT_MODE_PRE_HOLOPORT | VRCAvatarDynamicsPreSchedule | int | VRC COMFORT MODE PRE HOLOPORT. | Current `0`. | Global/V_2.cs:14<br>VRC/VRC.cs:203 | Yes |
| VRC_HOME_REGION | BitRegion | int | Region used for home-world placement. | Observed `1`; small integer region enum. | Global/B.cs:104<br>Global/O.cs:1567 | Yes |
| VRC_ONLY_SHOW_FRIEND_JOIN_LEAVE_PORTAL_NOTIFICATIONS | VRC ONLY SHOW FRIEND JOIN LEAVE PORTAL NOTIFICATIONS | int (bool) | Restrict join/leave/portal notifications to friends. | `0/1`; current `1`. | ThirdParty/Oculus/Oculus/Platform/Platform.cs:579<br>VRC/Core/Base/B_2.cs:1991 | Yes |
| VRC_PORTAL_MODE_V2 | PortalSkinMap | int | VRC PORTAL MODE V2. | Current `0`. | Global/P.cs:797<br>ThirdParty/Unity/UnityEngine/O.cs:96 | Yes |
| VRC_RANDOMIZE_PORTAL | PortalSkinMap | int (bool) | VRC RANDOMIZE PORTAL. | `0/1`; current `0`. | Global/P.cs:797<br>Global/_Special_15.cs:396 | Yes |
| VRC_SELECTED_NETWORK_REGION | NetworkCallingViews | int | Preferred / selected Photon region. | Observed `0`; likely `Auto/Best` region selection. | VRC/Core/Networking/FlatBuffers/FlatBuffers32/FlatBuffers32.cs:724<br>VRC/Core/Networking/FlatBuffers/FlatBuffers32/FlatBuffers32.cs:746 | Yes |
| VRC_SHOW_PORTAL_NOTIFICATIONS | get_relatedNotificationsId | int (bool) | Show portal notifications. | `0/1`; current `0`. | ThirdParty/Other/Transmtn/DTO/Notifications/Notifications.cs:42<br>ThirdParty/Other/Transmtn/DTO/Notifications/Notifications.cs:43 | Yes |

## Avatars

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| AVATAR_WORN_HISTORY_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | AvatarProxySettings | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 600 bytes. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| avatarProxyAlwaysShowExplicit | AvatarProxySettings | int (bool) | Avatar visibility / download / fallback setting. | `0/1`; current `1`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| avatarProxyAlwaysShowFriends | AvatarProxySettings | int (bool) | Avatar visibility / download / fallback setting. | `0/1`; current `1`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| avatarProxyShowAtRange | AvatarProxySettings | int (bool) | Avatar visibility / download / fallback setting. | `0/1`; current `0`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| avatarProxyShowAtRangeToggle | AvatarProxySettings | int (bool) | Avatar visibility / download / fallback setting. | `0/1`; current `0`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| avatarProxyShowMaxNumber | AvatarProxySettings | int | Avatar visibility / download / fallback setting. | Current `80`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| currentShowMaxNumberOfAvatarsEnabled | GetMaxFrameNumber | int (bool) | current Show Max Number Of Avatars Enabled. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:273<br>VRC/SDK3/Avatars/Components/Components.cs:60 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseCustomAvatar | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Basic Trust Level Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseCustomAvatar | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Developer Trust Level Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Developer Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_Friend_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Friend Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_Friend_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Friend Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Known Trust Level Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseCustomAvatar | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Legend Trust Level Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseCustomAvatar | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Local Player Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseCustomAvatar | get_DependsOnLocalAvatarProcessing | int (bool) | Custom Trust Level Local Player Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Dynamics/Dynamics.cs:875<br>VRC/Dynamics/Dynamics.cs:876 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseCustomAvatar | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Custom Avatar. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseCustomAvatar | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Custom Avatar. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Negative Trust Level Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseCustomAvatar | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Custom Avatar. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Trusted Trust Level Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseCustomAvatar | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_Untrusted_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Untrusted Can Use Avatar Audio. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_Untrusted_CanUseCustomAvatar | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Untrusted Can Use Custom Avatar. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/SDKBase/Validation/Performance/Stats/Stats.cs:8 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseAvatarAudio | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Avatar Audio. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseCustomAvatar | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Custom Avatar. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseAvatarAudio | SetAvatarAudioCustomCurve | int (bool) | Custom Trust Level Veteran Trust Level Can Use Avatar Audio. | `0/1`; current `1`. | VRC/SDKBase/SDKBase.cs:349<br>VRC/Udon/Wrapper/Modules/E_8.cs:3925 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseCustomAvatar | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Custom Avatar. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>VRC/SDKBase/SDKBase.cs:349 | Yes |
| migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-HideAvatar | get_DependsOnLocalAvatarProcessing | int (bool) | migrated-local-pmods-userid-Hide Avatar. | `0/1`; current `1`. | VRC/Dynamics/Dynamics.cs:875<br>VRC/Dynamics/Dynamics.cs:876 | Yes |
| migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-ShowAvatar | get_DependsOnLocalAvatarProcessing | int (bool) | migrated-local-pmods-userid-Show Avatar. | `0/1`; current `1`. | VRC/Dynamics/Dynamics.cs:875<br>VRC/Dynamics/Dynamics.cs:876 | Yes |
| SortSelection_UGCAvatars | ResetTransparencySortSettings | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/C.cs:71<br>VRC/Udon/Wrapper/Modules/E.cs:3550 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_avatarProxyShowAtRange | AvatarProxySettings | float | Per-user scoped persisted UI or preferences data. | Raw DWORD `0xa0000000`; non-obvious float encoding. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_avatarProxyShowAtRangeToggle | AvatarProxySettings | int (bool) | Per-user scoped persisted UI or preferences data. | `0/1`; current `1`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_avatarProxyShowMaxNumber | AvatarProxySettings | int | Per-user scoped persisted UI or preferences data. | Current `15`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_currentShowMaxNumberOfAvatarsEnabled | GetMaxFrameNumber | int (bool) | Per-user scoped persisted UI or preferences data. | `0/1`; current `1`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:273<br>VRC/SDK3/Avatars/Components/Components.cs:60 | Yes |
| VRC_ALLOW_AVATAR_COPYING | get_allowAvatarCopying | int (bool) | VRC ALLOW AVATAR COPYING. | `0/1`; current `0`. | ThirdParty/Other/Transmtn/DTO/DTO.cs:101<br>ThirdParty/Other/Transmtn/DTO/DTO.cs:102 | Yes |
| VRC_AVATAR_FALLBACK_HIDDEN | SetAvatarFallbackPropertiesFromModel | int | Hide fallback avatars instead of showing them. | Current `0`. | VRC/Core/A.cs:758<br>VRC/UI/A.cs:8 | Yes |
| VRC_AVATAR_HAPTICS_ENABLED | AvatarProxySettings | int (bool) | Avatar visibility / download / fallback setting. | `0/1`; current `0`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE | VRC AVATAR MAXIMUM DOWNLOAD SIZE | int | Maximum compressed avatar download size allowed. | Observed `209715200` bytes (200 MiB). | VRC/Core/Base/B_2.cs:1776<br>VRC/Core/Component/L_2.cs:1122 | Yes |
| VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE | GetAvatarEyeHeightMaximumAsMeters | int | Maximum uncompressed avatar size allowed. | Observed `524288000` bytes (500 MiB). | VRC/SDKBase/SDKBase.cs:358<br>VRC/SDKBase/SDKBase.cs:363 | Yes |
| VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY | VRC AVATAR PERFORMANCE RATING MINIMUM TO DISPLAY | int | Minimum avatar performance rank still shown without fallback hiding. | Observed `5`; likely avatar performance enum threshold. | VRC/SDKBase/Validation/Performance/Performance.cs:10<br>VRC/SDKBase/SDKBase.cs:359 | Yes |
| VRC_DISABLE_AVATAR_CLONING_ON_ENTER_WORLD | VRC DISABLE AVATAR CLONING ON ENTER WORLD | int | VRC DISABLE AVATAR CLONING ON ENTER WORLD. | Current `0`. | VRC/Core/Base/B_3.cs:762<br>VRC/UI/A.cs:8 | Yes |
| VRC_FINGERTRACKING_AVATARS_USE | GetAvatarsResult | int (bool) | VRC FINGERTRACKING AVATARS USE. | `0/1`; current `1`. | Global/G.cs:139<br>Global/_Special_21.cs:339 | Yes |
| VRC_GESTURE_BAR_ENABLED | SetLightBarColor | int (bool) | VRC GESTURE BAR ENABLED. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:34<br>ThirdParty/Unity/UnityEngine/InputSystem/DualShock/DualShock.cs:36 | Yes |
| VRC_IK_AVATAR_MEASUREMENT_TYPE | AvatarProxySettings | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| VRC_IK_PER_AVATAR_CALIBRATION_ADJUSTMENT | AvatarProxySettings | float | Tracking / calibration / FBT setting. | Current `0`. | VRC/UI/A.cs:8<br>VRC/Avatar/Avatar.cs:22 | Yes |
| VRC_IMPOSTOR_WHEN_AVAILABLE | GetItemWhenAvailable | int | VRC IMPOSTOR WHEN AVAILABLE. | Current `1`. | ThirdParty/DotNet/System/Collections/Concurrent/Concurrent.cs:2545<br>ThirdParty/DotNet/System/Collections/Concurrent/Concurrent.cs:2576 | Yes |
| VRC_INPUT_SELECTED_SAFETY_RANK | InputSettings | string | Input subsystem persisted setting. | Current `Untrusted`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_PLAYER_GESTURE_TOGGLE | get_localMultiPlayerRoot | int (bool) | VRC PLAYER GESTURE TOGGLE. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:94<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:95 | Yes |
| VRC_SAFETY_LEVEL | SetSafetyLevel | int | Global avatar safety level preset. | Observed `2`; enum-backed safety preset. | VRC/SDK3/Internal/Internal.cs:36<br>VRC/SDK3/Internal/Internal.cs:37 | Yes |
| VRC_SHOW_SOCIAL_RANK | get_showSocialRank | int (bool) | VRC SHOW SOCIAL RANK. | `0/1`; current `1`. | VRC/Core/A.cs:680<br>VRC/Core/MajorSystem/MajorSystem.cs:342 | Yes |
| Wing_Right_Avatars_Category | OnRightClickCallback | string | Wing UI selection or sort state. | Current `Favorites0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:167<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:868 | Yes |
| Wing_Right_Avatars_SortBy | ResetTransparencySortSettings | string | Wing UI selection or sort state. | Current `Name`. | ThirdParty/Unity/UnityEngine/C.cs:71<br>VRC/Udon/Wrapper/Modules/E.cs:3550 | Yes |

## Comfort

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| PREF_HAND_TRACKING_TUTORIAL_COMPLETED | HandTrackingData | int | PREF HAND TRACKING TUTORIAL COMPLETED. | Current `0`. | Global/H.cs:108<br>Global/O.cs:953 | Yes |
| SeatedPlayEnabled | _GetSeatedZeroPoseToStandingAbsoluteTrackingPose | int (bool) | Seated Play Enabled. | `0/1`; current `0`. | Global/_Special_15.cs:869<br>Global/_Special_16.cs:456 | Yes |
| VRC_COMFORT_MODE | SetComfortTurning | int | VRC COMFORT MODE. | Current `0`. | VRC/SDK/Internal/Tutorial/Tutorial.cs:34<br>VRC/SDK3/Internal/Internal.cs:28 | Yes |
| VRC_FINGERTRACKING_SHOW_PINCHUI | VRC FINGERTRACKING SHOW PINCHUI | int (bool) | VRC FINGERTRACKING SHOW PINCHUI. | `0/1`; current `1`. | Unresolved | Yes |
| VRC_FINGERTRACKING_USE_EXCLUSIVE | ExclusiveOr | int (bool) | VRC FINGERTRACKING USE EXCLUSIVE. | `0/1`; current `0`. | ThirdParty/DotNet/System/Linq/Expressions/Expressions.cs:202<br>ThirdParty/DotNet/System/Linq/Expressions/Expressions.cs:203 | Yes |
| VRC_FINGERTRACKING_USE_GHOSTHAND | VRC FINGERTRACKING USE GHOSTHAND | int (bool) | VRC FINGERTRACKING USE GHOSTHAND. | `0/1`; current `0`. | Unresolved | Yes |
| VRC_IK_CALIBRATION_RANGE | VRC IK CALIBRATION RANGE | float | Tracking / calibration / FBT setting. | Raw DWORD `0xa0000000`; non-obvious float encoding. | VRC/Core/Base/B_3.cs:1907<br>VRC/Core/Component/L_9.cs:1410 | Yes |
| VRC_IK_CALIBRATION_VIS | _GetCalibrationState | float | Tracking / calibration / FBT setting. | Current `0`. | Global/_Special_16.cs:306<br>ThirdParty/Valve/Valve/VR/C.cs:79 | Yes |
| VRC_IK_DEBUG_LOGGING | __get_debug__UnityEngineAINavMeshBuildDebugSettings | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Udon/Wrapper/Modules/E_3.cs:3726<br>VRC/Udon/Wrapper/Modules/E_3.cs:3741 | Yes |
| VRC_IK_DISABLE_SHOULDER_TRACKING | DisableAutoXRCameraTracking | int (bool) | Disable shoulder tracking contribution. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/XR/XR.cs:198<br>VRC/Core/Base/B_3.cs:1900 | Yes |
| VRC_IK_FBT_CONFIRM_CALIBRATE | ShowConfirmQuitMenu | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `0`. | Global/O.cs:1475<br>ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:1762 | Yes |
| VRC_IK_FBT_LOCOMOTION | ShowLocomotionControls | int | Full-body-tracking locomotion toggle. | Current `1`. | VRC/SDK/Internal/Tutorial/Tutorial.cs:22<br>VRC/SDK3/Avatars/Components/Components.cs:14 | Yes |
| VRC_IK_FBT_SPINE_MODE | SetSpinePosition | int | Tracking / calibration / FBT setting. | Current `0`. | ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:97<br>ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:98 | Yes |
| VRC_IK_FREEZE_TRACKING_ON_DISCONNECT | VRC IK FREEZE TRACKING ON DISCONNECT | int | Freeze FBT pose when trackers disconnect. | Current `0`. | VRC/Core/Base/B_3.cs:1897<br>Global/H.cs:108 | Yes |
| VRC_IK_HEIGHT_RATIO | GetAvatarEyeHeightAsMeters | float | Tracking / calibration / FBT setting. | Current `-2`. | VRC/SDKBase/SDKBase.cs:357<br>VRC/SDKBase/SDKBase.cs:358 | Yes |
| VRC_IK_KNEE_ANGLE | VRC IK KNEE ANGLE | float | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1899<br>Global/C.cs:701 | Yes |
| VRC_IK_LEGACY | ToLegacyList | int | Tracking / calibration / FBT setting. | Current `0`. | Global/J.cs:10<br>Global/J.cs:89 | Yes |
| VRC_IK_LEGACY_CALIBRATION | VRC IK LEGACY CALIBRATION | float | Legacy full-body calibration path. | Current `0`. | Global/_Special_14.cs:667<br>VRC/Core/Base/B_3.cs:1905 | Yes |
| VRC_IK_ONE_HANDED_CALIBRATION | VRC IK ONE HANDED CALIBRATION | float | One-handed calibration flow toggle. | Current `0`. | VRC/Core/Base/B_2.cs:1985<br>VRC/UI/Elements/Elements.cs:45 | Yes |
| VRC_IK_SHOULDER_WIDTH_COMPENSATION | get_AudioFocusWidthDegrees | int (bool) | Shoulder-width compensation toggle. | `0/1`; current `1`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:559<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:560 | Yes |
| VRC_IK_TRACKER_MODEL | OnModelSkinSettingsHaveChanged | int | Tracking / calibration / FBT setting. | Current `0`. | ThirdParty/Valve/Valve/VR/S.cs:2741<br>Global/A_2.cs:163 | Yes |
| VRC_IK_USE_METRIC_HEIGHT | GetAvatarEyeHeightAsMeters | int (bool) | Use metric units for body calibration height. | `0/1`; current `0`. | VRC/SDKBase/SDKBase.cs:357<br>VRC/SDKBase/SDKBase.cs:358 | Yes |
| VRC_IK_WRIST_ANGLE | get_multiplyColliderForceByCollisionAngle | float | Tracking / calibration / FBT setting. | Current `0`. | Global/C.cs:701<br>Global/C.cs:702 | Yes |
| VRC_INPUT_COMFORT_TURNING | SetComfortTurning | int | Input subsystem persisted setting. | Current `0`. | VRC/SDK/Internal/Tutorial/Tutorial.cs:34<br>VRC/SDK3/Internal/Internal.cs:30 | Yes |
| VRC_INPUT_LOCOMOTION_METHOD | _GetOverlayInputMethod | int | Input subsystem persisted setting. | Current `0`. | Global/_Special_17.cs:236<br>Global/_Special_17.cs:726 | Yes |
| VRC_TRACKING_CAN_SHOW_SELFIE_FACE_TRACKING_POPUP | VRC TRACKING CAN SHOW SELFIE FACE TRACKING POPUP | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `1`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_CAN_SHOW_TRY_WEBCAM_FACE_TRACKING_BUTTON | VRC TRACKING CAN SHOW TRY WEBCAM FACE TRACKING BUTTON | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `1`. | VRC/Internal/Async/A_6.cs:1110<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_DISABLE_EYELIDTRACKING | DisableAutoXRCameraTracking | int | Tracking / calibration / FBT setting. | Current `0`. | ThirdParty/Unity/UnityEngine/XR/XR.cs:198<br>VRC/Core/Base/B_3.cs:1900 | Yes |
| VRC_TRACKING_DISABLE_EYELOOKTRACKING | DisableAutoXRCameraTracking | int | Tracking / calibration / FBT setting. | Current `0`. | ThirdParty/Unity/UnityEngine/XR/XR.cs:198<br>VRC/Core/Base/B_3.cs:1900 | Yes |
| VRC_TRACKING_DISABLE_EYETRACKING_ON_MUTE | DisableAutoXRCameraTracking | int | Tracking / calibration / FBT setting. | Current `0`. | ThirdParty/Unity/UnityEngine/XR/XR.cs:198<br>VRC/Core/Base/B_3.cs:1900 | Yes |
| VRC_TRACKING_DISPLAY_EYETRACKING_DEBUG | __get_debug__UnityEngineAINavMeshBuildDebugSettings | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `0`. | VRC/Udon/Wrapper/Modules/E_3.cs:3726<br>VRC/Udon/Wrapper/Modules/E_3.cs:3741 | Yes |
| VRC_TRACKING_ENABLE_SELFIE_FACE_TRACKING | VRC TRACKING ENABLE SELFIE FACE TRACKING | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_ENABLE_SELFIE_HAND_TRACKING | VRC TRACKING ENABLE SELFIE HAND TRACKING | int | Tracking / calibration / FBT setting. | Current `1`. | VRC/Core/Base/B_3.cs:1902<br>Global/H.cs:108 | Yes |
| VRC_TRACKING_FORCE_EYETRACKING_RAYCAST | HandTrackingData | int | Tracking / calibration / FBT setting. | Current `0`. | Global/H.cs:108<br>Global/O.cs:90 | Yes |
| VRC_TRACKING_FORCE_EYETRACKING_RAYCAST_DESKTOP2 | HandTrackingData | int | Tracking / calibration / FBT setting. | Current `0`. | Global/H.cs:108<br>Global/O.cs:90 | Yes |
| VRC_TRACKING_GRACEFUL_QUIT | HandTrackingData | int | Tracking / calibration / FBT setting. | Current `1`. | Global/H.cs:108<br>Global/O.cs:90 | Yes |
| VRC_TRACKING_NUM_TIMES_DISABLED_SELFIE_FACE_TRACKING | VRC TRACKING NUM TIMES DISABLED SELFIE FACE TRACKING | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_NUM_TIMES_ENABLED_SELFIE_FACE_TRACKING | VRC TRACKING NUM TIMES ENABLED SELFIE FACE TRACKING | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_NUM_TIMES_REFUSED_SELFIE_FACE_TRACKING_POPUP | VRC TRACKING NUM TIMES REFUSED SELFIE FACE TRACKING POPUP | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_NUM_TIMES_REFUSED_SELFIE_FACE_TRACKING_POPUP_VRC_PLUS | VRC TRACKING NUM TIMES REFUSED SELFIE FACE TRACKING POPUP VRC PLUS | int (bool) | Tracking / calibration / FBT setting. | `0/1`; current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_NUM_TIMES_SELFIE_FACE_TRACKING_POPUP_VRC_PLUS_CLICKED | VRC TRACKING NUM TIMES SELFIE FACE TRACKING POPUP VRC PLUS CLICKED | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1902<br>Global/O.cs:415 | Yes |
| VRC_TRACKING_SELFIE_FACE_TRACKING_RECENTER_SPEED | VRC TRACKING SELFIE FACE TRACKING RECENTER SPEED | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1902<br>VRC/Core/Base/B_3.cs:1903 | Yes |
| VRC_TRACKING_SEND_VR_SYSTEM_HEAD_AND_WRIST_OSC_DATA | HandTrackingData | int | Send headset/wrist tracking over OSC. | Current `0`. | Global/H.cs:108<br>Global/T_2.cs:279 | Yes |
| VRC_TRACKING_SHOULD_SHOW_OSC_TRACKING_DATA_REMINDER | HandTrackingData | int (bool) | Show OSC tracking data reminder prompt. | `0/1`; current `1`. | Global/H.cs:108<br>Global/T_2.cs:279 | Yes |
| VRC_TRACKING_TRACKER_PREDICTION | VRC TRACKING TRACKER PREDICTION | int | Tracking / calibration / FBT setting. | Current `0`. | VRC/Core/Base/B_3.cs:1898<br>Global/H.cs:108 | Yes |

## Input

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| UI.Settings.Osc | AvatarOscConfig | int | OSC settings landing / feature toggle state. | Current `0`. | Global/A.cs:424<br>ThirdParty/OscCore/OscCore/OscCore.cs:139 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_DroneControllerSettings | GearVRTrackedController | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 475 bytes. | ThirdParty/Other/Unity/XR/Oculus/Input/Input.cs:8<br>ThirdParty/Other/Unity/XR/Oculus/Input/Input.cs:105 | Yes |
| VRC_ACTION_MENU_ONE_HAND_MOVE | ActionSettings | int | VRC ACTION MENU ONE HAND MOVE. | Current `1`. | Global/A_2.cs:6<br>ThirdParty/Unity/UnityEngine/InputSystem/Composites/Composites.cs:19 | Yes |
| VRC_DOUBLE_TAP_MAIN_MENU_STEAMVR2 | DoubleControl | int | VRC DOUBLE TAP MAIN MENU STEAMVR2. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/Controls/Controls.cs:85<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:65 | Yes |
| VRC_FINGER_GRAB_SETTING | Finger | int | VRC FINGER GRAB SETTING. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:23<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:77 | Yes |
| VRC_FINGER_HAPTIC_SENSITIVITY | Finger | float | VRC FINGER HAPTIC SENSITIVITY. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:23<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:77 | Yes |
| VRC_FINGER_HAPTIC_STRENGTH | GetFingerPinchStrength | int | VRC FINGER HAPTIC STRENGTH. | Current `0`. | Global/O_2.cs:212<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:23 | Yes |
| VRC_FINGER_JUMP_ENABLED | Finger | int (bool) | VRC FINGER JUMP ENABLED. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:23<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:77 | Yes |
| VRC_FINGER_WALK_SETTING | Finger | int | VRC FINGER WALK SETTING. | Current `3`. | ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:23<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:77 | Yes |
| VRC_HANDS_MENU_OPEN_MODE | OpenVRSettings | int | VRC HANDS MENU OPEN MODE. | Current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:197<br>ThirdParty/Unity/UnityEngine/InputSystem/LowLevel/LowLevel.cs:365 | Yes |
| VRC_INPUT_DAYDREAM | InputSettings | int | Input subsystem persisted setting. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_EMBODIED | InputSettings | int | Input subsystem persisted setting. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_GAZE | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_GENERIC | VRC INPUT GENERIC | int | Input subsystem persisted setting. | Current `1`. | Global/P_2.cs:42<br>Global/_Special_10.cs:934 | Yes |
| VRC_INPUT_HPMOTION | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_MOBILE_INTERACTION_MODE | MobileInput | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/PlatformSpecific/PlatformSpecific.cs:8<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2153 | Yes |
| VRC_INPUT_OPENXR | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_OSC | InputSettings | int | OSC input/output enabled. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_PERSONAL_SPACE | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_QUEST_HANDS | InputSettings | int | Input subsystem persisted setting. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_SHOW_TOOLTIPS | InputSettings | int (bool) | Input subsystem persisted setting. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_STEAMVR2 | InputSettings | int | Input subsystem persisted setting. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_THIRD_PERSON_ROTATION | CompensateRotationProcessor | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/Processors/Processors.cs:35<br>VRC/Core/Base/B_3.cs:1707 | Yes |
| VRC_INPUT_TOUCH | TouchControl | int | Input subsystem persisted setting. | Current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/Controls/Controls.cs:170<br>ThirdParty/Unity/UnityEngine/InputSystem/Controls/Controls.cs:211 | Yes |
| VRC_INPUT_VALVE_INDEX | get_ForceAudioInputDeviceIndex | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:334<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:335 | Yes |
| VRC_INPUT_VIVE | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_VIVE_ADVANCED | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INPUT_WAVE | InputSettings | int | Input subsystem persisted setting. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:2510<br>ThirdParty/Unity/UnityEngine/InputSystem/Users/Users.cs:104 | Yes |
| VRC_INVERT_CONTROLLER_VERTICAL_LOOK | LookAtController | int | VRC INVERT CONTROLLER VERTICAL LOOK. | Current `0`. | ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:1449<br>ThirdParty/RealisticEyeMovements/RealisticEyeMovements/RealisticEyeMovements.cs:155 | Yes |
| VRC_INVERTED_MOUSE | SetVirtualMousePositionX | int (bool) | VRC INVERTED MOUSE. | `0/1`; current `0`. | ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:65<br>ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:66 | Yes |
| VRC_MOUSE_SENSITIVITY | SetVirtualMousePositionX | int (bool) | VRC MOUSE SENSITIVITY. | `0/1`; current `0`. | ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:65<br>ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:66 | Yes |
| VRC_SHOW_FRIEND_REQUESTS | FetchFriendRequests | int (bool) | Show friend-request notifications. | `0/1`; current `1`. | ThirdParty/Other/Transmtn/Transmtn.cs:258<br>ThirdParty/Oculus/Oculus/Platform/Models/Models.cs:294 | Yes |
| VRC_TOUCH_AUTO_ROTATE_SPEED | OculusTouchController | int | VRC TOUCH AUTO ROTATE SPEED. | Current `0`. | ThirdParty/Other/Unity/XR/Oculus/Input/Input.cs:105<br>ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:8 | Yes |
| VRC_TOUCH_SENSITIVITY | OculusTouchController | float | VRC TOUCH SENSITIVITY. | Raw DWORD `0xe0000000`; non-obvious float encoding. | ThirdParty/Other/Unity/XR/Oculus/Input/Input.cs:105<br>ThirdParty/Other/UnityStandardAssets/CrossPlatformInput/CrossPlatformInput.cs:8 | Yes |
| VRC_USE_GENERIC_INSTANCE_NAMES | CreateInstanceForAnotherGenericParameter | int (bool) | VRC USE GENERIC INSTANCE NAMES. | `0/1`; current `0`. | ThirdParty/DotNet/System/R.cs:721<br>ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:1274 | Yes |

## UI

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| BACKGROUND_MATERIAL_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | get_deselectOnBackgroundClick | string | Per-user scoped persisted UI or preferences data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:88<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:89 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseEmojiStickersSharing | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Basic Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseEmojiStickersSharing | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Developer Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Developer Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_Friend_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Friend Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_Friend_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Friend Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Known Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseEmojiStickersSharing | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Legend Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseEmojiStickersSharing | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Local Player Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Local Player Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Animated Emoji. | `0/1`; current `0`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseEmojiStickersSharing | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Emoji Stickers Sharing. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Animated Emoji. | `0/1`; current `0`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseEmojiStickersSharing | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Emoji Stickers Sharing. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Negative Trust Level Can Use Animated Emoji. | `0/1`; current `0`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseEmojiStickersSharing | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Trusted Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseEmojiStickersSharing | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_Untrusted_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Untrusted Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_Untrusted_CanUseEmojiStickersSharing | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Untrusted Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseAnimatedEmoji | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Animated Emoji. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseEmojiStickersSharing | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseAnimatedEmoji | set_OwnerCanUseAnimatedEmoji | int (bool) | Custom Trust Level Veteran Trust Level Can Use Animated Emoji. | `0/1`; current `1`. | VRC/UI/Client/Emoji/Emoji.cs:29<br>VRC/UI/Client/Emoji/Emoji.cs:42 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseEmojiStickersSharing | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Emoji Stickers Sharing. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>VRC/UI/Client/Emoji/Emoji.cs:29 | Yes |
| FOLDOUT_STATES | FilterPointerStatesByType | string | FOLDOUT STATES. | Current `1242245536`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:175<br>VRC/UI/Core/Core.cs:8 | Yes |
| ForceSettings_ClearFoldoutPrefKeys | Force Settings Clear Foldout Pref Keys | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | Global/_Special.cs:655<br>Global/_Special.cs:656 | Yes |
| has_opened_live_now_page | HasCameraDeviceOpened | int (bool) | has opened live now page. | `0/1`; current `0`. | Global/O.cs:1629<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:154 | Yes |
| HasSeenCameraDollyUserCameraCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | HasUserAuthorisationToCaptureAudio | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:452<br>Global/O.cs:1629 | Yes |
| HasSeenHolidayEvent2025QMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | HasNoActions | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:154<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:1312 | Yes |
| HasSeenShopRabbidsQMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | HasNoActions | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:154<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:1312 | Yes |
| HasSeenVRCPlusExclusiveItemsQMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | Has Seen VRCPlus Exclusive Items QMCalloutuserid | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `1`. | Global/_Special_21.cs:450<br>Global/_Special_21.cs:451 | Yes |
| RECENTLY_VISITED_HISTORY_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | RECENTLY VISITED HISTORY userid | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 5015 bytes. | Global/_Special_14.cs:458<br>ThirdParty/Cinemachine/Cinemachine/Utility/Utility.cs:155 | Yes |
| SortSelection_AllFriends | SortAllTables | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Other/TMPro/TMPro.cs:477<br>ThirdParty/Unity/UnityEngine/TextCore/Text/Text.cs:117 | Yes |
| SortSelection_Authored | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_Favorites0 | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_FriendLocations | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_GroupActivity | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_InRoom | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_Recent | Sort | int | Stored sort option for a specific list or browser page. | Current `3`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_Sdk | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_UGCPlaylist1 | Sort | int (bool) | Stored sort option for a specific list or browser page. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_UGCWorlds | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| SortSelection_WorldInstances | Sort | int | Stored sort option for a specific list or browser page. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:34<br>ThirdParty/Unity/UnityEngine/UI/Collections/Collections.cs:65 | Yes |
| UI.Emojis.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.Emojis.CustomGroup1 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.Emojis.CustomGroup2 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.MenuPlacementZDepthVR | set_MenuPlacementZDepthVR | int | UI state or feature preference. | Current `1073741824`. | VRC/UI/Elements/Elements.cs:15<br>VRC/UI/Elements/Elements.cs:25 | Yes |
| UI.MotionSmoothingEnabled | _IsMotionSmoothingEnabled | int (bool) | UI state or feature preference. | `0/1`; current `1`. | Global/_Special_17.cs:526<br>Global/_Special_17.cs:536 | Yes |
| UI.Props.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.Stickers.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.Stickers.CustomGroup1 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.Stickers.CustomGroup2 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| UI.usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726.WingState | ReadDeviceState | string | UI state or feature preference. | Current `0_0_1_0___Explore_`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:48<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:188 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_has_opened_live_now_page | HasCameraDeviceOpened | int (bool) | Per-user scoped persisted UI or preferences data. | `0/1`; current `1`. | Global/O.cs:1629<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:154 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_UI.Emojis.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | JSON/string blob; current length 28 bytes. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_UI.Props.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | JSON/string blob; current length 28 bytes. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_UI.RecentlyUsedEmojis | TouchScreenKeyboardShouldBeUsed | string | Persisted recent-history or saved-list UI data. | JSON/string blob; current length 26 bytes. | ThirdParty/Unity/UnityEngine/UI/UI.cs:850<br>Global/E_2.cs:159 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_UI.RecentlyUsedStickers | TouchScreenKeyboardShouldBeUsed | string | Persisted recent-history or saved-list UI data. | JSON/string blob; current length 26 bytes. | ThirdParty/Unity/UnityEngine/UI/UI.cs:850<br>Global/E_2.cs:159 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_UI.Stickers.CustomGroup0 | SetToCustomIfContentTypeIsNot | string | Custom emoji / sticker / prop grouping data. | JSON/string blob; current length 28 bytes. | ThirdParty/Unity/UnityEngine/UI/UI.cs:935<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:936 | Yes |
| VRC.UI.QuickMenu.ShowQMDebugInfo | PassLoginInfo | int (bool) | VRC UI Quick Menu Show QMDebug Info. | `0/1`; current `0`. | VRC/UI/U.cs:622<br>ThirdParty/Unity/UnityEngine/UIElements/C.cs:80 | Yes |
| VRC_ACTION_MENU_L_HUD_ANGLE_X | SwapAction | float | VRC ACTION MENU L HUD ANGLE X. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_ACTION_MENU_L_HUD_ANGLE_Y | SwapAction | float | VRC ACTION MENU L HUD ANGLE Y. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_ACTION_MENU_L_SHOW_ON_HUD | SwapAction | int (bool) | VRC ACTION MENU L SHOW ON HUD. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_ACTION_MENU_R_HUD_ANGLE_X | SwapAction | float | VRC ACTION MENU R HUD ANGLE X. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_ACTION_MENU_R_HUD_ANGLE_Y | SwapAction | float | VRC ACTION MENU R HUD ANGLE Y. | Current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_ACTION_MENU_R_SHOW_ON_HUD | SwapAction | int (bool) | VRC ACTION MENU R SHOW ON HUD. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:157 | Yes |
| VRC_BOOP_EMOJI_EFFECT_ENABLED | BaseMeshEffect | int (bool) | VRC BOOP EMOJI EFFECT ENABLED. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:60<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:1179 | Yes |
| VRC_CLOCK_VARIANT | VRC CLOCK VARIANT | int (bool) | VRC CLOCK VARIANT. | `0/1`; current `0`. | VRC/UI/U.cs:148<br>Global/_Special_18.cs:156 | Yes |
| VRC_COLOR_FILTER_INTENSITY | ColorBlock | float | Color filter strength. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:182<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:190 | Yes |
| VRC_COLOR_FILTER_SELECTION | ColorBlock | int | Selected color filter preset. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:182<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:190 | Yes |
| VRC_COLOR_FILTER_TO_WORLD | ColorBlock | int | Apply color filter to the rendered world, not just UI. | Current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:182<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:190 | Yes |
| VRC_ENABLE_GROUP_INTEREST_AUTO_NOTIFICATIONS | AutoEnableActionSet | int | VRC ENABLE GROUP INTEREST AUTO NOTIFICATIONS. | Current `1`. | ThirdParty/Valve/Valve/VR/S.cs:2119<br>ThirdParty/Unity/UnityEngine/InputSystem/UI/UI.cs:151 | Yes |
| VRC_GROUP_ON_NAMEPLATE | GridLayoutGroup | string | VRC GROUP ON NAMEPLATE. | Empty string / empty blob. | ThirdParty/Unity/UnityEngine/UI/UI.cs:494<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:523 | Yes |
| VRC_HIDE_NOTIFICATION_PHOTOS | Hide | int (bool) | Hide image previews in notifications. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:314<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:775 | Yes |
| VRC_HUD_ANCHOR | get_selectionAnchorPosition | int | HUD anchor position selector. | Current `1`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:833<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:834 | Yes |
| VRC_HUD_MODE | HudLayout | int | HUD layout / visibility mode. | Current `0`. | Global/H.cs:601<br>Global/M.cs:676 | Yes |
| VRC_HUD_OPACITY | HudLayout | float | HUD opacity multiplier. | Current `0`. | Global/H.cs:601<br>Global/O.cs:1412 | Yes |
| VRC_HUD_SMOOTHING_Desktop | set_MotionSmoothingEnabled | int | HUD placement or visibility setting. | Current `0`. | VRC/UI/Elements/Elements.cs:53<br>VRC/UI/Elements/Elements.cs:58 | Yes |
| VRC_HUD_SMOOTHING_VR | set_MotionSmoothingEnabled | int | HUD placement or visibility setting. | Current `0`. | VRC/UI/Elements/Elements.cs:53<br>VRC/UI/Elements/Elements.cs:58 | Yes |
| VRC_MOBILE_NOTIFICATIONS_SERVICE_ENABLED | set_shouldHideMobileInput | int (bool) | VRC MOBILE NOTIFICATIONS SERVICE ENABLED. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:775<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:776 | Yes |
| VRC_NAMEPLATE_FALLBACK_ICON_VISIBLE | IsSelectionVisible | int (bool) | Nameplate presentation setting. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:890<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:926 | Yes |
| VRC_NAMEPLATE_MODE | VRC NAMEPLATE MODE | int | Primary nameplate display mode. | Current `0`. | VRC/Core/Base/B_2.cs:1986<br>VRC/Core/Component/L_2.cs:92 | Yes |
| VRC_NAMEPLATE_OPACITY | get_textureOpacity | float | Nameplate opacity multiplier. | Raw DWORD `0xa0000000`; non-obvious float encoding. | Global/O.cs:1412<br>Global/O.cs:1413 | Yes |
| VRC_NAMEPLATE_QUICK_MENU_INFO | PassLoginInfo | int | Nameplate presentation setting. | Current `1`. | VRC/UI/U.cs:622<br>ThirdParty/Unity/UnityEngine/UIElements/C.cs:80 | Yes |
| VRC_NAMEPLATE_SCALE_V2 | get_ignoreTimeScale | float | Nameplate scale multiplier. | Raw DWORD `0x2`; non-obvious float encoding. | ThirdParty/Unity/UnityEngine/UI/CoroutineTween/CoroutineTween.cs:12<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:98 | Yes |
| VRC_NAMEPLATE_STATUS_MODE | VRC NAMEPLATE STATUS MODE | int | Extra status line content shown on nameplates. | Current `0`. | VRC/UI/U.cs:166<br>ThirdParty/Unity/UnityEngine/UIElements/E.cs:63 | Yes |
| VRC_PLAY_NOTIFICATION_AUDIO | PlayFootStepAudio | int (bool) | Play notification sound effects. | `0/1`; current `1`. | ThirdParty/Other/UnityStandardAssets/Characters/FirstPerson/FirstPerson.cs:29<br>ThirdParty/Other/UnityStandardAssets/Vehicles/Car/Car.cs:164 | Yes |
| VRC_SHOW_INVITES_NOTIFICATION | ApiBundleDropNotificationDetails | int (bool) | Show invite notifications. | `0/1`; current `1`. | Global/A_2.cs:163<br>Global/A_2.cs:201 | Yes |
| VRC_SHOW_JOIN_NOTIFICATIONS | VRC SHOW JOIN NOTIFICATIONS | int (bool) | Show friend join notifications. | `0/1`; current `1`. | ThirdParty/Oculus/Oculus/Platform/Platform.cs:579<br>ThirdParty/Oculus/Oculus/Platform/Platform.cs:588 | Yes |
| VRC_SHOW_LEAVE_NOTIFICATIONS | SendEnterLeave | int (bool) | Show friend leave notifications. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/UIElements/M.cs:73<br>ThirdParty/Unity/UnityEngine/UIElements/P.cs:361 | Yes |
| VRC_TIME_FORMAT_MODE | TryFormatDateTimeG | int | VRC TIME FORMAT MODE. | Current `0`. | ThirdParty/DotNet/System/Buffers/Text/Text.cs:14<br>ThirdParty/DotNet/System/Buffers/Text/Text.cs:15 | Yes |
| VRC_USE_COLOR_FILTER | ColorBlock | int (bool) | Enable color filter accessibility pass. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:182<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:190 | Yes |
| VRC_USE_PIXEL_SHIFTING_HUD | HandleConstantPixelSize | int (bool) | VRC USE PIXEL SHIFTING HUD. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/UI/UI.cs:124<br>ThirdParty/Unity/UnityEngine/UI/UI.cs:428 | Yes |
| VRC_WING_PERSISTENCE_ENABLED | get_enableViewDataPersistence | int (bool) | VRC WING PERSISTENCE ENABLED. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/UIElements/V.cs:271<br>ThirdParty/Unity/UnityEngine/UIElements/V.cs:272 | Yes |

## Privacy

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| BACKGROUND_DEBUG_LOG_COLLECTION | ServiceCollectionDebugView | int | Background debug log collection toggle. | Current `0`. | Global/S_2.cs:371<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:776 | Yes |
| VRC_ALLOW_DISCORD_FRIENDS | get_hasDiscordFriendsOptOut | int (bool) | Allow Discord friends integration. | `0/1`; current `1`. | VRC/Core/A.cs:609<br>VRC/Core/A.cs:610 | Yes |
| VRC_ALLOW_FOCUS_VIEW | VRC ALLOW FOCUS VIEW | int (bool) | VRC ALLOW FOCUS VIEW. | `0/1`; current `1`. | VRC/Core/Networking/Networking.cs:487<br>Global/X.cs:35 | Yes |
| VRC_ALLOW_UNTRUSTED_URL | get_currentAvatarImageUrl | int (bool) | Allow opening untrusted URLs. | `0/1`; current `1`. | ThirdParty/Other/Transmtn/DTO/DTO.cs:69<br>ThirdParty/Other/Transmtn/DTO/DTO.cs:70 | Yes |

## Other

| PlayerPrefs Key | C# Name | Type | Meaning | Values / Range | Source File:Line | Present in Reg |
|---|---|---|---|---|---|---|
| 14C4B06B824EC593239362517F538B29 | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `7pbKQasgtPLdm162Xwaw6w==`. | Unresolved | Yes |
| 5F4DCC3B5AA765D61D8327DEB882CF99 | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `uWu6Ntw3bQWEfrULA/x1Bw==`. | Unresolved | Yes |
| 785C2BDD2C43070A10BC35E5E687A467 | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `2UIMljFOq2wnM8hL3omr3YfvULeTVqiC0uOM8fJv1oHQQ...`. | Unresolved | Yes |
| 93D3AE97F80BEDA8E396065DC4770A93 | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `XLV96Ss0ykq57BTRBdDawQ==`. | Unresolved | Yes |
| BCD9D91ED8D8F1926B20D3D620647C8E | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `ezKSQfQwGMlon2rMIwtprg==`. | Unresolved | Yes |
| BD2E932A03A19217AB5A1DFB5AA93340 | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `dV9StiUFmGEuIJK3Xy9xAE7xR3MZayEZ0qyyd3WZQyoIi...`. | Unresolved | Yes |
| COLOR_PALETTES_CURRENT_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | PlayerSupportsLinearColorSpace | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 150 bytes. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:195<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:1146 | Yes |
| CosmeticsSectionRedirect_Settings | BoolChildrenSection | int | Cosmetics Section Redirect Settings. | Current `0`. | Global/B.cs:179<br>Global/C.cs:260 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level1 Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Custom Shaders. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Particle Systems. | `0/1`; current `1`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel1_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Advanced Trust Level1 Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level2 Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Custom Shaders. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Particle Systems. | `0/1`; current `1`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_AdvancedTrustLevel2_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Advanced Trust Level2 Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanSpeak | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseCustomAnimations | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseCustomShaders | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseDrone | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseParticleSystems | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseTriggers | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel1_CanUseUserIcons | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level1 Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanSpeak | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseCustomAnimations | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseCustomShaders | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseDrone | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseParticleSystems | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseTriggers | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:672<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_BasicTrustLevel_CanUseUserIcons | get_hasBasicTrustLevel | int (bool) | Custom Trust Level Basic Trust Level Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:672<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Developer Trust Level Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Developer Trust Level Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Developer Trust Level Can Use Custom Shaders. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Developer Trust Level Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Developer Trust Level Can Use Particle Systems. | `0/1`; current `1`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Developer Trust Level Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_DeveloperTrustLevel_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Developer Trust Level Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_Friend_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Friend Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Friend_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Friend Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Friend_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Friend Can Use Custom Shaders. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Friend_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Friend Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Friend_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Friend Can Use Particle Systems. | `0/1`; current `1`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_Friend_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Friend Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Friend_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Friend Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Custom Shaders. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Particle Systems. | `0/1`; current `0`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel1_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Intermediate Trust Level1 Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Custom Shaders. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Particle Systems. | `0/1`; current `0`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_IntermediateTrustLevel2_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Intermediate Trust Level2 Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanSpeak | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseCustomAnimations | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Custom Animations. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseCustomShaders | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:673<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseDrone | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseParticleSystems | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:673<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseTriggers | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use Triggers. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_KnownTrustLevel_CanUseUserIcons | get_hasKnownTrustLevel | int (bool) | Custom Trust Level Known Trust Level Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:673<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanSpeak | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseCustomAnimations | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Custom Animations. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseCustomShaders | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Custom Shaders. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseDrone | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseParticleSystems | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Particle Systems. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseTriggers | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use Triggers. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_LegendTrustLevel_CanUseUserIcons | get_hasLegendTrustLevel | int (bool) | Custom Trust Level Legend Trust Level Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:676<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| CustomTrustLevel_LocalPlayer_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Local Player Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Local Player Can Use Custom Animations. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Local Player Can Use Custom Shaders. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Local Player Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Local Player Can Use Particle Systems. | `0/1`; current `1`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Local Player Can Use Triggers. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_LocalPlayer_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Local Player Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanSpeak | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Speak. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseCustomAnimations | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseCustomShaders | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseDrone | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Drone. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseParticleSystems | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseTriggers | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel1_CanUseUserIcons | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level1 Can Use User Icons. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanSpeak | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Speak. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseCustomAnimations | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseCustomShaders | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseDrone | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Drone. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseParticleSystems | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseTriggers | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel2_CanUseUserIcons | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level2 Can Use User Icons. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanSpeak | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Speak. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseCustomAnimations | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseCustomShaders | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseDrone | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Drone. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseParticleSystems | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseTriggers | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_NegativeTrustLevel_CanUseUserIcons | get_hasNegativeTrustLevel | int (bool) | Custom Trust Level Negative Trust Level Can Use User Icons. | `0/1`; current `0`. | VRC/Core/A.cs:677<br>VRC/Core/A.cs:678 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanSpeak | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseCustomAnimations | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Custom Animations. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseCustomShaders | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:674<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseDrone | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseParticleSystems | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:674<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseTriggers | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use Triggers. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_TrustedTrustLevel_CanUseUserIcons | get_hasTrustedTrustLevel | int (bool) | Custom Trust Level Trusted Trust Level Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:674<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| CustomTrustLevel_Untrusted_CanSpeak | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Untrusted Can Speak. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Untrusted_CanUseCustomAnimations | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Untrusted Can Use Custom Animations. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Untrusted_CanUseCustomShaders | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Untrusted Can Use Custom Shaders. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Untrusted_CanUseDrone | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Untrusted Can Use Drone. | `0/1`; current `1`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Untrusted_CanUseParticleSystems | __GetColor__UnityEngineParticleSystemCustomData__UnityEngineParticleSystemMinMaxGradient | int (bool) | Custom Trust Level Untrusted Can Use Particle Systems. | `0/1`; current `0`. | VRC/Udon/Wrapper/Modules/E_5.cs:68<br>VRC/Udon/Wrapper/Modules/E_5.cs:74 | Yes |
| CustomTrustLevel_Untrusted_CanUseTriggers | GetCustomLowpassLevelCurveCopy | int (bool) | Custom Trust Level Untrusted Can Use Triggers. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/A.cs:1017<br>ThirdParty/Unity/UnityEngine/A.cs:1018 | Yes |
| CustomTrustLevel_Untrusted_CanUseUserIcons | SetUserDefinedSettings | int (bool) | Custom Trust Level Untrusted Can Use User Icons. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanSpeak | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Speak. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseCustomAnimations | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Custom Animations. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseCustomShaders | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Custom Shaders. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseDrone | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Drone. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseParticleSystems | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Particle Systems. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseTriggers | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use Triggers. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeryNegativeTrustLevel_CanUseUserIcons | get_hasVeryNegativeTrustLevel | int (bool) | Custom Trust Level Very Negative Trust Level Can Use User Icons. | `0/1`; current `0`. | VRC/Core/A.cs:678<br>VRC/Core/A.cs:677 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanSpeak | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Speak. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseCustomAnimations | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Custom Animations. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseCustomShaders | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Custom Shaders. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseDrone | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Drone. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseParticleSystems | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Particle Systems. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>VRC/Udon/Wrapper/Modules/E_5.cs:68 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseTriggers | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use Triggers. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Unity/UnityEngine/A.cs:1017 | Yes |
| CustomTrustLevel_VeteranTrustLevel_CanUseUserIcons | get_hasVeteranTrustLevel | int (bool) | Custom Trust Level Veteran Trust Level Can Use User Icons. | `0/1`; current `1`. | VRC/Core/A.cs:675<br>ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160 | Yes |
| E1F946CE2FD302B954E26AD92C0B30BF | hexid | string | Opaque token / encrypted identifier blob; likely auth, install, or migration material. | Current `ka8m4f/K+n3sFFULMfbtKA==`. | Unresolved | Yes |
| ForceSettings_AutoWalk | ForceAutoSelect | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | ThirdParty/Unity/UnityEngine/EventSystems/EventSystems.cs:653<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:386 | Yes |
| ForceSettings_Mixer | get_NativeForceAudioCodecIndex | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `2`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:386<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:387 | Yes |
| ForceSettings_PedestalSharing | get_NativeForceAudioCodecIndex | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:386<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:387 | Yes |
| ForceSettings_SteamAudioSliderRemap | SteamAudioSettings | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:723<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:386 | Yes |
| ForceSettings_WorldTooltipMode | get_NativeForceAudioCodecIndex | int | One-shot migration / compatibility flag used to force a settings migration step. | Current `1`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:386<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:387 | Yes |
| FRIEND_LAST_VISIT_HISTORY_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | SaveSessionLastActiveTime | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 75 bytes. | ThirdParty/Other/AmplitudeSDKWrapper/AmplitudeSDKWrapper.cs:48<br>ThirdParty/Other/AmplitudeSDKWrapper/AmplitudeSDKWrapper.cs:78 | Yes |
| has_seen_avm-explore-to-cm-migration | HasUserAuthorisationToCaptureAudio | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:452<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:165 | Yes |
| has_seen_event_discovery_in_beta | HasValueChangeInEvent | int (bool) | One-time UI callout / tutorial / promo seen flag. | `0/1`; current `0`. | ThirdParty/Unity/UnityEngine/InputSystem/InputSystem.cs:1482<br>ThirdParty/Unity/UnityEngine/UIElements/V.cs:408 | Yes |
| InQueueWidgetInfoShowcaseID | In Queue Widget Info Showcase ID | int (bool) | In Queue Widget Info Showcase ID. | `0/1`; current `0`. | ThirdParty/DotNet/System/Text/Json/Json.cs:501<br>ThirdParty/DotNet/System/Text/Json/Serialization/Metadata/Metadata.cs:235 | Yes |
| LOGGING_ENABLED | DefaultExceptionLoggingFormatter | int (bool) | LOGGING ENABLED. | `0/1`; current `1`. | ThirdParty/Other/ZLogger/Formatters/Formatters.cs:24<br>ThirdParty/Other/ZLogger/Formatters/Formatters.cs:25 | Yes |
| migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-HideDrone | ResetTargetLocalPosition | int (bool) | migrated-local-pmods-userid-Hide Drone. | `0/1`; current `1`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:367<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:376 | Yes |
| migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-ShowDrone | ResetTargetLocalPosition | int (bool) | migrated-local-pmods-userid-Show Drone. | `0/1`; current `1`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:367<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:376 | Yes |
| PlayerHeight | PlayerSupportsLinearColorSpace | int (bool) | Player Height. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:195<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:1146 | Yes |
| SavedWorldSearchesusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | get_LastFileSaved | string | Persisted recent-history or saved-list UI data. | Empty string / empty blob. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:426<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:427 | Yes |
| unity.cloud_userid | iplUnitySetSimulationSettings | string | unity cloud userid. | Current `d247209527771ab408998d1733b27bf6`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:139<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:138 | Yes |
| unity.player_session_count | GetUnityAudioChannelCount | string | Unity session telemetry / runtime counter. | Current `109`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:930<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:409 | Yes |
| unity.player_sessionid | MediaPlayerLoadEvent | string | Unity session telemetry / runtime counter. | Current `5065501860897013867`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:668<br>ThirdParty/Depthkit/Depthkit/Depthkit.cs:761 | Yes |
| UnitySelectMonitor | iplUnitySetSimulationSettings | int | Unity Select Monitor. | Current `0`. | ThirdParty/Other/SteamAudio/SteamAudio.cs:139<br>ThirdParty/Unity/UnityEngine/InputSystem/EnhancedTouch/EnhancedTouch.cs:133 | Yes |
| USER_CAMERA_RESOLUTION | SetUserDefinedSettings | string | USER CAMERA RESOLUTION. | Current `Res_1080`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Other/UnityStandardAssets/Water/Water.cs:48 | Yes |
| USER_CAMERA_ROLL_WHILE_FLYING | SetUserDefinedSettings | int (bool) | USER CAMERA ROLL WHILE FLYING. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Other/UnityStandardAssets/Water/Water.cs:48 | Yes |
| USER_CAMERA_SAVE_METADATA | SetUserDefinedSettings | int (bool) | USER CAMERA SAVE METADATA. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Other/UnityStandardAssets/Water/Water.cs:48 | Yes |
| USER_CAMERA_STREAM_RESOLUTION | SetUserDefinedSettings | int (bool) | USER CAMERA STREAM RESOLUTION. | `0/1`; current `1`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Other/UnityStandardAssets/Water/Water.cs:48 | Yes |
| USER_CAMERA_TRIGGER_TAKES_PHOTOS | HasUserAuthorisationToAccessPhotos | int (bool) | USER CAMERA TRIGGER TAKES PHOTOS. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:455<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:456 | Yes |
| UserId | SetUserDefinedSettings | string | User Id. | Current `75764382`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:160<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:452 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_DroneFlightPresetValues | AddColorGradientPreset | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 1635 bytes. | ThirdParty/Other/TMPro/TMPro.cs:169<br>ThirdParty/Other/TMPro/TMPro.cs:177 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_LastExpiredSubscription | SaveSessionLastActiveTime | string | Per-user scoped persisted UI or preferences data. | Empty string / empty blob. | ThirdParty/Other/AmplitudeSDKWrapper/AmplitudeSDKWrapper.cs:48<br>ThirdParty/Other/AmplitudeSDKWrapper/AmplitudeSDKWrapper.cs:78 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_OpenedQuickMenu | get_MediaOpened | int | Per-user scoped persisted UI or preferences data. | Current `10`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:588<br>Global/O.cs:1629 | Yes |
| usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726_OpenMenuHelpShownCount | OpenVRSettings | int | Per-user scoped persisted UI or preferences data. | Current `3`. | ThirdParty/Other/Unity/XR/OpenVR/OpenVR.cs:197<br>VRC/UI/P.cs:1930 | Yes |
| VRC_ACTION_MENU_FLICK_SELECT | SelectAudioCodec | int | VRC ACTION MENU FLICK SELECT. | Current `1`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:396<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:397 | Yes |
| VRC_ACTION_MENU_L_MENU_OPACITY | ActionSettings | float | VRC ACTION MENU L MENU OPACITY. | Current `0`. | Global/A_2.cs:6<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:311 | Yes |
| VRC_ACTION_MENU_L_MENU_SIZE_PERCENTAGE | ActionSettings | int | VRC ACTION MENU L MENU SIZE PERCENTAGE. | Current `0`. | Global/A_2.cs:6<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:311 | Yes |
| VRC_ACTION_MENU_R_MENU_OPACITY | ActionSettings | float | VRC ACTION MENU R MENU OPACITY. | Current `0`. | Global/A_2.cs:6<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:311 | Yes |
| VRC_ACTION_MENU_R_MENU_SIZE_PERCENTAGE | ActionSettings | int | VRC ACTION MENU R MENU SIZE PERCENTAGE. | Current `0`. | Global/A_2.cs:6<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:311 | Yes |
| VRC_AFK_ENABLED | get_IsAFK | int (bool) | VRC AFK ENABLED. | `0/1`; current `0`. | VRC/Core/Networking/Pose/Pose.cs:103<br>Global/_Special_14.cs:168 | Yes |
| VRC_ALLOW_DIRECT_SHARES | IsAllowDirectSort | int (bool) | VRC ALLOW DIRECT SHARES. | `0/1`; current `1`. | ThirdParty/ZLinq/ZLinq/Linq/O.cs:99<br>ThirdParty/ZLinq/ZLinq/Linq/O.cs:121 | Yes |
| VRC_ALLOW_PEDESTAL_SHARES | AllowList | int (bool) | VRC ALLOW PEDESTAL SHARES. | `0/1`; current `1`. | ThirdParty/Other/ProfanityFilter/ProfanityFilter.cs:8<br>ThirdParty/Other/ProfanityFilter/ProfanityFilter.cs:52 | Yes |
| VRC_ALLOW_PRINTS | AllowList | int (bool) | VRC ALLOW PRINTS. | `0/1`; current `1`. | ThirdParty/Other/ProfanityFilter/ProfanityFilter.cs:8<br>ThirdParty/Other/ProfanityFilter/ProfanityFilter.cs:52 | Yes |
| VRC_ALLOW_SHARED_CONNECTIONS | VRC ALLOW SHARED CONNECTIONS | int (bool) | VRC ALLOW SHARED CONNECTIONS. | `0/1`; current `1`. | VRC/Core/Base/B_3.cs:1734<br>VRC/Core/A.cs:607 | Yes |
| VRC_AV_INTERACT_LEVEL | get_AudioFocusOffLevelDB | int | VRC AV INTERACT LEVEL. | Current `2`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:561<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:562 | Yes |
| VRC_AV_INTERACT_SELF | DestroySelf | int | VRC AV INTERACT SELF. | Current `1`. | ThirdParty/Other/TMPro/TMPro.cs:1274<br>ThirdParty/Other/TMPro/TMPro.cs:1647 | Yes |
| VRC_CAMERA_NEAR_CLIP_OVERRIDE_MODE | ProtectCameraFromWallClip | float | VRC CAMERA NEAR CLIP OVERRIDE MODE. | Raw DWORD `0x2`; non-obvious float encoding. | ThirdParty/Other/UnityStandardAssets/Cameras/Cameras.cs:87<br>Global/O.cs:1611 | Yes |
| VRC_CAMERA_THIRD_PERSON_VIEW | ThirdPersonCharacter | int | VRC CAMERA THIRD PERSON VIEW. | Current `0`. | ThirdParty/Other/UnityStandardAssets/Characters/ThirdPerson/ThirdPerson.cs:25<br>ThirdParty/Other/UnityStandardAssets/Characters/ThirdPerson/ThirdPerson.cs:53 | Yes |
| VRC_CAMERA_THIRD_PERSON_VIEW_DISTANCE | VRC CAMERA THIRD PERSON VIEW DISTANCE | float | VRC CAMERA THIRD PERSON VIEW DISTANCE. | Current `0`. | VRC/Core/Base/B_2.cs:1852<br>ThirdParty/Other/UnityStandardAssets/Characters/ThirdPerson/ThirdPerson.cs:25 | Yes |
| VRC_CHAT_BUBBLE_ABOVE_HEAD_V2 | SetChatBubbleVisibility | int | VRC CHAT BUBBLE ABOVE HEAD V2. | Current `0`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_AUDIO_ENABLED | ApplyAudioSettings | int (bool) | VRC CHAT BUBBLE AUDIO ENABLED. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:120<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:196 | Yes |
| VRC_CHAT_BUBBLE_AUDIO_VOLUME | ApplyAudioSettings | float | VRC CHAT BUBBLE AUDIO VOLUME. | Current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:120<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:196 | Yes |
| VRC_CHAT_BUBBLE_AUTO_SEND | SetChatBubbleVisibility | int | VRC CHAT BUBBLE AUTO SEND. | Current `1`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_OPACITY | SetChatBubbleVisibility | float | VRC CHAT BUBBLE OPACITY. | Current `0`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_POS_HEIGHT | SetChatBubbleVisibility | int | VRC CHAT BUBBLE POS HEIGHT. | Current `0`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_PROFANITY_FILTER | ProfanityFilter | int | VRC CHAT BUBBLE PROFANITY FILTER. | Current `1`. | ThirdParty/Other/ProfanityFilter/ProfanityFilter.cs:36<br>VRC/SDK3/Internal/Internal.cs:32 | Yes |
| VRC_CHAT_BUBBLE_SCALE | SetChatBubbleVisibility | float | VRC CHAT BUBBLE SCALE. | Current `0`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_SHOW_OWN | SetChatBubbleVisibility | int (bool) | VRC CHAT BUBBLE SHOW OWN. | `0/1`; current `1`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_TIMEOUT | SetChatBubbleVisibility | int | VRC CHAT BUBBLE TIMEOUT. | Current `0`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CHAT_BUBBLE_VISIBILITY | SetChatBubbleVisibility | int | VRC CHAT BUBBLE VISIBILITY. | Current `2`. | VRC/SDK3/Internal/Internal.cs:32<br>VRC/SDK3/Internal/Internal.cs:33 | Yes |
| VRC_CLEAR_CACHE_ON_START | ClearPoseCache | int | Clear content cache at startup. | Current `0`. | Global/O.cs:1893<br>ThirdParty/Cinemachine/Cinemachine/Cinemachine.cs:1671 | Yes |
| VRC_COLOR_BLINDNESS_SIMULATE | PlayerSupportsLinearColorSpace | int (bool) | Simulate selected color blindness profile. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:195<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:1146 | Yes |
| VRC_CURRENT_LANGUAGE | GetLanguage | string | Selected application language code. | Current `zh-CN`. | ThirdParty/Other/AmplitudeSDKWrapper/AmplitudeSDKWrapper.cs:120<br>ThirdParty/Unity/UnityEngine/Video/Video.cs:129 | Yes |
| VRC_DEFAULT_DRONE_SKIN_PALETTE | DroneSkinMap | string | VRC DEFAULT DRONE SKIN PALETTE. | JSON/string blob; current length 73 bytes. | Global/D.cs:798<br>ThirdParty/Other/TMPro/TMPro.cs:1115 | Yes |
| VRC_DESKTOP_RETICLE | _IsDisplayOnDesktop | int | VRC DESKTOP RETICLE. | Current `1`. | Global/_Special_15.cs:969<br>ThirdParty/Cinemachine/Cinemachine/Cinemachine.cs:124 | Yes |
| VRC_DIRECT_SHARING_VISIBILITY | IsDirectHierarchy | int | VRC DIRECT SHARING VISIBILITY. | Current `1`. | ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:1129<br>ThirdParty/Other/SteamAudio/SteamAudio.cs:92 | Yes |
| VRC_GROUP_ORDER_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726 | get_sortingGroupOrder | string | Per-user scoped persisted UI or preferences data. | JSON/string blob; current length 2 bytes. | ThirdParty/Unity/UnityEngine/R.cs:616<br>ThirdParty/Unity/UnityEngine/R.cs:617 | Yes |
| VRC_HOME_ACCESS_TYPE | HasUserAuthorisationToAccessPhotos | int | Home-world access / privacy preset. | Observed `3`; small integer home privacy enum. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:455<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:456 | Yes |
| VRC_INTERACT_HAPTICS_ENABLED | UpdateXRControllerHaptics | int (bool) | VRC INTERACT HAPTICS ENABLED. | `0/1`; current `1`. | Global/O.cs:620<br>Global/O.cs:1723 | Yes |
| VRC_IS_BOOPING_ENABLED | get_isBoopingEnabled | int (bool) | VRC IS BOOPING ENABLED. | `0/1`; current `1`. | VRC/Core/A.cs:533<br>VRC/Core/A.cs:534 | Yes |
| VRC_LIMIT_PARTICLE_SYSTEMS | GetControllableParticleSystems | int | VRC LIMIT PARTICLE SYSTEMS. | Current `1`. | ThirdParty/Unity/UnityEngine/Timeline/Timeline.cs:337<br>ThirdParty/Unity/UnityEngine/Timeline/Timeline.cs:338 | Yes |
| VRC_MAIN_MENU_MOVEMENT_LOCKED | VRCSetAvatarMainIK | int (bool) | VRC MAIN MENU MOVEMENT LOCKED. | `0/1`; current `1`. | ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:280<br>ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:370 | Yes |
| VRC_MM_FREE_PLACEMENT_ENABLED | FreePendingFileWrites | int (bool) | VRC MM FREE PLACEMENT ENABLED. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:400<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:467 | Yes |
| VRC_MOBILE_AUTO_HOLD_ENABLED | AutoMobileShaderSwitch | int (bool) | VRC MOBILE AUTO HOLD ENABLED. | `0/1`; current `1`. | ThirdParty/Other/UnityStandardAssets/Utility/Utility.cs:20<br>VRC/SDKBase/SDKBase.cs:894 | Yes |
| VRC_MOBILE_AUTO_WALK_ENABLED | AutoMobileShaderSwitch | int (bool) | VRC MOBILE AUTO WALK ENABLED. | `0/1`; current `0`. | ThirdParty/Other/UnityStandardAssets/Utility/Utility.cs:20<br>ThirdParty/Other/RootMotion/FinalIK/FinalIK.cs:342 | Yes |
| VRC_MOBILE_DPI_SCALING | get_shouldHideMobileInput | float | VRC MOBILE DPI SCALING. | Current `0`. | ThirdParty/Other/TMPro/TMPro.cs:615<br>ThirdParty/Other/TMPro/TMPro.cs:616 | Yes |
| VRC_MOBILE_PERFORMANCE_SECONDARY_UI_ENABLED | GetDecoderPerformance | int (bool) | VRC MOBILE PERFORMANCE SECONDARY UI ENABLED. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:260<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:1191 | Yes |
| VRC_MOBILE_QUICK_SELECT_ENABLED | SelectAudioCodec | int (bool) | VRC MOBILE QUICK SELECT ENABLED. | `0/1`; current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:396<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:397 | Yes |
| VRC_PEDESTAL_SHARING_VISIBILITY | get_ignoreVisibility | int | VRC PEDESTAL SHARING VISIBILITY. | Current `0`. | ThirdParty/Other/TMPro/TMPro.cs:1536<br>ThirdParty/Other/TMPro/TMPro.cs:1537 | Yes |
| VRC_PREFERRED_TIMEZONE_2 | get_GetPreferredTimezoneDelegate | string | VRC PREFERRED TIMEZONE 2. | Empty string / empty blob. | VRC/SDKBase/SDKBase.cs:168<br>VRC/SDKBase/SDKBase.cs:169 | Yes |
| VRC_PRINT_VISIBILITY | get_ignoreVisibility | int | VRC PRINT VISIBILITY. | Current `0`. | ThirdParty/Other/TMPro/TMPro.cs:1536<br>ThirdParty/Other/TMPro/TMPro.cs:1537 | Yes |
| VRC_RANDOMIZE_DRONE | DroneSkinMap | int (bool) | VRC RANDOMIZE DRONE. | `0/1`; current `0`. | Global/D.cs:798<br>Global/G.cs:184 | Yes |
| VRC_RANDOMIZE_LOADING_SCREEN | ApiLoadingScreen | int (bool) | VRC RANDOMIZE LOADING SCREEN. | `0/1`; current `0`. | VRC/Core/A.cs:1703<br>VRC/InventoryEffects/InventoryEffects.cs:24 | Yes |
| VRC_RANDOMIZE_WARP_EFFECT | ApiWarpEffectSkin | int (bool) | VRC RANDOMIZE WARP EFFECT. | `0/1`; current `0`. | VRC/Core/A.cs:2928<br>VRC/InventoryEffects/InventoryEffects.cs:45 | Yes |
| VRC_REDUCE_ANIMATIONS | ReduceKeyframes | int (bool) | Reduce nonessential UI / world animations. | `0/1`; current `0`. | ThirdParty/Other/RootMotion/RootMotion.cs:65<br>ThirdParty/Other/TMPro/TMPro.cs:1140 | Yes |
| VRC_SCREEN_BRIGHTNESS | CaptureFromScreen | float | Screen brightness adjustment. | Current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:578<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:312 | Yes |
| VRC_SCREEN_CONTRAST | CaptureFromScreen | float | Screen contrast adjustment. | Current `0`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:578<br>ThirdParty/Other/RenderHeads/Media/AVProVideo/AVProVideo.cs:312 | Yes |
| VRC_SHOW_COMMUNITY_LAB_WORLDS_IN_SEARCH | SearchForSpriteByUnicode | int (bool) | VRC SHOW COMMUNITY LAB WORLDS IN SEARCH. | `0/1`; current `0`. | ThirdParty/Other/TMPro/TMPro.cs:1167<br>ThirdParty/Other/TMPro/TMPro.cs:1168 | Yes |
| VRC_SHOW_COMMUNITY_LABS | VRC SHOW COMMUNITY LABS | int (bool) | VRC SHOW COMMUNITY LABS. | `0/1`; current `1`. | Global/_Special_31.cs:485<br>Global/_Special_31.cs:486 | Yes |
| VRC_SHOW_COMPATIBILITY_WARNINGS | GenerateTestsForBurstCompatibilityAttribute | int (bool) | VRC SHOW COMPATIBILITY WARNINGS. | `0/1`; current `0`. | ThirdParty/Other/Unity/Collections/G.cs:8<br>ThirdParty/DotNet/Microsoft/Extensions/DependencyInjection/DependencyInjection.cs:184 | Yes |
| VRC_SHOW_GO_BUTTON_IN_LOAD | LoadDefaultSettings | int (bool) | VRC SHOW GO BUTTON IN LOAD. | `0/1`; current `0`. | ThirdParty/Other/TMPro/TMPro.cs:1115<br>ThirdParty/Other/TMPro/TMPro.cs:1642 | Yes |
| VRC_SHOW_GROUP_BADGE_TO_OTHERS | InGroup | int (bool) | VRC SHOW GROUP BADGE TO OTHERS. | `0/1`; current `1`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:172<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:653 | Yes |
| VRC_SHOW_GROUP_BADGES | InGroup | int (bool) | VRC SHOW GROUP BADGES. | `0/1`; current `1`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:172<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:653 | Yes |
| VRC_SLIDER_SNAPPING | SliderEvent | int | VRC SLIDER SNAPPING. | Current `1`. | Global/S.cs:638<br>ThirdParty/Unity/UnityEngine/G.cs:79 | Yes |
| VRC_STORE_LAST_SEEN_SHELF_UPDATE | VRC STORE LAST SEEN SHELF UPDATE | string | VRC STORE LAST SEEN SHELF UPDATE. | Empty string / empty blob. | Global/_Special_21.cs:450<br>Global/_Special_21.cs:451 | Yes |
| VRC_STREAMER_MODE_ENABLED | VRC STREAMER MODE ENABLED | int (bool) | VRC STREAMER MODE ENABLED. | `0/1`; current `0`. | VRC/Core/Base/B_3.cs:1732<br>VRC/Core/Component/L_8.cs:920 | Yes |
| VRC_UI_HAPTICS_ENABLED | UpdateXRControllerHaptics | int (bool) | VRC UI HAPTICS ENABLED. | `0/1`; current `1`. | Global/O.cs:620<br>Global/O.cs:1723 | Yes |
| VRC_UI_HEADER_CLICK_SCROLL_RESET_ENABLED | VRC UI HEADER CLICK SCROLL RESET ENABLED | int (bool) | VRC UI HEADER CLICK SCROLL RESET ENABLED. | `0/1`; current `1`. | VRC/Core/Base/B_2.cs:1983<br>VRC/Core/System/C_2.cs:579 | Yes |
| VRC_WEBCAM_DEVICE_NAME | GetAudioInputDeviceName | string | VRC WEBCAM DEVICE NAME. | Current `ASUS FHD webcam`. | ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:881<br>ThirdParty/Other/RenderHeads/Media/AVProMovieCapture/AVProMovieCapture.cs:894 | Yes |
| VRC_WORLD_TOOLTIP_MODE | get_targetAnimatedWorldRotation | int | VRC WORLD TOOLTIP MODE. | Current `3`. | ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:324<br>ThirdParty/Other/RootMotion/Dynamics/Dynamics.cs:325 | Yes |

## UI sections

| Section | Key Count |
|---|---:|
| Audio | 42 |
| Graphics | 56 |
| Network | 11 |
| Avatars | 68 |
| Comfort | 45 |
| Input | 35 |
| UI | 107 |
| Privacy | 4 |
| Other | 229 |

## Top 30 keys to expose in a VRCSM GUI

1. `AUDIO_MASTER_STEAMAUDIO`: Master volume.
2. `AUDIO_GAME_VOICE_STEAMAUDIO`: Voice chat volume.
3. `AUDIO_GAME_SFX_STEAMAUDIO`: World SFX volume.
4. `AUDIO_GAME_AVATARS_STEAMAUDIO`: Avatar audio volume.
5. `AUDIO_MASTER_ENABLED`: Fast mute/unmute.
6. `VRC_INPUT_MIC_ENABLED`: Mic master toggle.
7. `VRC_INPUT_MIC_LEVEL_DESK`: Mic gain.
8. `VRC_INPUT_MIC_NOISE_GATE`: Mic noise gate.
9. `VRC_INPUT_TALK_TOGGLE`: Push-to-talk vs toggle.
10. `UnityGraphicsQuality`: One-click quality preset.
11. `VRC_ADVANCED_GRAPHICS_ANTIALIASING`: AA quality.
12. `SHADOW_QUALITY`: Shadow quality.
13. `LOD_QUALITY`: LOD quality.
14. `FPS_LIMIT`: Custom frame cap.
15. `FIELD_OF_VIEW`: Desktop FOV.
16. `VRC_SELECTED_NETWORK_REGION`: Preferred region.
17. `BestRegionCache`: Auto-region cache behavior.
18. `VRC_SAFETY_LEVEL`: Global safety level.
19. `VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY`: Performance visibility floor.
20. `VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE`: Avatar download size cap.
21. `VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE`: Avatar uncompressed size cap.
22. `VRC_AVATAR_FALLBACK_HIDDEN`: Hide fallback avatars.
23. `VRC_NAMEPLATE_MODE`: Nameplate mode.
24. `VRC_NAMEPLATE_OPACITY`: Nameplate opacity.
25. `VRC_HUD_MODE`: HUD mode.
26. `VRC_HUD_OPACITY`: HUD opacity.
27. `VRC_SHOW_JOIN_NOTIFICATIONS`: Join notifications.
28. `VRC_USE_COLOR_FILTER`: Accessibility filter toggle.
29. `VRC_COLOR_FILTER_SELECTION`: Accessibility filter preset.
30. `PersonalMirror.ShowFaceMirror`: Personal face mirror toggle.

## Writable without restart?

This is inferred from the kind of setting and the surrounding module names available in the stub dump. Because the actual setter bodies are stripped, treat this as a practical integration guide rather than a binary guarantee.

### Likely live-applied: Audio

`VRC_INPUT_MIC_ENABLED`, `VRC_INPUT_MIC_NOISE_GATE`, `VRC_INPUT_MIC_LEVEL_DESK`, `VRC_INPUT_MIC_MODE`, `VRC_INPUT_MIC_DEVICE_NAME_VR`, `VRC_INPUT_MIC_DEVICE_NAME_Desktop`, `VRC_MIC_ICON_VISIBILITY`, `VRC_INPUT_MIC_ON_JOIN`, `VRC_INPUT_MIC_LEVEL_VR`, `VRC_INPUT_MIC_NOISE_SUPPRESSION`, `VRC_EARMUFF_MODE`, `VRC_EARMUFF_MODE_AVATARS`, `VRC_EARMUFF_MODE_VISUAL_AIDE`, `VRC_EARMUFF_MODE_SHOW_ICON_IN_NAMEPLATE`, `VRC_EARMUFF_MODE_RADIUS`, `VRC_EARMUFF_MODE_FALLOFF`, `VRC_EARMUFF_MODE_REDUCED_VOLUME`, `VRC_EARMUFF_MODE_CONE_VALUE`, `VRC_EARMUFF_MODE_OFFSET_VALUE`, `VRC_EARMUFF_MODE_FOLLOW_HEAD`, `VRC_EARMUFF_MODE_LOCK_ROTATION`, `VRC_PLAY_NOTIFICATION_AUDIO`, `VRC_MIC_TOGGLE_VOLUME`, `AUDIO_MASTER_STEAMAUDIO`, plus 13 more.

### Likely live-applied: HUD / UI

`VRC_NAMEPLATE_FALLBACK_ICON_VISIBLE`, `VRC_SHOW_GROUP_BADGES`, `VRC_SHOW_GROUP_BADGE_TO_OTHERS`, `VRC_SHOW_COMMUNITY_LAB_WORLDS_IN_SEARCH`, `VRC_SHOW_GO_BUTTON_IN_LOAD`, `VRC_SHOW_COMPATIBILITY_WARNINGS`, `VRC_SHOW_SOCIAL_RANK`, `VRC_SHOW_COMMUNITY_LABS`, `VRC_USE_COLOR_FILTER`, `VRC_COLOR_FILTER_TO_WORLD`, `VRC_COLOR_BLINDNESS_SIMULATE`, `VRC_COLOR_FILTER_SELECTION`, `VRC_COLOR_FILTER_INTENSITY`, `VRC_SCREEN_BRIGHTNESS`, `VRC_SCREEN_CONTRAST`, `VRC_REDUCE_ANIMATIONS`, `VRC_BLOOM_INTENSITY`, `VRC_NAMEPLATE_MODE`, `VRC_NAMEPLATE_QUICK_MENU_INFO`, `VRC_NAMEPLATE_STATUS_MODE`, `VRC_NAMEPLATE_SCALE_V2`, `VRC_NAMEPLATE_OPACITY`, `VRC_HUD_MODE`, `VRC_HUD_ANCHOR`, plus 12 more.

### Likely live-applied: Avatar safety / visibility

`VRC_SAFETY_LEVEL`, `VRC_AVATAR_PERFORMANCE_RATING_MINIMUM_TO_DISPLAY`, `VRC_AVATAR_HAPTICS_ENABLED`, `VRC_AVATAR_FALLBACK_HIDDEN`, `VRC_AVATAR_MAXIMUM_DOWNLOAD_SIZE`, `VRC_AVATAR_MAXIMUM_UNCOMPRESSED_SIZE`, `VRC_AV_INTERACT_LEVEL`, `VRC_AV_INTERACT_SELF`, `avatarProxyShowAtRange`, `avatarProxyShowAtRangeToggle`, `avatarProxyShowMaxNumber`, `currentShowMaxNumberOfAvatarsEnabled`, `avatarProxyAlwaysShowFriends`, `avatarProxyAlwaysShowExplicit`

### Likely live-applied: Comfort / tracking

`VRC_TRACKING_GRACEFUL_QUIT`, `VRC_FINGER_WALK_SETTING`, `VRC_TRACKING_ENABLE_SELFIE_FACE_TRACKING`, `VRC_ACTION_MENU_R_HUD_ANGLE_X`, `VRC_ACTION_MENU_R_HUD_ANGLE_Y`, `VRC_ACTION_MENU_R_SHOW_ON_HUD`, `VRC_UI_HAPTICS_ENABLED`, `VRC_INTERACT_HAPTICS_ENABLED`, `VRC_FINGER_HAPTIC_STRENGTH`, `VRC_FINGER_HAPTIC_SENSITIVITY`, `VRC_FINGER_GRAB_SETTING`, `VRC_FINGER_JUMP_ENABLED`, `VRC_IK_FBT_LOCOMOTION`, `VRC_IK_FBT_CONFIRM_CALIBRATE`, `VRC_IK_CALIBRATION_VIS`, `VRC_TRACKING_SEND_VR_SYSTEM_HEAD_AND_WRIST_OSC_DATA`, `VRC_TRACKING_SHOULD_SHOW_OSC_TRACKING_DATA_REMINDER`, `VRC_IK_USE_METRIC_HEIGHT`, `VRC_IK_LEGACY_CALIBRATION`, `VRC_IK_ONE_HANDED_CALIBRATION`, `VRC_IK_DISABLE_SHOULDER_TRACKING`, `VRC_IK_FREEZE_TRACKING_ON_DISCONNECT`, `VRC_IK_SHOULDER_WIDTH_COMPENSATION`, `VRC_IK_DEBUG_LOGGING`, plus 39 more.

### Likely live-applied: Frame pacing / camera

`FIELD_OF_VIEW`, `VRC_LANDSCAPE_FOV`, `VRC_PORTRAIT_FOV`, `FPSType`, `FPS_LIMIT`, `FPSCapType`

### Likely reload/reconnect: Reconnect / relaunch likely

`UnityGraphicsQuality`, `VRC_ADVANCED_GRAPHICS_QUALITY`, `LOD_QUALITY`, `VRC_ADVANCED_GRAPHICS_ANTIALIASING`, `PARTICLE_PHYSICS_QUALITY`, `BestRegionCache`, `VRC_SELECTED_NETWORK_REGION`, `VRC_HOME_ACCESS_TYPE`, `VRC_HOME_REGION`, `SHADOW_QUALITY`, `PIXEL_LIGHT_COUNT`, `VRC_INPUT_OSC`

### Likely startup-only: Display bootstrap

`Screenmanager Stereo 3D`, `Screenmanager Resolution Width Default`, `Screenmanager Resolution Height Default`, `Screenmanager Resolution Use Native Default`, `Screenmanager Fullscreen mode Default`, `UnitySelectMonitor`, `Screenmanager Window Position X`, `Screenmanager Window Position Y`, `Screenmanager Resolution Width`, `Screenmanager Resolution Window Width`, `Screenmanager Resolution Height`, `Screenmanager Resolution Window Height`, `Screenmanager Resolution Use Native`, `Screenmanager Fullscreen mode`, `LocationContext`, `LocationContext_World`

### Likely startup-only: Migration / one-shot flags

`HasSeenVRCPlusExclusiveItemsQMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`, `migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-ShowAvatar`, `migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-HideAvatar`, `migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-ShowDrone`, `migrated-local-pmods-usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726-HideDrone`, `FOLDOUT_STATES`, `ForceSettings_MigrateMicSettings`, `ForceSettings_MicToggle`, `ForceSettings_Mixer`, `ForceSettings_ClearFoldoutPrefKeys`, `ForceSettings_WorldTooltipMode`, `ForceSettings_PedestalSharing`, `ForceSettings_AutoWalk`, `ForceSettings_SteamAudioSliderRemap`, `has_seen_avm-explore-to-cm-migration`, `InQueueWidgetInfoShowcaseID`, `HasSeenHolidayEvent2025QMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`, `HasSeenShopRabbidsQMCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`, `has_seen_event_discovery_in_beta`, `HasSeenCameraDollyUserCameraCalloutusr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`, `CosmeticsSectionRedirect_Settings`

### Likely startup-only: Opaque auth / install tokens

`14C4B06B824EC593239362517F538B29`, `5F4DCC3B5AA765D61D8327DEB882CF99`, `E1F946CE2FD302B954E26AD92C0B30BF`, `BCD9D91ED8D8F1926B20D3D620647C8E`, `BD2E932A03A19217AB5A1DFB5AA93340`, `93D3AE97F80BEDA8E396065DC4770A93`, `785C2BDD2C43070A10BC35E5E687A467`

### Likely startup-only: Service / integration bootstrap

`VRC_CURRENT_LANGUAGE`, `VRC_ALLOW_DISCORD_FRIENDS`, `VRC_CLEAR_CACHE_ON_START`, `VRC_MOBILE_NOTIFICATIONS_SERVICE_ENABLED`, `BACKGROUND_DEBUG_LOG_COLLECTION`

### Persisted state / unclear from stub dump

`unity.player_session_count`, `unity.player_sessionid`, `VRC_INPUT_DAYDREAM`, `PersonalMirror.MovementMode`, `PersonalMirror.MirrorScaleX`, `PersonalMirror.MirrorScaleY`, `PersonalMirror.Grabbable`, `PersonalMirror.ImmersiveMove`, `PersonalMirror.ShowBorder`, `PersonalMirror.ShowRemotePlayerInMirror`, `PersonalMirror.ShowEnvironmentInMirror`, `PersonalMirror.ShowUIInMirror`, `PersonalMirror.MirrorOpacity`, `PersonalMirror.FaceMirrorOpacityDesktop`, `PersonalMirror.FaceMirrorScaleDesktop`, `PersonalMirror.FaceMirrorPosXDesktop`, `PersonalMirror.FaceMirrorPosYDesktop`, `PersonalMirror.FaceMirrorZoomDesktop`, `UI.Settings.Osc`, `VRC_GROUP_ORDER_usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`, `VRC_GROUP_ON_NAMEPLATE`, `VRC_RANDOMIZE_DRONE`, `VRC_RANDOMIZE_PORTAL`, `VRC_RANDOMIZE_WARP_EFFECT`, plus 356 more.

## Source-only keys

No additional raw PlayerPrefs key literals could be recovered confidently from the provided stub-only IL2CPP C# export beyond the keys confirmed in the live registry snapshot above.

