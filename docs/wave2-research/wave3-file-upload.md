# Wave 3 — C5 Avatar Image Upload + Supporter Status (file-upload area)

Research date: 2026-06-29. Read-only research; no source files edited.
Verification legend: **VERIFIED** = confirmed against repo file:line or an authoritative source I fetched; **UNVERIFIED** = not confirmable from sources available, flagged so impl agents don't invent it.

---

## TL;DR — the pipeline already exists

**The entire C5 avatar-image upload flow is already shipped in the repo, end-to-end.** Core method, IPC handler, allowlist entry, frontend binding, and a one-call wrapper (`replaceAvatarImageFromFile`) all exist. The B1 multipart foundation is present and in use. C5's remaining work is **UI wiring on the model-management page**, not new core/IPC plumbing.

Supporter status (`system_supporter`) flows through `auth.user` unfiltered and is already consumed in two components. VRC+ limits can be enforced by reading `user.tags`.

---

## 1. C5 — Avatar image upload flow

### 1a. Which API VRChat uses for avatar images: the SIMPLIFIED `/file/image` endpoint

VRChat exposes **two** ways to push image bytes:

- **Multi-step file API** (`POST /file` → `POST /file/{id}/version` → `PUT /file/{id}/{ver}/file/start` → S3 presigned PUT → `PUT .../finish`). Used for **avatar/world asset bundles + their signature files**, where MD5/size/signature are required. **VERIFIED** the `signatureMd5`(required) / `signatureSizeInBytes`(required) / `fileMd5`(optional) / `fileSizeInBytes`(optional) fields on `CreateFileVersionRequest`, and the S3-presigned-PUT-per-partNumber + signature-finish flow, via [vrchat.community create-file-version](https://vrchat.community/openapi/create-file-version) and [VRChat.Files hexdocs](https://vrchat.hexdocs.pm/VRChat.Files.html).

- **Simplified image endpoint** `POST /api/1/file/image` (multipart/form-data, single round-trip, server does the version/S3 dance internally). This is what's used for **icons, gallery, stickers, emoji, and avatar images**. No client-side MD5/size/signature needed. **VERIFIED** the endpoint + `file`/`tag` form fields via [VRChat.Files hexdocs](https://vrchat.hexdocs.pm/VRChat.Files.html) and [vrchat.community upload-image](https://vrchat.community/openapi/upload-image).

**For avatar images VRChat uses the simplified `/file/image` endpoint with `tag: "avatarimage"`.** **VERIFIED** against VRCX `src/api/avatar.js` (`uploadAvatarImage`), which calls `request('file/image', { uploadImage:true, matchingDimensions:false, postData: JSON.stringify({ tag:'avatarimage' }), imageData })` — [github search hit](https://github.com/vrcx-team/VRCX/blob/master/src/api/avatar.js). So **no MD5/size/signature/S3 step is required for the avatar IMAGE** (those only apply to the avatar's asset *bundle*, which is out of scope for C5).

> Note: the hexdocs `upload_image` helper lists tags as `icon|gallery|sticker|emoji|emojianimated` and omits `avatarimage`. That's a gap in the community Elixir wrapper docs, **not** the real API — VRCX and VRCSM both send `avatarimage` to the same endpoint. The repo's own enum already includes it (see 1c).

### 1b. The full C5 flow (2 calls)

```
Step 1  POST /api/1/file/image   (multipart/form-data)
          fields: tag="avatarimage", [matchingDimensions="true"], file=<png bytes>
          → returns a File record  { id, name, versions:[{ file:{ url }, deleted }], ... }

Step 2  PUT  /api/1/avatars/{avatarId}   body { "imageUrl": "<url from step1>" }
          → returns the updated avatar
```

The image URL for step 2 is the newest non-deleted `versions[].file.url` from the File record.

### 1c. Where each step already plugs into VrcApi / IPC / frontend (VERIFIED, file:line)

| Layer | Step 1 (upload image) | Step 2 (re-point avatar) |
|---|---|---|
| Core decl | `VrcApi.h:415` `uploadImage(imageBytes, tag, matchingDimensions)` | `VrcApi.h:427` `updateAvatarImage(avatarId, imageUrl)` |
| Core impl | `VrcApi.cpp:3264` — builds multipart `tag` + optional `matchingDimensions=true` + `MultipartFile{"file","image.png","image/png",bytes}`, POSTs `/api/1/file/image` | `VrcApi.cpp:3325` — `PUT /api/1/avatars/{id}` body `{"imageUrl":...}` |
| IPC allowlist | `IpcBridge.cpp:174` `"files.uploadImage"` | `IpcBridge.cpp:176` `"avatars.updateImage"` |
| IPC register | `IpcBridge.cpp:719` | `IpcBridge.cpp:721` |
| IPC handler | `ApiBridge.cpp:1184` `HandleFilesUploadImage` — decodes base64, requires `tag`, optional bool `matchingDimensions` | `ApiBridge.cpp:1212` `HandleAvatarsUpdateImage` — requires `avatarId`+`imageUrl` |
| FE dispatch | `ipc.ts:1546` `case "files.uploadImage"` + `ipc.ts:2100` `filesUploadImage({imageBase64,tag,matchingDimensions})` | `ipc.ts:1560` `case "avatars.updateImage"` + `ipc.ts:2114` `avatarsUpdateImage(avatarId,imageUrl)` |
| FE domain module | `vrc-media.ts:108` `uploadImageFile(file, tag, matchingDimensions)` | `vrc-media.ts:129` `updateAvatarImage(avatarId, imageUrl)` |
| FE combined wrapper | `vrc-media.ts:216` `replaceAvatarImageFromFile(avatarId, file, matchingDimensions=true)` — does upload → `fileImageUrl()` → `updateAvatarImage()` in one call (throws `upload_no_url` if no url) | — |
| FE url resolver | `vrc-media.ts:232` `fileImageUrl(file)` — walks `versions` newest-first, skips `deleted`, returns `versions[i].file.url` | — |

**VERIFIED** all rows above by reading the cited files.

### 1d. Multipart foundation (B1) — PRESENT, not missing

**VERIFIED.** `VrcApi.cpp:2995` `buildMultipartFormData(boundary, fields, file)` builds RFC-2388 multipart (binary-safe `std::string`, `\r\n` separators, trailing `--boundary--`). `MultipartField`/`MultipartFile`/`MultipartBody` structs declared in `VrcApi.h` (private section). `makeMultipartBoundary()` at `VrcApi.cpp:3076` (atomic counter + `unixNow()`). `decodeBase64()` at `VrcApi.cpp:3037`. Already used by `uploadPrint` (`VrcApi.cpp:3180`) and `uploadImage`. **No B1 work needed for C5.**

The FE→host byte path is also done: `vrc-media.ts:33` `fileToBase64(Blob)` reads as data URL and strips the `data:...;base64,` prefix (host's `decodeBase64` expects bare base64). `HandleFilesUploadImage` (`ApiBridge.cpp:1186-1191`) decodes and rejects empty/malformed.

### 1e. `matchingDimensions` semantics

**VERIFIED (behavior described in repo, partially in sources).** `vrc-media.ts:212-227` documents: `matchingDimensions=true` makes VRChat reject images whose dimensions don't match the existing avatar image, mirroring the in-game uploader; `replaceAvatarImageFromFile` defaults it to `true`. VRCX sends `matchingDimensions:false` for avatar images ([avatar.js](https://github.com/vrcx-team/VRCX/blob/master/src/api/avatar.js)). The server-side meaning (square-forcing for stickers/emoji) is **UNVERIFIED** against official docs — the [upload-image OpenAPI page](https://vrchat.community/openapi/upload-image) does not document `matchingDimensions` at all. Treat the exact server rule as observed-from-clients, not officially documented.

### 1f. Image dimension / format / size requirements — **mostly UNVERIFIED**

- **Format:** API docs only describe the blob as a "png file" ([upload-image](https://vrchat.community/openapi/upload-image)). VRCSM hardcodes `image/png` + `image.png` filename (`VrcApi.cpp:3282`). **VERIFIED PNG is what's sent**; whether other formats are accepted is **UNVERIFIED**.
- **Avatar image 1200x900:** **UNVERIFIED.** The OpenAPI upload-image page documents **no** width/height/1200x900 requirement and no max file size for the request. I could not confirm 1200x900 from an authoritative source. Do NOT bake a hard 1200x900 check as if it were a documented API contract — at most surface it as guidance, or rely on `matchingDimensions=true` + the server's own rejection.
- **Gallery max size:** the VRChat wiki states gallery images must be < 10MB ([wiki Vrchat+ revision](https://wiki.vrchat.com/index.php?diff=86&title=Vrchat%2B)). This is for gallery, not specifically avatar images. **VERIFIED for gallery, UNVERIFIED for avatarimage.**

> Recommendation: if C5 needs a dimension check, gate it dark / advisory-only and add a TODO to confirm the real avatarimage constraint, rather than rejecting client-side on an unconfirmed 1200x900.

### 1g. What C5 still needs (the actual remaining work)

Core + IPC + FE lib are done. Remaining = **UI on the model-management page**:
1. A file picker / drag-drop on an owned avatar's manage dialog.
2. Call `replaceAvatarImageFromFile(avatarId, file)` (already exists) gated behind an explicit user click.
3. This is a **WRITE but reversible** op (re-points imageUrl; old image File still exists until GC) → **single confirm**, per the `updateAvatar` convention at `VrcApi.h:444-451`. NOT a destructive double-confirm.
4. No `ProcessGuard` needed — it's an online op, not a local-file mutation (consistent with `deleteAvatar` note at `VrcApi.h:453-459`).
5. Invalidate the owned-avatars query on success so the new thumbnail shows.

---

## 2. Supporter / VRC+ status

### 2a. The exact field: `tags` array contains `"system_supporter"`

**VERIFIED** via [vrchat.community user tags](https://vrchat.community/tags/user): `system_supporter` = "User has an active VRC+ subscription". This is the precise marker for an **active** VRC+ subscriber.

Related (do NOT use for active status):
- `system_early_adopter` — bought VRC+ early (~Dec 2020); a badge, not current-subscription proof. **VERIFIED**.
- `system_vip`, `$supporter` — **NOT present** in the user tags doc. **VERIFIED absent** — do not invent these.

So: **active VRC+ ⟺ `user.tags` includes `"system_supporter"`.** No `developerType` / boolean `supporter` flag is the canonical signal; it's the tag.

### 2b. How the frontend reads it (already wired)

- `auth.user` IPC returns the **full, unfiltered** current-user object: `AuthBridge.cpp:170 HandleAuthUser` → `{authed:true, user: <raw /api/1/auth/user payload>}` (`AuthBridge.cpp:186-189`). So `user.tags` (including `system_supporter`) is available client-side untouched. **VERIFIED.**
- Type: `AuthUserPayload` (`types.ts:613-624`) is `Record<string,unknown>` with optional `tags?: string[]` — the raw shape, so `tags` is typed and accessible. **VERIFIED.**
- Existing consumers (pattern to copy):
  - `FriendDetailDialog.tsx:258` — `const isVrcPlus = (friend?.tags ?? []).some((t) => t === "system_supporter");`
  - `ProfileCard.tsx:312-315` — filters tags, maps `system_supporter` → label `"VRC+"`.

  **VERIFIED** both. These read a *friend's* tags; for self/VRC+ limit enforcement, read the same `system_supporter` check against the **current user** from the `auth.user` payload (e.g. in `auth-context.tsx`, which already refetches on the `user-update` pipeline event at `auth-context.tsx:300-306`).

### 2c. Enforcing VRC+ sticker/emoji/icon limits

Gate uploads on `currentUser.tags.includes("system_supporter")`. Note the **limit counts are moving targets** and should not be hardcoded as API truth:
- Custom sticker + emoji slots were raised to **18** each in VRChat 2025 ([feedback.vrchat.com](https://feedback.vrchat.com/open-beta/p/stickers-allow-us-to-store-more-stickers-and-emoji-and-select-the-9-active-from)); **9** stickers can be active at once ([Steam announcement](https://store.steampowered.com/news/posts/?appids=438100)). **VERIFIED as of 2025/late-2025, but volatile.**
- Gallery image < 10MB ([wiki](https://wiki.vrchat.com/index.php?diff=86&title=Vrchat%2B)). **VERIFIED but may change.**

> Recommendation: enforce the **boolean gate** (`system_supporter` present → uploads allowed) precisely, but treat numeric slot limits as advisory/soft (let the server be the authority and surface its rejection), since VRChat keeps changing them. **Important nuance: avatar-IMAGE upload (C5) is NOT VRC+ gated** — any user can change their own avatar's image. The `system_supporter` gate applies to stickers/emoji/gallery icons (Section B surfaces), not C5. Do not block C5 behind VRC+.

---

## 3. Net assessment for the C5 impl agent

- **Core/IPC/FE-lib for avatar image upload: DONE.** Don't re-implement; wire UI to `replaceAvatarImageFromFile`.
- **B1 multipart: DONE and in use.** Not missing.
- **Supporter detection: DONE** (`system_supporter` in `user.tags`, exposed via `auth.user`).
- **Don't invent:** a 1200x900 hard requirement, `matchingDimensions` server semantics, `system_vip`/`$supporter` tags, or client-side MD5/signature for the image (none needed — `/file/image` is the simplified path).
- **Confirm tier:** avatar image re-point = single confirm (reversible), no ProcessGuard.

### Sources
- [VRChat.Files (hexdocs)](https://vrchat.hexdocs.pm/VRChat.Files.html) — multi-step file/version/S3/signature flow + `upload_image` simplified endpoint
- [vrchat.community create-file-version](https://vrchat.community/openapi/create-file-version) — `signatureMd5`/`signatureSizeInBytes`/`fileMd5`/`fileSizeInBytes`
- [vrchat.community upload-image](https://vrchat.community/openapi/upload-image) — `file`/`tag` form fields (no dimension/size limits documented)
- [vrchat.community user tags](https://vrchat.community/tags/user) — `system_supporter` = active VRC+
- [VRCX src/api/avatar.js](https://github.com/vrcx-team/VRCX/blob/master/src/api/avatar.js) — confirms `file/image` + `tag:'avatarimage'` + `matchingDimensions`
- [VRChat wiki VRC+](https://wiki.vrchat.com/wiki/VRC+/en), [sticker/emoji 18-slot feedback](https://feedback.vrchat.com/open-beta/p/stickers-allow-us-to-store-more-stickers-and-emoji-and-select-the-9-active-from), [Steam 9-active announcement](https://store.steampowered.com/news/posts/?appids=438100) — VRC+ limits (volatile)
