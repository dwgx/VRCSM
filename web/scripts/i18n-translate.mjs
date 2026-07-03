#!/usr/bin/env node
// i18n 批量翻译器 —— 以 en.json 为源,补齐/翻译其它语言。
//
// 端点走 Anthropic Messages API 兼容服务(可用环境变量覆盖):
//   I18N_BASE_URL   默认 http://23.238.12.117:8990
//   I18N_API_KEY    默认 key789
//   I18N_MODEL      默认 claude-opus-4-8
//
// 用法示例:
//   node scripts/i18n-translate.mjs                      # 给所有非源语言补齐缺失 key
//   node scripts/i18n-translate.mjs --langs zh-CN,ja      # 只处理指定语言
//   node scripts/i18n-translate.mjs --prefix settings.data,osc  # 只翻这些子树下的 key
//   node scripts/i18n-translate.mjs --force --prefix osc  # 强制重翻 osc 子树(即使已存在)
//   node scripts/i18n-translate.mjs --batch 40 --concurrency 4  # 收放批大小/并发
//   node scripts/i18n-translate.mjs --dry-run             # 只报告要翻什么,不调 API 不写盘
//
// 设计:拒绝机械翻译。system prompt 交代应用领域、每语言语气与 UI 约束,
// 并强制保留 {{placeholders}}、ICU（{count, plural, ...}）、HTML 标签与 \n。

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "../src/i18n/locales");
const SOURCE_LANG = "en";

const BASE_URL = (process.env.I18N_BASE_URL || "http://23.238.12.117:8990").replace(/\/+$/, "");
const API_KEY = process.env.I18N_API_KEY || "key789";
const MODEL = process.env.I18N_MODEL || "claude-opus-4-8";

// 每种语言的“人设/语气”提示 —— 驱动地道翻译而非逐字直译。
const LANG_GUIDES = {
  "zh-CN": "简体中文。地道、简洁的软件界面用语,像国内成熟桌面软件。不要生硬直译,不要翻译成书面长句;按钮/标签要短。技术名词(OSC、VRChat、Avatar、Instance、chatbox)保留英文或用社区通用叫法。",
  ja: "日本語。VRChat コミュニティで自然な UI 表現。丁寧すぎず簡潔に。ボタンやラベルは短く。技術用語(OSC, Avatar, Instance)はカタカナまたは英語のまま。",
  ko: "한국어. VRChat 커뮤니티에서 자연스러운 UI 표현. 간결하게. 버튼/라벨은 짧게. 기술 용어(OSC, Avatar, Instance)는 영어 또는 통용 표기 유지.",
  ru: "Русский. Естественный, лаконичный интерфейсный язык. Кнопки и метки — короткие. Технические термины (OSC, VRChat, Avatar, Instance) — оставлять латиницей или общепринято.",
  th: "ภาษาไทย. ภาษา UI ที่เป็นธรรมชาติและกระชับ. ปุ่มและป้ายกำกับต้องสั้น. คำศัพท์เทคนิค (OSC, VRChat, Avatar, Instance) คงเป็นภาษาอังกฤษ.",
  hi: "हिन्दी। स्वाभाविक, संक्षिप्त UI भाषा। बटन/लेबल छोटे रखें। तकनीकी शब्द (OSC, VRChat, Avatar, Instance) अंग्रेज़ी में रखें।",
};

function parseArgs(argv) {
  const args = { langs: null, prefix: null, force: false, dryRun: false, batch: 30, concurrency: 3, model: MODEL };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--langs") args.langs = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--prefix") args.prefix = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--batch") args.batch = Math.max(1, parseInt(argv[++i], 10) || 30);
    else if (a === "--concurrency") args.concurrency = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(`i18n 批量翻译器
  --langs a,b        只处理这些语言(默认: 除 en 外全部)
  --prefix p,q       只处理这些点号前缀下的 key(如 settings.data,osc)
  --force            即使目标已存在也重翻(默认只补缺失)
  --batch N          每批 key 数(默认 30)
  --concurrency N    并发批数(默认 3)
  --model ID         模型(默认 ${MODEL})
  --dry-run          只报告,不调 API 不写盘`);
}

// ---- 嵌套 <-> 扁平 点号 key ----
function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const nk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, nk, out);
    else out[nk] = v;
  }
  return out;
}
function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== "object" || cur[p] === null || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

const matchesPrefix = (key, prefixes) => !prefixes || prefixes.some((p) => key === p || key.startsWith(p + "."));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSystemPrompt(lang) {
  const guide = LANG_GUIDES[lang] || `Translate into ${lang} using natural, concise UI language.`;
  return [
    "你是资深软件本地化专家,为一款名为 VRCSM 的 VRChat 桌面伴侣应用翻译界面文案。",
    "这些字符串出现在按钮、标签、提示、对话框、状态栏等 UI 位置。",
    "",
    `目标语言与风格要求:${guide}`,
    "",
    "硬性规则(违反即为错误):",
    "1. 绝不机械/逐字直译。产出母语用户觉得自然、地道、符合软件 UI 习惯的表达。",
    "2. 完整保留占位符 {{like_this}}、ICU 语法 {count, plural, ...}、HTML 标签 <b></b>、换行符 \\n 以及首尾空格,位置和拼写都不能改。",
    "3. UI 术语从简:按钮/标签尽量短,不要扩写成完整句子。",
    "4. 保留品牌/技术专名(VRChat、VRCSM、OSC、Avatar、Instance、chatbox、Discord 等)的通用写法。",
    "5. 只翻译值,不翻译 JSON 的 key。",
    "6. 输出必须是一个 JSON 对象,key 与输入完全一致,value 为译文。不要任何解释、不要 markdown 代码块、不要多余文字。",
  ].join("\n");
}

async function callModel({ model, system, userJson, sourceEntries }, attempt = 1) {
  const userContent = [
    "把下面 JSON 里每个 value 翻译好,返回同样 key 的 JSON 对象。",
    "这些是 UI 文案,请参考 key 名推断使用场景(如 .button/.title/.confirm/.error/.hint)。",
    "",
    userJson,
  ].join("\n");

  let resp;
  try {
    resp = await fetch(`${BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature: 0.4,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch (e) {
    if (attempt < 4) { await sleep(1000 * attempt); return callModel({ model, system, userJson, sourceEntries }, attempt + 1); }
    throw new Error(`网络错误: ${e.message}`);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if ((resp.status === 429 || resp.status >= 500) && attempt < 4) {
      await sleep(1500 * attempt); return callModel({ model, system, userJson, sourceEntries }, attempt + 1);
    }
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  const parsed = extractJson(text);
  if (!parsed) {
    if (attempt < 4) { await sleep(800 * attempt); return callModel({ model, system, userJson, sourceEntries }, attempt + 1); }
    throw new Error(`无法解析模型输出为 JSON: ${text.slice(0, 200)}`);
  }
  // 校验占位符没被弄丢
  validatePlaceholders(parsed, sourceEntries);
  return { parsed, usage: data.usage || {} };
}

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;
function validatePlaceholders(translated, source) {
  for (const [k, srcVal] of Object.entries(source)) {
    if (typeof srcVal !== "string" || !(k in translated)) continue;
    const src = (srcVal.match(PLACEHOLDER_RE) || []).sort();
    const tgt = (String(translated[k]).match(PLACEHOLDER_RE) || []).sort();
    if (src.join("|") !== tgt.join("|")) {
      console.warn(`  ⚠ 占位符不一致 [${k}] 源:${src.join(",")||"无"} 译:${tgt.join(",")||"无"}(保留源值)`);
      translated[k] = srcVal; // 占位符丢失时回退源值,宁缺毋错
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 并发池:同时最多 concurrency 个批次
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await worker(items[my], my);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const model = args.model;

  const enRaw = JSON.parse(await readFile(resolve(LOCALES_DIR, `${SOURCE_LANG}.json`), "utf8"));
  const enFlat = flatten(enRaw);

  // 目标语言列表
  let targets = args.langs;
  if (!targets) {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(LOCALES_DIR);
    targets = files.filter((f) => f.endsWith(".json") && f !== `${SOURCE_LANG}.json`).map((f) => f.replace(/\.json$/, ""));
  }

  console.log(`源: ${SOURCE_LANG}(${Object.keys(enFlat).length} 个 key)  端点: ${BASE_URL}  模型: ${model}`);
  console.log(`目标语言: ${targets.join(", ")}  批大小: ${args.batch}  并发: ${args.concurrency}${args.force ? "  [强制重翻]" : ""}${args.prefix ? `  前缀: ${args.prefix.join(",")}` : ""}\n`);

  let grandIn = 0, grandOut = 0;

  for (const lang of targets) {
    const path = resolve(LOCALES_DIR, `${lang}.json`);
    let targetRaw = {};
    try { targetRaw = JSON.parse(await readFile(path, "utf8")); } catch { targetRaw = {}; }
    const targetFlat = flatten(targetRaw);

    // 选出要翻的 key:在源中、命中前缀、且(强制 或 目标缺失/为空)
    const todo = Object.keys(enFlat).filter((k) => {
      if (typeof enFlat[k] !== "string") return false;
      if (!matchesPrefix(k, args.prefix)) return false;
      if (args.force) return true;
      const cur = targetFlat[k];
      return cur === undefined || cur === null || cur === "";
    });

    if (todo.length === 0) { console.log(`[${lang}] 无需翻译(已齐全)`); continue; }

    const batches = chunk(todo, args.batch);
    console.log(`[${lang}] 待翻 ${todo.length} 个 key → ${batches.length} 批`);
    if (args.dryRun) { console.log(`  (dry-run)示例: ${todo.slice(0, 5).join(", ")}${todo.length > 5 ? " …" : ""}`); continue; }

    const system = buildSystemPrompt(lang);
    let langIn = 0, langOut = 0, done = 0;

    const batchResults = await runPool(batches, args.concurrency, async (keys, bi) => {
      const src = {};
      for (const k of keys) src[k] = enFlat[k];
      try {
        const { parsed, usage } = await callModel({ model, system, userJson: JSON.stringify(src, null, 0), sourceEntries: src });
        langIn += usage.input_tokens || 0; langOut += usage.output_tokens || 0;
        done += keys.length;
        process.stdout.write(`\r  进度 ${done}/${todo.length}`);
        return parsed;
      } catch (e) {
        console.warn(`\n  ✗ 批 #${bi + 1} 失败: ${e.message}`);
        return {};
      }
    });

    // 合并回目标并写盘
    let applied = 0;
    for (const parsed of batchResults) {
      for (const [k, v] of Object.entries(parsed || {})) {
        if (typeof v === "string" && enFlat[k] !== undefined) { setDeep(targetRaw, k, v); applied++; }
      }
    }
    await writeFile(path, JSON.stringify(targetRaw, null, 2) + "\n", "utf8");
    grandIn += langIn; grandOut += langOut;
    console.log(`\n  ✓ [${lang}] 写入 ${applied} 个译文  (tokens in=${langIn} out=${langOut})`);
  }

  if (!args.dryRun) console.log(`\n总 token: input=${grandIn}  output=${grandOut}`);
}

main().catch((e) => { console.error("\n致命错误:", e.message); process.exit(1); });
