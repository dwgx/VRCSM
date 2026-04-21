/* VRCSM plugin panel — AutoUploader v0.9.2
 *
 * Runs inside a WebView2 iframe at `plugin.dev-vrcsm-autouploader.vrcsm`.
 * Calls host handlers through `chrome.webview.postMessage` directly —
 * WebView2 injects that object into every frame, and
 * IpcBridge::DispatchFromOrigin identifies the caller by frame source
 * (→ callerPluginId = "dev.vrcsm.autouploader") and routes the request
 * through the `plugin.rpc` permission gate.
 *
 * v0.9.1: replaced the Win32 `shell.pickFolder` call with an in-panel
 * folder browser backed by the new `fs.listDir` IPC — the native
 * dialog frequently hid behind the WebView2 frame and was unusable.
 *
 * v0.9.2: scan walks the picked root's subfolders and shows an inline
 * rename table. Each row has an editable "Upload as…" field; edits
 * persist in localStorage keyed by the root path so collisions keep
 * their renames across sessions. On upload, the panel writes a
 * `.vrcsm-upload-plan.json` next to the root via the new narrow
 * `fs.writePlan` IPC; the Python runner picks it up and applies the
 * rename map before dispatching tasks to Unity.
 *
 * We deliberately do NOT use `window.parent.postMessage` relays — the
 * relay path goes through the host SPA origin (app.vrcsm), which the
 * plugin.rpc handler rejects with `invalid_caller` because it cannot
 * verify the caller is really a plugin.
 */

(() => {
  "use strict";

  // ── i18n ──────────────────────────────────────────────────────────────
  const I18N = {
    en: {
      title: "VRChat Auto-Uploader",
      subtitle: "Batch-upload .unitypackage avatars without the 25% failure rate.",
      step1: "1 · Pick model root folder",
      step1Hint: "Drop the folder that contains every avatar's .unitypackage (recursion supported).",
      chooseFolder: "Choose folder…",
      notSelected: "(not selected)",
      step2: "2 · Scan + rename",
      step2Hint: "Reads the subfolders of the chosen root; each one will be uploaded as an avatar.",
      scan: "Scan",
      resetNames: "Reset all to folder name",
      step3: "3 · Upload",
      step3Hint: "Runs the Unity Editor headless, one avatar at a time.",
      startUpload: "Start upload batch",
      cancel: "Cancel",
      idle: "idle",
      log: "Log",
      clear: "Clear",
      results: "Results",
      thFolder: "Folder",
      thUploadAs: "Upload as…",
      thCollisions: "Collisions",
      thName: "Name",
      thStatus: "Status",
      thNote: "Note",
      pickerTitle: "Choose avatar root folder",
      pickerUp: "▲ Up",
      pickerHome: "This PC",
      pickerHint: "Double-click a folder to descend.",
      pickerChoose: "Choose this folder",
    },
    "zh-CN": {
      title: "VRChat 自动上传器",
      subtitle: "批量上传 .unitypackage 模型，告别 25% 的失败率。",
      step1: "1 · 选择模型根目录",
      step1Hint: "选择包含所有模型 .unitypackage 的文件夹（支持递归扫描）。",
      chooseFolder: "选择文件夹…",
      notSelected: "（未选择）",
      step2: "2 · 扫描 + 重命名",
      step2Hint: "读取根目录下的子文件夹，每个子文件夹将作为一个模型上传。",
      scan: "扫描",
      resetNames: "全部重置为文件夹名",
      step3: "3 · 上传",
      step3Hint: "使用 Unity 编辑器无头模式，逐个上传模型。",
      startUpload: "开始批量上传",
      cancel: "取消",
      idle: "空闲",
      log: "日志",
      clear: "清空",
      results: "结果",
      thFolder: "文件夹",
      thUploadAs: "上传名称…",
      thCollisions: "冲突",
      thName: "名称",
      thStatus: "状态",
      thNote: "备注",
      pickerTitle: "选择模型根目录",
      pickerUp: "▲ 上级",
      pickerHome: "此电脑",
      pickerHint: "双击文件夹进入。",
      pickerChoose: "选择此文件夹",
    },
    ja: {
      title: "VRChat 自動アップローダー",
      subtitle: ".unitypackage アバターを一括アップロード。",
      step1: "1 · モデルルートフォルダを選択",
      step1Hint: "アバターの .unitypackage を含むフォルダを選択してください。",
      chooseFolder: "フォルダを選択…",
      notSelected: "（未選択）",
      step2: "2 · スキャン + リネーム",
      step2Hint: "ルート内のサブフォルダを読み取り、各フォルダをアバターとしてアップロードします。",
      scan: "スキャン",
      resetNames: "フォルダ名にリセット",
      step3: "3 · アップロード",
      step3Hint: "Unity エディタをヘッドレスで実行し、アバターを1つずつアップロードします。",
      startUpload: "一括アップロード開始",
      cancel: "キャンセル",
      idle: "待機中",
      log: "ログ",
      clear: "クリア",
      results: "結果",
      thFolder: "フォルダ",
      thUploadAs: "アップロード名…",
      thCollisions: "重複",
      thName: "名前",
      thStatus: "ステータス",
      thNote: "メモ",
      pickerTitle: "アバタールートフォルダを選択",
      pickerUp: "▲ 上へ",
      pickerHome: "PC",
      pickerHint: "ダブルクリックでフォルダに移動。",
      pickerChoose: "このフォルダを選択",
    },
    ko: {
      title: "VRChat 자동 업로더",
      subtitle: "실패 없이 .unitypackage 아바타를 일괄 업로드합니다.",
      step1: "1 · 모델 루트 폴더 선택",
      step1Hint: "모든 아바타의 .unitypackage가 포함된 폴더를 놓으세요 (하위 폴더 검색 지원).",
      chooseFolder: "폴더 선택…",
      notSelected: "(선택 안 됨)",
      step2: "2 · 스캔 및 이름 변경",
      step2Hint: "선택한 루트의 하위 폴더를 스캔합니다. 각 폴더가 하나의 아바타로 업로드됩니다.",
      scan: "스캔",
      resetNames: "모두 폴더명으로 초기화",
      step3: "3 · 업로드",
      step3Hint: "Unity Editor를 헤드리스 모드로 실행하여 한 번에 하나씩 아바타를 업로드합니다.",
      startUpload: "일괄 업로드 시작",
      cancel: "취소",
      idle: "대기 중",
      log: "로그",
      clear: "지우기",
      results: "결과",
      thFolder: "폴더",
      thUploadAs: "업로드할 이름…",
      thCollisions: "충돌",
      thName: "이름",
      thStatus: "상태",
      thNote: "참고",
      pickerTitle: "아바타 루트 폴더 선택",
      pickerUp: "▲ 위로",
      pickerHome: "내 PC",
      pickerHint: "폴더를 더블 클릭하여 하위 폴더로 이동합니다.",
      pickerChoose: "이 폴더 선택",
    },
    ru: {
      title: "Автозагрузчик VRChat",
      subtitle: "Пакетная загрузка аватаров .unitypackage без 25% вероятности сбоя.",
      step1: "1 · Выберите корневую папку моделей",
      step1Hint: "Перетащите папку, содержащую файлы .unitypackage каждого аватара (поддерживается рекурсия).",
      chooseFolder: "Выбрать папку…",
      notSelected: "(не выбрано)",
      step2: "2 · Сканирование + переименование",
      step2Hint: "Считывает вложенные папки выбранного корня; каждая из них будет загружена как отдельный аватар.",
      scan: "Сканировать",
      resetNames: "Сбросить на имена папок",
      step3: "3 · Загрузка",
      step3Hint: "Запускает Unity Editor в фоновом режиме, по одному аватару за раз.",
      startUpload: "Начать пакетную загрузку",
      cancel: "Отмена",
      idle: "ожидание",
      log: "Лог",
      clear: "Очистить",
      results: "Результаты",
      thFolder: "Папка",
      thUploadAs: "Загрузить как…",
      thCollisions: "Конфликты",
      thName: "Имя",
      thStatus: "Статус",
      thNote: "Примечание",
      pickerTitle: "Выберите корневую папку аватаров",
      pickerUp: "▲ Вверх",
      pickerHome: "Этот компьютер",
      pickerHint: "Двойной клик по папке для перехода внутрь.",
      pickerChoose: "Выбрать эту папку",
    },
    th: {
      title: "VRChat Auto-Uploader",
      subtitle: "อัปโหลดอวตาร .unitypackage เป็นชุดโดยไม่มีอัตราความล้มเหลว 25%",
      step1: "1 · เลือกโฟลเดอร์หลักของโมเดล",
      step1Hint: "ลากวางโฟลเดอร์ที่มี .unitypackage ของอวตารทุกตัว (รองรับโฟลเดอร์ย่อย)",
      chooseFolder: "เลือกโฟลเดอร์…",
      notSelected: "(ไม่ได้เลือก)",
      step2: "2 · สแกน + เปลี่ยนชื่อ",
      step2Hint: "อ่านโฟลเดอร์ย่อยของโฟลเดอร์หลักที่เลือก แต่ละโฟลเดอร์จะถูกอัปโหลดเป็นหนึ่งอวตาร",
      scan: "สแกน",
      resetNames: "รีเซ็ตทั้งหมดเป็นชื่อโฟลเดอร์",
      step3: "3 · อัปโหลด",
      step3Hint: "รัน Unity Editor แบบ headless ทีละอวตาร",
      startUpload: "เริ่มอัปโหลดเป็นชุด",
      cancel: "ยกเลิก",
      idle: "ว่าง",
      log: "ล็อก",
      clear: "ล้าง",
      results: "ผลลัพธ์",
      thFolder: "โฟลเดอร์",
      thUploadAs: "อัปโหลดเป็น…",
      thCollisions: "ชื่อซ้ำ",
      thName: "ชื่อ",
      thStatus: "สถานะ",
      thNote: "หมายเหตุ",
      pickerTitle: "เลือกโฟลเดอร์หลักของอวตาร",
      pickerUp: "▲ ขึ้น",
      pickerHome: "พีซีเครื่องนี้",
      pickerHint: "ดับเบิลคลิกที่โฟลเดอร์เพื่อเปิด",
      pickerChoose: "เลือกโฟลเดอร์นี้",
    },
    hi: {
      title: "VRChat ऑटो-अपलोडर",
      subtitle: "25% विफलता दर के बिना .unitypackage अवतारों को बैच-अपलोड करें।",
      step1: "1 · मॉडल रूट फ़ोल्डर चुनें",
      step1Hint: "वह फ़ोल्डर डालें जिसमें हर अवतार का .unitypackage हो (रिकर्सन समर्थित)।",
      chooseFolder: "फ़ोल्डर चुनें…",
      notSelected: "(चयनित नहीं)",
      step2: "2 · स्कैन + नाम बदलें",
      step2Hint: "चुने गए रूट के सबफ़ोल्डर पढ़ता है; हर एक को एक अवतार के रूप में अपलोड किया जाएगा।",
      scan: "स्कैन",
      resetNames: "सभी को फ़ोल्डर के नाम पर रीसेट करें",
      step3: "3 · अपलोड",
      step3Hint: "Unity एडिटर को हेडलेस चलाता है, एक बार में एक अवतार।",
      startUpload: "अपलोड बैच शुरू करें",
      cancel: "रद्द करें",
      idle: "निष्क्रिय",
      log: "लॉग",
      clear: "साफ़ करें",
      results: "परिणाम",
      thFolder: "फ़ोल्डर",
      thUploadAs: "इस रूप में अपलोड करें…",
      thCollisions: "टकराव",
      thName: "नाम",
      thStatus: "स्थिति",
      thNote: "नोट",
      pickerTitle: "अवतार रूट फ़ोल्डर चुनें",
      pickerUp: "▲ ऊपर",
      pickerHome: "यह पीसी",
      pickerHint: "अंदर जाने के लिए फ़ोल्डर पर डबल-क्लिक करें।",
      pickerChoose: "यह फ़ोल्डर चुनें",
    },
  };

  function detectLocale() {
    const nav = (navigator.language || "en").toLowerCase();
    if (nav.startsWith("zh")) return "zh-CN";
    if (nav.startsWith("ja")) return "ja";
    if (nav.startsWith("ko")) return "ko";
    if (nav.startsWith("ru")) return "ru";
    if (nav.startsWith("th")) return "th";
    if (nav.startsWith("hi")) return "hi";
    return "en";
  }

  const locale = detectLocale();
  const strings = { ...I18N.en, ...(I18N[locale] || {}) };

  function t(key) { return strings[key] || key; }

  function applyI18n() {
    for (const el of document.querySelectorAll("[data-t]")) {
      const key = el.getAttribute("data-t");
      if (strings[key]) el.textContent = strings[key];
    }
    document.documentElement.lang = locale === "zh-CN" ? "zh-CN" : locale;
  }
  applyI18n();

  const pending = new Map();
  let msgId = 0;

  function nextId() {
    msgId += 1;
    return `au-${Date.now()}-${msgId}`;
  }

  function getWebview() {
    return (
      (typeof window !== "undefined" && window.chrome && window.chrome.webview) ||
      null
    );
  }

  function ipcCall(method, params) {
    return new Promise((resolve, reject) => {
      const wv = getWebview();
      if (!wv) {
        reject(new Error("chrome.webview unavailable — not running in VRCSM"));
        return;
      }
      const id = nextId();
      pending.set(id, { resolve, reject });

      wv.postMessage(
        JSON.stringify({
          id,
          method: "plugin.rpc",
          params: { method, params: params ?? {} },
        }),
      );

      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`ipc timeout: ${method}`));
        }
      }, 60000);
    });
  }

  const wv = getWebview();
  if (wv) {
    wv.addEventListener("message", (event) => {
      let data;
      try {
        data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!data || typeof data.id !== "string") return;
      const handler = pending.get(data.id);
      if (!handler) return;
      pending.delete(data.id);
      if (data.error) {
        handler.reject(
          new Error(data.error.message || data.error.code || "ipc error"),
        );
      } else {
        handler.resolve(data.result);
      }
    });
  }

  // v0.9.1: `shell.pickFolder` opened a native IFileOpenDialog that
  // was frequently invisible behind the WebView2 frame. Replaced with
  // an in-panel modal backed by `fs.listDir` — read-only directory
  // listing through the same `ipc:shell` permission.
  function pickFolder(title) {
    return openInlinePicker({
      title: title || "Choose avatar root folder",
      initialDir: state.folder || "",
    });
  }

  // ── In-panel folder picker ────────────────────────────────────────────
  const picker = {
    backdrop: document.getElementById("picker-backdrop"),
    title: document.getElementById("picker-title"),
    pathEl: document.getElementById("picker-path"),
    list: document.getElementById("picker-list"),
    chooseBtn: document.getElementById("picker-choose"),
    cancelBtn: document.getElementById("picker-cancel"),
    closeBtn: document.getElementById("picker-close"),
    upBtn: document.getElementById("picker-up"),
    homeBtn: document.getElementById("picker-home"),
    current: "",
    parent: null,
    resolve: null,
    reqSeq: 0,
  };

  function pickerShow(title, initialDir) {
    picker.backdrop.hidden = false;
    picker.title.textContent = title;
    pickerNavigate(initialDir || "");
  }
  function pickerHide() {
    picker.backdrop.hidden = true;
  }
  function pickerFinish(result) {
    const resolve = picker.resolve;
    picker.resolve = null;
    pickerHide();
    if (resolve) resolve(result);
  }
  function openInlinePicker(opts) {
    return new Promise((resolve) => {
      picker.resolve = resolve;
      pickerShow(opts.title || "Choose folder", opts.initialDir || "");
    });
  }
  function escapeHtmlAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  async function pickerNavigate(path) {
    const seq = ++picker.reqSeq;
    picker.list.setAttribute("aria-busy", "true");
    picker.list.innerHTML =
      '<div class="picker-empty">Loading…</div>';
    try {
      const data = await ipcCall("fs.listDir", { path });
      if (seq !== picker.reqSeq) return;
      picker.current = data.path || "";
      picker.parent = data.parent || null;
      picker.pathEl.textContent = picker.current || "(This PC)";
      picker.chooseBtn.disabled = !picker.current;

      picker.list.innerHTML = "";
      if (!picker.current) {
        const roots = Array.isArray(data.roots) ? data.roots : [];
        if (roots.length === 0) {
          picker.list.innerHTML =
            '<div class="picker-empty">No drives detected.</div>';
        } else {
          for (const root of roots) {
            picker.list.appendChild(makeRow(root.path, root.label, true));
          }
        }
      } else {
        const dirs = (data.entries || []).filter((e) => e.isDir);
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        if (dirs.length === 0) {
          picker.list.innerHTML =
            '<div class="picker-empty">No subfolders here.</div>';
        } else {
          for (const entry of dirs) {
            const next = joinPath(picker.current, entry.name);
            picker.list.appendChild(makeRow(next, entry.name, false));
          }
        }
        if (data.truncated) {
          const tail = document.createElement("div");
          tail.className = "picker-empty";
          tail.textContent = "List truncated at 2000 entries.";
          picker.list.appendChild(tail);
        }
      }
    } catch (e) {
      if (seq !== picker.reqSeq) return;
      picker.list.innerHTML =
        '<div class="picker-error">' +
        escapeHtmlAttr(e.message || String(e)) +
        "</div>";
      picker.chooseBtn.disabled = true;
    } finally {
      if (seq === picker.reqSeq) {
        picker.list.setAttribute("aria-busy", "false");
      }
    }
  }
  function joinPath(base, name) {
    if (!base) return name;
    const sep = base.includes("\\") ? "\\" : "/";
    return base.endsWith(sep) ? base + name : base + sep + name;
  }
  const ICON_DRIVE =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/></svg>';
  const ICON_FOLDER =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

  function makeRow(fullPath, label, isRoot) {
    const row = document.createElement("div");
    row.className = "picker-row" + (isRoot ? " root" : "");
    row.innerHTML =
      '<span class="icon">' +
      (isRoot ? ICON_DRIVE : ICON_FOLDER) +
      "</span>" +
      '<span class="name">' +
      escapeHtmlAttr(isRoot ? fullPath : label) +
      "</span>" +
      (isRoot && label
        ? '<span class="meta">' + escapeHtmlAttr(label) + "</span>"
        : "");
    row.addEventListener("click", (e) => {
      if (e.detail > 1) return;
      pickerNavigate(fullPath);
    });
    row.addEventListener("dblclick", () => pickerNavigate(fullPath));
    return row;
  }
  picker.cancelBtn.addEventListener("click", () =>
    pickerFinish({ cancelled: true }),
  );
  picker.closeBtn.addEventListener("click", () =>
    pickerFinish({ cancelled: true }),
  );
  picker.chooseBtn.addEventListener("click", () => {
    if (!picker.current) return;
    pickerFinish({ cancelled: false, path: picker.current });
  });
  picker.upBtn.addEventListener("click", () => {
    pickerNavigate(picker.parent || "");
  });
  picker.homeBtn.addEventListener("click", () => {
    pickerNavigate("");
  });
  picker.backdrop.addEventListener("click", (e) => {
    if (e.target === picker.backdrop) pickerFinish({ cancelled: true });
  });
  document.addEventListener("keydown", (e) => {
    if (picker.backdrop.hidden) return;
    if (e.key === "Escape") pickerFinish({ cancelled: true });
  });

  function openUrl(url) {
    return ipcCall("shell.openUrl", { url });
  }

  // ─── State ────────────────────────────────────────────────────────────
  const state = {
    folder: null,
    // `avatars`: [{origDir, uploadName, skip, dirty, collision}]
    // `origDir` is the subdirectory name — the stable key used for
    //   both localStorage and the plan file written to disk.
    // `uploadName` is what the Python runner will rename to before
    //   feeding Unity. Defaults to origDir, overridable per-row,
    //   auto-suffixed on collision unless the user already set a
    //   unique value.
    avatars: [],
    uploading: false,
  };

  // ─── DOM refs ─────────────────────────────────────────────────────────
  const $folderBtn = document.getElementById("pick-folder");
  const $folderDisplay = document.getElementById("folder-display");
  const $scanBtn = document.getElementById("scan");
  const $resetNamesBtn = document.getElementById("reset-names");
  const $scanResult = document.getElementById("scan-result");
  const $renameWrap = document.getElementById("rename-list-wrap");
  const $renameBody = document.querySelector("#rename-list tbody");
  const $renameSelectAll = document.getElementById("rename-select-all");
  const $renameSummary = document.getElementById("rename-summary");
  const $uploadBtn = document.getElementById("upload");
  const $cancelBtn = document.getElementById("cancel");
  const $progress = document.getElementById("progress");
  const $progressLabel = document.getElementById("progress-label");
  const $log = document.getElementById("log");
  const $clearLog = document.getElementById("clear-log");

  // ─── Rename memory (localStorage) ────────────────────────────────────
  // Keyed by absolute root path so different model roots get
  // independent rename maps. We only persist user-edited names —
  // values that equal the original folder name get culled on save so
  // stale entries don't accumulate forever.
  function renameStorageKey(root) {
    return "au:renames:" + root;
  }
  function loadRenames(root) {
    try {
      const raw = localStorage.getItem(renameStorageKey(root));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  function saveRenames(root, map) {
    try {
      const trimmed = {};
      for (const [k, v] of Object.entries(map)) {
        if (typeof v === "string" && v && v !== k) trimmed[k] = v;
      }
      if (Object.keys(trimmed).length === 0) {
        localStorage.removeItem(renameStorageKey(root));
      } else {
        localStorage.setItem(renameStorageKey(root), JSON.stringify(trimmed));
      }
    } catch (e) {
      log("localStorage write failed: " + e.message, "warn");
    }
  }

  // ─── Log ──────────────────────────────────────────────────────────────
  function log(msg, kind) {
    const row = document.createElement("div");
    row.className = "entry" + (kind ? " " + kind : "");
    const ts = new Date().toTimeString().slice(0, 8);
    row.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(msg)}`;
    $log.appendChild(row);
    $log.scrollTop = $log.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ─── Folder pick ──────────────────────────────────────────────────────
  $folderBtn.addEventListener("click", async () => {
    try {
      const res = await pickFolder();
      if (res?.cancelled) {
        log("Folder selection cancelled.");
        return;
      }
      if (!res?.path) {
        log("No path returned from picker.", "warn");
        return;
      }
      state.folder = res.path;
      $folderDisplay.textContent = res.path;
      $scanBtn.disabled = false;
      $uploadBtn.disabled = true;
      $renameWrap.hidden = true;
      state.avatars = [];
      log(`Folder set: ${res.path}`, "ok");
    } catch (e) {
      log(`Folder pick failed: ${e.message}`, "err");
    }
  });

  // ─── Excluded folders ─────────────────────────────────────────────────
  // Mirrors the deny-list inside extractor.py so the panel's "Found N
  // avatars" count matches what the runner actually queues.
  const EXCLUDED_DIRS = new Set([
    "TempVRCProject",
    "VRC-Auto-Uploader",
    "tools",
  ]);
  function isAvatarDir(name) {
    if (!name) return false;
    if (name.startsWith(".")) return false;
    if (name.startsWith("_")) return false;
    return !EXCLUDED_DIRS.has(name);
  }

  // ─── Scan + render ────────────────────────────────────────────────────
  $scanBtn.addEventListener("click", async () => {
    if (!state.folder) return;
    $scanBtn.disabled = true;
    $resetNamesBtn.disabled = true;
    $scanResult.textContent = "Scanning…";
    state.avatars = [];
    $renameBody.innerHTML = "";
    $renameWrap.hidden = false;
    log(`Scanning ${state.folder}…`);

    try {
      const data = await ipcCall("fs.listDir", { path: state.folder });
      const dirs = (data.entries || [])
        .filter((e) => e.isDir && isAvatarDir(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

      if (dirs.length === 0) {
        $scanResult.textContent = "No avatar subfolders found.";
        log("No avatar subfolders found in that root.", "warn");
        $renameWrap.hidden = true;
        $scanBtn.disabled = false;
        return;
      }

      const memory = loadRenames(state.folder);
      state.avatars = dirs.map((origDir) => ({
        origDir,
        uploadName: memory[origDir] || origDir,
        skip: false,
        // Track whether the in-memory name diverges from the folder
        // name so the row can be styled and the value persisted.
        dirty: !!memory[origDir] && memory[origDir] !== origDir,
      }));

      reconcileCollisions();
      renderRenameTable();
      $scanResult.textContent = `Found ${dirs.length} avatar folder${dirs.length === 1 ? "" : "s"}.`;
      const remembered = Object.keys(memory).length;
      log(
        `Scan complete — ${dirs.length} folder${dirs.length === 1 ? "" : "s"}` +
          (remembered ? `, ${remembered} remembered rename${remembered === 1 ? "" : "s"} restored` : ""),
        "ok",
      );
      $resetNamesBtn.disabled = false;
      $uploadBtn.disabled = false;
    } catch (e) {
      $scanResult.textContent = "Scan failed.";
      log(`Scan failed: ${e.message}`, "err");
    } finally {
      $scanBtn.disabled = false;
    }
  });

  $resetNamesBtn.addEventListener("click", () => {
    if (state.avatars.length === 0) return;
    for (const a of state.avatars) {
      a.uploadName = a.origDir;
      a.dirty = false;
    }
    saveRenames(state.folder, {});
    reconcileCollisions();
    renderRenameTable();
    log("All renames cleared for this root.", "ok");
  });

  $renameSelectAll.addEventListener("change", () => {
    const skip = !$renameSelectAll.checked;
    for (const a of state.avatars) a.skip = skip;
    renderRenameTable();
  });

  // ─── Collision reconciliation ────────────────────────────────────────
  // For any group of rows that resolve to the same uploadName, suffix
  // the *non-dirty* members with `_2`, `_3`, ... so user-explicit names
  // always win. Skipped rows are excluded from the duplicate count.
  function reconcileCollisions() {
    const counts = {};
    for (const a of state.avatars) {
      if (a.skip) continue;
      const name = (a.uploadName || a.origDir).trim();
      counts[name] = (counts[name] || 0) + 1;
    }
    const used = new Set(Object.keys(counts).filter((n) => counts[n] === 1));

    for (const a of state.avatars) {
      if (a.skip) {
        a.collision = false;
        continue;
      }
      const desired = (a.uploadName || a.origDir).trim() || a.origDir;
      if (a.dirty) {
        // Respect user input — flag duplicate if they typed a name
        // that still collides with another row.
        a.collision = (counts[desired] || 0) > 1;
        used.add(desired);
        continue;
      }
      if ((counts[desired] || 0) <= 1) {
        a.uploadName = desired;
        a.collision = false;
        used.add(desired);
        continue;
      }
      let suffix = 2;
      let candidate = `${desired}_${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${desired}_${suffix}`;
      }
      a.uploadName = candidate;
      a.collision = false;
      used.add(candidate);
    }
  }

  // ─── Table renderer ───────────────────────────────────────────────────
  function renderRenameTable() {
    $renameBody.innerHTML = "";
    let active = 0;
    let renamed = 0;
    let collided = 0;
    state.avatars.forEach((a, idx) => {
      const tr = document.createElement("tr");
      if (a.skip) tr.classList.add("skipped");

      const tdSkip = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !a.skip;
      cb.addEventListener("change", () => {
        a.skip = !cb.checked;
        reconcileCollisions();
        renderRenameTable();
      });
      tdSkip.appendChild(cb);
      tr.appendChild(tdSkip);

      const tdOrig = document.createElement("td");
      tdOrig.className = "orig";
      tdOrig.textContent = a.origDir;
      tr.appendChild(tdOrig);

      const tdName = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.value = a.uploadName;
      input.spellcheck = false;
      input.placeholder = a.origDir;
      if (a.dirty) input.classList.add("dirty");
      input.addEventListener("input", () => {
        a.uploadName = input.value;
        a.dirty = input.value.trim() !== a.origDir && input.value.trim() !== "";
        input.classList.toggle("dirty", a.dirty);
      });
      input.addEventListener("change", () => {
        commitRowEdit(a, input);
      });
      input.addEventListener("blur", () => {
        commitRowEdit(a, input);
      });
      tdName.appendChild(input);
      tr.appendChild(tdName);

      const tdWarn = document.createElement("td");
      tdWarn.className = "warn-cell" + (a.collision ? "" : " ok");
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = a.collision ? "dup" : "ok";
      tdWarn.appendChild(pill);
      tr.appendChild(tdWarn);

      const tdActions = document.createElement("td");
      if (a.dirty) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "btn ghost small";
        reset.textContent = "↺";
        reset.title = "Reset to folder name";
        reset.addEventListener("click", () => {
          a.uploadName = a.origDir;
          a.dirty = false;
          persistAvatars();
          reconcileCollisions();
          renderRenameTable();
        });
        tdActions.appendChild(reset);
      }
      tr.appendChild(tdActions);

      $renameBody.appendChild(tr);
      if (!a.skip) active += 1;
      if (a.dirty) renamed += 1;
      if (a.collision) collided += 1;
    });

    const bits = [
      `${active} of ${state.avatars.length} will upload`,
      renamed ? `${renamed} renamed` : null,
      collided ? `<span style="color:var(--warn)">${collided} unresolved collisions</span>` : null,
    ].filter(Boolean);
    $renameSummary.innerHTML = bits.join(" · ");
    $renameSelectAll.checked = active === state.avatars.length;
    $renameSelectAll.indeterminate = active > 0 && active < state.avatars.length;
  }

  function commitRowEdit(avatar, input) {
    const trimmed = input.value.trim();
    if (!trimmed) {
      avatar.uploadName = avatar.origDir;
      avatar.dirty = false;
      input.value = avatar.origDir;
    } else {
      avatar.uploadName = trimmed;
      avatar.dirty = trimmed !== avatar.origDir;
    }
    persistAvatars();
    reconcileCollisions();
    renderRenameTable();
  }

  function persistAvatars() {
    if (!state.folder) return;
    const map = {};
    for (const a of state.avatars) {
      if (a.dirty && a.uploadName && a.uploadName !== a.origDir) {
        map[a.origDir] = a.uploadName;
      }
    }
    saveRenames(state.folder, map);
  }

  // ─── Upload — writes plan file + tells the user the runner cmd ────────
  $uploadBtn.addEventListener("click", async () => {
    if (!state.folder || state.uploading) return;
    if (state.avatars.length === 0) {
      log("Run Scan first to populate the avatar list.", "warn");
      return;
    }
    const collided = state.avatars.filter((a) => a.collision && !a.skip);
    if (collided.length > 0) {
      log(
        `Resolve ${collided.length} duplicate name${collided.length === 1 ? "" : "s"} before dispatching.`,
        "err",
      );
      return;
    }

    state.uploading = true;
    $uploadBtn.disabled = true;
    $cancelBtn.disabled = false;
    $progress.value = 0;
    $progressLabel.textContent = "writing plan…";

    const includes = state.avatars.filter((a) => !a.skip);
    const renameMap = {};
    const skipList = [];
    for (const a of state.avatars) {
      if (a.skip) {
        skipList.push(a.origDir);
      } else if (a.uploadName && a.uploadName !== a.origDir) {
        renameMap[a.origDir] = a.uploadName;
      }
    }

    const plan = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      tool: "vrcsm-autouploader-panel",
      version: "0.9.2",
      rootPath: state.folder,
      avatars: includes.map((a) => ({ origDir: a.origDir, uploadName: a.uploadName })),
      renameMap,
      skip: skipList,
    };

    let planPath = "";
    try {
      const wr = await ipcCall("fs.writePlan", {
        rootPath: state.folder,
        content: JSON.stringify(plan, null, 2),
      });
      planPath = wr.path || "";
      log(`Plan written: ${planPath} (${wr.bytes} bytes)`, "ok");
    } catch (e) {
      log(`Failed to write plan file: ${e.message}`, "err");
      $progressLabel.textContent = "plan write failed";
      state.uploading = false;
      $uploadBtn.disabled = false;
      $cancelBtn.disabled = true;
      return;
    }

    log("Open a PowerShell next to VRCSM and run:", "warn");
    log(
      `  cd "%LocalAppData%\\VRCSM\\plugins\\dev.vrcsm.autouploader\\bin\\python"`,
    );
    log(`  python main.py batch --dir "${state.folder}" --plan "${planPath}" -y`);
    log(
      `Plan covers ${includes.length} avatar${includes.length === 1 ? "" : "s"}` +
        (Object.keys(renameMap).length
          ? `, ${Object.keys(renameMap).length} rename${Object.keys(renameMap).length === 1 ? "" : "s"}`
          : "") +
        (skipList.length ? `, ${skipList.length} skipped` : "") +
        ".",
      "ok",
    );
    log("The runner reads the plan and applies renames before Unity dispatch.");

    $progressLabel.textContent = "plan ready — run the CLI";
    $progress.value = 1;
    state.uploading = false;
    $cancelBtn.disabled = true;
    $uploadBtn.disabled = false;
  });

  $cancelBtn.addEventListener("click", () => {
    state.uploading = false;
    $cancelBtn.disabled = true;
    $uploadBtn.disabled = false;
    $progressLabel.textContent = "cancelled";
    log("Cancel requested.", "warn");
  });

  $clearLog.addEventListener("click", () => {
    $log.innerHTML = "";
  });

  // ─── Boot ─────────────────────────────────────────────────────────────
  log("VRCSM AutoUploader panel loaded — v0.9.2.", "ok");
  if (wv) {
    log("Ready. Pick a folder to begin.", "ok");
  } else {
    log(
      "chrome.webview not available — panel must run inside VRCSM, not a standalone browser.",
      "err",
    );
  }
})();
