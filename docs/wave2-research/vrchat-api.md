I now have a fully verified picture from both the official OpenAPI spec and VRCX cross-checks. Here is the catalog.

---

# VRCSM Wave 2 — VRChat API Endpoint Catalog (vrchat-api survey)

## Existing client conventions (from `D:\Project\VRCSM\src\core\VrcApi.cpp`)

All new endpoints should follow the established pattern. Key facts read from source:

- **Host/constants**: `kApiHostW = L"api.vrchat.cloud"` (VrcApi.cpp:111), `kApiKey = "JlE5Jldo5Jibnk5O5hTx6XVqsJu4WJ26"` (VrcApi.cpp:103), `kUserAgentW = L"VRCSM/1.0"` (VrcApi.cpp:109). UA is mandatory — VRChat 403s requests without one (comment VrcApi.cpp:41-46).
- **Auth**: cookie session via `getLoadedCookieHeader()` (VrcApi.cpp:506) → `AuthStore::Instance().BuildCookieHeader()`. Returns empty when not signed in; convention is `return Error{"auth_expired", ..., 401}`.
- **HTTP core**: `httpRequest(method, host, pathAndQuery, headers, bodyUtf8, captureSetCookie)` (VrcApi.cpp:729) wraps `httpRequestOnce` (WinHTTP). It already does **429 retry with exponential backoff** (1s/2s/4s) and routes every call through `RateLimiter::Instance().Acquire()` (VrcApi.cpp:742). `httpGet` convenience at VrcApi.cpp:770.
- **Rate limiting**: centralized in `RateLimiter` (per the <=1/60s policy note — seed via REST then maintain via websocket pipeline; `fetchPipelineToken()` at VrcApi.cpp:2454 already exists).
- **Error/JSON helpers**: `checkStandardHttpError()` (VrcApi.cpp:529) maps 401→auth_expired, 429→rate_limited, non-2xx→api_error; `extractApiErrorMessage()` (VrcApi.cpp:472) lifts VRChat's `message`/`error.message`; `parseJsonBody()` (VrcApi.cpp:810) throws on bad JSON; `fetchPagedAuthedArray()` (VrcApi.cpp:825) is the paginated-GET helper (n=100 pages).
- **Write-op pattern**: see `updateAuthUser()` (VrcApi.cpp:2247) and `setGroupRepresentation()` (VrcApi.cpp:2950) — set `Cookie` + `Content-Type: application/json` headers, `body.dump()`, return `{ok:true}` or parsed JSON.
- **GAP — no multipart/form-data helper exists.** Every current call is JSON or query-string. All image/print uploads below need a **new multipart body builder + binary PUT-to-S3 path** that `httpRequestOnce` does not currently support (it takes a `std::string bodyUtf8`; binary blobs need a new code path). This is the single biggest piece of new plumbing for Wave 2.

Base path for everything: `https://api.vrchat.cloud/api/1` + the paths below. Auth = session cookie unless noted.

---

## 1. BOOP / haptic react — **DOCUMENTED**

| Method | Path | Notes |
|---|---|---|
| `POST` | `/users/{userId}/boop` | Sends a boop to a user. Sender = auth cookie; receiver = path `{userId}`. |

- **Request body** (`application/json`, all optional — VRChat's own example posts `{}`):
  - `emojiId` (string) — "Either a FileID or a string constant for default emojis"
  - `emojiVersion` (integer)
  - `inventoryItemId` (string)
- **Responses**: 200 `{success:{message:"User booped!", status_code:200}}`; 400 `"These users are not friends"`; 401 missing creds; 404 user doesn't exist.
- **Cross-check (VRCX `src/api/misc.js`)**: `sendBoop` → `POST users/${userId}/boop` with body `{ emojiId: params.emojiId /* inventoryItemId */ }`. Confirms exact path + that emojiId is the real field, inventoryItemId is the inventory-driven variant.
- **Caveat**: 400 if not friends. Gated server-side by the receiver's `isBoopingEnabled` (a field in `UpdateUserRequest`). This is the real endpoint VRChat uses — no separate "react"/notification endpoint exists for boops.

---

## 2. Inventory (stickers / emoji / props / prints live here) — **DOCUMENTED**

Spec source: `openapi/components/paths/inventory.yaml`. **Confirmed: the list endpoint is `GET /inventory` (with a `holderId` query), NOT `/users/{id}/inventory`.** There is a separate per-item `GET /user/{userId}/inventory/{inventoryItemId}`.

| Method | Path | operationId | Notes |
|---|---|---|---|
| `GET` | `/inventory` | getInventory | **The list endpoint.** Query: `n`, `offset`, `holderId` (defaults to current user), `types`, `flags`, `notTypes`, `notFlags`, `tags`, `archived`, `equipSlot`, `order`. Returns `Inventory { data: InventoryItem[], totalCount }`. |
| `GET` | `/inventory/{inventoryItemId}` | getOwnInventoryItem | One own item. |
| `PUT` | `/inventory/{inventoryItemId}` | updateOwnInventoryItem | Body `UpdateInventoryItemRequest`. |
| `DELETE` | `/inventory/{inventoryItemId}` | deleteOwnInventoryItem | |
| `PUT` | `/inventory/{inventoryItemId}/consume` | consumeOwnInventoryItem | 400 if not consumable. |
| `GET` | `/user/{userId}/inventory/{inventoryItemId}` | getUserInventoryItem | Item held by another user. |
| `GET` | `/inventory/collections` | getInventoryCollections | Collection names. |
| `GET` | `/inventory/drops` | getInventoryDrops | Query `active`. |
| `GET` | `/inventory/spawn` | spawnInventoryItem | Query `inventorySpawnItemId`. |
| `POST` | `/inventory/cloning/direct` | shareInventoryItemDirect | Body `ShareInventoryItemDirectRequest`. |
| `GET` | `/inventory/cloning/pedestal` | shareInventoryItemPedestal | |

- **`InventoryItem` shape** (`schemas/InventoryItem.yaml`): `id` (InventoryItemID), `holderId` (UserID), `itemType`, `itemTypeLabel`, `name`, `description`, `imageUrl`, `flags[]`, `tags[]`, `collections[]`, `metadata`, `defaultAttributes`, `userAttributes`, `equipSlot(s)`, `isArchived`, `isSeen`, `quantifiable`, `templateId`, `created_at`/`updated_at`/`expiryDate`/`template_*`.
- **`itemType` enum** (`schemas/InventoryItemType.yaml`): `bundle | droneskin | emoji | portalskin | prop | sticker | warpeffect`. So **stickers and emoji are filtered via `?types=sticker` / `?types=emoji`**; props via `?types=prop`. Note id prefixes from your task (`inv_`) are the InventoryItemID; itemType is the discriminator.
- **Cross-check (VRCX `src/api/inventory.js`)**: `getInventoryItems` → `GET inventory` with params `{ n, offset, order, types?, flags?, notFlags?, archived? }`. Exact match.
- **Caveat**: `holderId` other than self may 403 (NoPermission). Prints are NOT in inventory itemType enum — they have their own API (section 3).

---

## 3. Prints (涂鸦 / camera photos, `prnt_`) — **DOCUMENTED**

Spec source: `openapi/components/paths/prints.yaml`.

| Method | Path | operationId | Notes |
|---|---|---|---|
| `GET` | `/prints/user/{userId}` | getUserPrints | **Must be your own userId** — 403 `"Unable to request another user's prints."` otherwise. Returns `Print[]`. |
| `GET` | `/prints/{printId}` | getPrint | Single print. |
| `POST` | `/prints` | uploadPrint | **multipart/form-data**: `image` (binary png, required), `timestamp` (date-time, required), `note`, `worldId`, `worldName`. |
| `POST` | `/prints/{printId}` | editPrint | **multipart/form-data**: `image` (required), `note`. |
| `DELETE` | `/prints/{printId}` | deletePrint | Empty 200 on success. |

- **Print object shape**: `id` (`prnt_...`), `authorId`, `authorName`, `ownerId`, `note`, `createdAt`, `timestamp`, `worldId`, `worldName`, **`files: { fileId, image }`** — the displayable image URL is **`files.image`** (no top-level image field).
- **Cross-check (VRCX `src/api/vrcPlusImage.js`)**: `getPrints` → `GET prints/user/${getCurrentUserId()}`; `getPrint` → `GET prints/${printId}`; `deletePrint` → `DELETE prints/${printId}`; `uploadPrint` → `POST prints` (multipart, plus a `cropWhiteBorder` client-side option); `editPrint` (`POST prints/${printId}`) is **commented out** in VRCX. Exact match.

---

## 4. File / image upload pipeline — **DOCUMENTED**

Spec source: `openapi/components/paths/files.yaml`. Two distinct flows.

### 4a. Simple image upload (icon / gallery / emoji / sticker / avatar image) — single multipart POST

| Method | Path | operationId | Notes |
|---|---|---|---|
| `POST` | `/file/image` | uploadImage | **Primary multipart endpoint.** Fields: `file` (binary png, required), `tag` (ImagePurpose, **required**), plus animation fields for animated emoji: `animationStyle`, `frames` (2-64), `framesOverTime` (1-64 fps), `loopStyle`, `maskTag`. Returns a `File` object. |
| `POST` | `/file/image` | (alias) `tag=gallery` | gallery image (VRCX uses this) |
| `POST` | `/gallery` | uploadGalleryImage | multipart `file` only — dedicated gallery upload. |
| `POST` | `/icon` | uploadIcon | multipart `file` only — dedicated icon upload. |

- **`tag` (ImagePurpose) enum** (`schemas/ImagePurpose.yaml`): `admin | avatargallery | avatarimage | bundle | emoji | emojianimated | gallery | icon | listinggallery | product | sticker`. This single field selects what the uploaded image becomes.
- **Cross-check (VRCX `src/api/vrcPlusImage.js`)**: `uploadGalleryImage` → `POST file/image` body `{tag:'gallery'}`; `uploadSticker`/`uploadEmoji` → `POST file/image` with `matchingDimensions:true` and caller-supplied params (tag = `sticker`/`emoji`/`emojianimated`). So **VRChat's live client uploads stickers/emoji/gallery all through `/file/image` with different `tag`**, not the dedicated `/gallery` `/icon` paths (those exist but VRCX prefers `/file/image`).
- **Image resize/dimension requirements** (from VRCX behavior — **community/reverse-engineered, UNVERIFIED against an official spec field**): stickers/emoji require square "matching dimensions" (VRCX flag `matchingDimensions:true`); gallery does not. Exact px limits are **UNVERIFIED** — a live upload capture would confirm the max resolution and whether server rejects non-square sticker/emoji.

### 4b. Full File object lifecycle (used for avatar asset/image versions, multi-part S3) — **DOCUMENTED**

| Method | Path | operationId | Notes |
|---|---|---|---|
| `POST` | `/file` | createFile | Body `CreateFileRequest` (JSON): `name`, `mimeType`, `extension`, `tags` (all required except tags). Creates empty File. |
| `GET` | `/file/{fileId}` | getFile | File + its versions. |
| `POST` | `/file/{fileId}` | createFileVersion | Body `CreateFileVersionRequest`. New version, then start upload. |
| `DELETE` | `/file/{fileId}` | deleteFile | |
| `GET` | `/file/{fileId}/{versionId}` | downloadFileVersion | **This is the displayable image URL form** (e.g. `.../file/file_xxx/1`). Version 0 = creation; real data at version 1+. |
| `DELETE` | `/file/{fileId}/{versionId}` | deleteFileVersion | Only latest version. |
| `PUT` | `/file/{fileId}/{versionId}/{fileType}/start` | startFileDataUpload | Returns an **AWS S3 presigned URL** to `PUT` the bytes to. `fileType` ∈ file/signature/etc. |
| `PUT` | `/file/{fileId}/{versionId}/{fileType}/finish` | finishFileDataUpload | Body `{ etags:[...], maxParts, nextPartNumber }` (S3 ETags from the PUT). |
| `GET` | `/file/{fileId}/{versionId}/{fileType}/status` | getFileDataUploadStatus | Only works while `status=waiting`. |
| `GET` | `/files` | getFiles | **List own files. Query `tag` (e.g. `icon`, `gallery`).** `userId` param is deprecated (always 500s). This is how you enumerate gallery/icon slots. |

- **Important upload note**: avatar/world asset uploads use the multi-step start→S3 PUT→finish flow. Simple images (icon/gallery/emoji/sticker/print) use the one-shot multipart endpoints in 4a. For VRCSM you almost certainly only need 4a + `/avatars` (section 7) referencing an already-uploaded `imageUrl`.

---

## 5. Gallery (VRChat+ gallery image slots) — **DOCUMENTED (no per-user gallery path)**

- **There is NO `GET /users/{id}/gallery` or `POST /users/{id}/gallery`.** That path in the task brief does **not exist** in the spec.
- Real gallery model: upload via `POST /gallery` or `POST /file/image?tag=gallery`; **list via `GET /files?tag=gallery`**; delete via `DELETE /file/{fileId}`. Gallery images are just `File` objects tagged `gallery`.
- VRChat+ gating: gallery is a VRChat+ ("supporter") feature; non-supporters get limited/zero slots. The gate is server-side (the upload returns an error for non-supporters). **Exact slot count gating is UNVERIFIED** — would need a live account capture (supporter vs non-supporter).

---

## 6. Custom user icon — **DOCUMENTED**

- Upload the image: `POST /icon` (or `POST /file/image?tag=icon`) → returns a `File` with a `/file/file_xxx/1` URL.
- **Set it on the profile**: `PUT /users/{userId}` (the existing `updateAuthUser` path, VrcApi.cpp:2247) with body field **`userIcon`** = "a valid VRChat /file/ url" (example in spec: `https://api.vrchat.cloud/api/1/file/file_76dc2964-.../1`).
- `CurrentUser` also exposes `profilePicOverride` + `profilePicOverrideThumbnail` (a separate VRChat+ "profile picture" distinct from userIcon), settable the same way via `PUT /users/{userId}`. (Confirmed both fields present in `schemas/CurrentUser.yaml`.)
- **VRChat+ gating**: `userIcon` / `profilePicOverride` only stick for supporters (tag `system_supporter` in `CurrentUser.tags`). Non-supporters can upload the file but the profile field is ignored/rejected. **Gating behavior is community knowledge — UNVERIFIED against a spec field**; a live capture on a non-supporter account confirms.

---

## 7. Avatar ownership + writes — **DOCUMENTED**

Spec source: `openapi/components/paths/avatars.yaml`.

| Method | Path | operationId | Notes |
|---|---|---|---|
| `GET` | `/avatars?user=me&releaseStatus=all` | searchAvatars | **List your own avatars.** `user` enum only accepts `me`; you cannot list other users' avatars (spec explicitly says so). Other query: `featured`, `sort`, `n`, `order`, `offset`, `tag`, `notag`, `releaseStatus`, `platform`, min/maxUnityVersion. Returns `Avatar[]`. |
| `GET` | `/avatars/{avatarId}` | getAvatar | Single avatar (your existing `fetchAvatarDetails`, VrcApi.cpp:1608). |
| `POST` | `/avatars` | createAvatar | Body `CreateAvatarRequest` — required `name` + `imageUrl`; optional `description`, `releaseStatus`, `assetUrl`, `unityPackageUrl`, `tags`, `platform`, `id`, `unityVersion`, `version`, `thumbnailImageUrl`. |
| `PUT` | `/avatars/{avatarId}` | updateAvatar | Body `UpdateAvatarRequest` — **writable: `name`, `description`, `imageUrl`, `releaseStatus`, `tags`, `assetUrl`, `unityPackageUrl`, `unityVersion`, `version`, `featured`(admin-only)**. Partial — send only changed fields. |
| `DELETE` | `/avatars/{avatarId}` | deleteAvatar | **Soft delete**: sets `releaseStatus=hidden` and deletes linked Files; the AvatarID is permanently reserved (never truly deleted). |
| `PUT` | `/avatars/{avatarId}/select` | selectAvatar | Already implemented (VrcApi.cpp:2109). |
| `GET` | `/users/{userId}/avatar` | getOwnAvatar | Current avatar of a user. |

- **`releaseStatus` enum** (`schemas/ReleaseStatus.yaml`, not re-fetched but standard): `public | private | hidden | all`. Use `all` only as the query filter for listing your own.
- **Account model-management page flow** (rename / change image / delete / upload): list via `GET /avatars?user=me&releaseStatus=all` → rename/reimage/change-visibility via `PUT /avatars/{id}` (name / imageUrl / releaseStatus) → delete via `DELETE /avatars/{id}`. To change the image: upload via `POST /file/image?tag=avatarimage` first, then `PUT /avatars/{id}` with the new `imageUrl`. **Uploading a brand-new avatar (the asset bundle) requires the full 4b S3 pipeline** — heavy; the model-management page can rename/reimage/delete/set-visibility without it, but true "upload avatar" needs section 4b.

---

## Risk / policy flags for VRCSM

1. **All writes here mutate the live VRChat account.** Per CLAUDE.md "no mutation without explicit user action; destructive ops default to dry-run." `DELETE /avatars/{id}`, `DELETE /prints/{id}`, `DELETE /file/{id}`, `DELETE /inventory/{id}` are the destructive ones — gate behind explicit confirm + dry-run, and note avatar delete is soft (reversible by re-setting releaseStatus) while file/print delete is **not**.
2. **Rate limit**: route every new call through the existing `RateLimiter` (VrcApi.cpp:742). Seed inventory/prints/avatars/gallery once via REST, then maintain via the websocket pipeline (`fetchPipelineToken`, VrcApi.cpp:2454). Do not poll faster than the policy allows.
3. **New multipart plumbing required**: `httpRequestOnce` only accepts a UTF-8 string body. Sections 3, 4, 6 (uploads) need a new multipart/form-data builder + raw-binary capable request path (and, for full avatar uploads, an S3 presigned-URL `PUT`). This does not exist yet — it is net-new for Wave 2.
4. **VRChat+ gating** (gallery slots, userIcon, profilePicOverride, custom emoji/sticker counts) is **server-side and community-understood, not spec-enumerated** — flagged UNVERIFIED. A live capture on supporter vs non-supporter accounts is the only way to confirm exact limits.
5. **Sticker/emoji dimension constraints** (square / matchingDimensions): inferred from VRCX client behavior — **UNVERIFIED**; live upload capture confirms exact px limits and rejection rules.
6. **TOS**: the API key and UA conventions are already in-repo. These are the same endpoints VRChat's own client + VRCX use; all are in the community OpenAPI spec. None are admin-only except `featured` flags. No reverse-engineered/undocumented endpoints were needed — everything above is in the official-community OpenAPI spec and corroborated in VRCX source.

## Sources
- Official-community OpenAPI spec (machine-readable, authoritative): [vrchatapi/specification](https://github.com/vrchatapi/specification) — paths fetched verbatim from `openapi/components/paths/{inventory,prints,files,avatars,users}.yaml` and the `schemas/`+`requests/` referenced above.
- Rendered docs: [Send Boop](https://vrchat.community/reference/boop), [Get Own Prints](https://vrchat.community/reference/get-user-prints), [OpenAPI Specification • VRChat.community](https://vrchat.community/docs/api/).
- VRCX cross-check (real client usage): [vrcx-team/VRCX](https://github.com/vrcx-team/VRCX) — `src/api/misc.js` (boop), `src/api/inventory.js` (inventory list), `src/api/vrcPlusImage.js` (prints + gallery/sticker/emoji upload).
- VRCSM local conventions: `D:\Project\VRCSM\src\core\VrcApi.cpp` and `VrcApi.h` (line refs inline above).