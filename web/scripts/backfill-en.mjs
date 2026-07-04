// One-shot backfill helper: copy every zh-CN key missing from en.json into en.json
// with an accurate English string, driven by an auditable zh->en TSV dictionary
// (scripts/en-backfill.tsv, one "zh<TAB>en" pair per line). Trust-level keys are
// generated compositionally (rank x capability). Run from web/:
//   node scripts/backfill-en.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "src", "i18n", "locales");
const zh = JSON.parse(fs.readFileSync(path.join(dir, "zh-CN.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"));

// Compositional trust-level table (rank x capability) — 14 ranks x 11 caps.
const ranks = {
  "基础": "Basic", "中级1": "Intermediate 1", "中级2": "Intermediate 2",
  "中高级1": "Advanced 1", "中高级2": "Advanced 2", "认识的": "Known",
  "好友": "Friend", "可信任": "Trusted", "传奇": "Legend", "老用户": "Veteran",
  "开发者": "Developer", "自己": "Local player", "访客": "Untrusted", "负面": "Negative",
};
const caps = {
  "可语音聊天": "can speak", "可用动态表情": "can use animated emoji",
  "可用模型音频": "can use avatar audio", "可用自定义动画": "can use custom animations",
  "可用自定义模型": "can use custom avatar", "可用自定义着色器": "can use custom shaders",
  "可用无人机": "can use drone", "可用表情贴纸共享": "can use emoji/sticker sharing",
  "可用粒子": "can use particle systems", "可用触发器": "can use triggers",
  "可用用户图标": "can use user icons",
};
const T = {};
for (const [rz, re] of Object.entries(ranks))
  for (const [cz, ce] of Object.entries(caps)) T[rz + cz] = `${re} ${ce}`;

// Literal dictionary from the TSV.
const tsv = fs.readFileSync(path.join(root, "scripts", "en-backfill.tsv"), "utf8");
for (const line of tsv.split("\n")) {
  if (!line.trim()) continue;
  const tab = line.indexOf("\t");
  if (tab < 0) throw new Error("TSV line missing tab: " + line);
  T[line.slice(0, tab)] = line.slice(tab + 1);
}

// Walk zh-CN; for any leaf key path absent from en, set the translated value.
let added = 0;
const missingTx = new Set();
function walk(zNode, eNode) {
  for (const k of Object.keys(zNode)) {
    const zv = zNode[k];
    if (zv && typeof zv === "object" && !Array.isArray(zv)) {
      if (!(k in eNode) || typeof eNode[k] !== "object" || eNode[k] === null) eNode[k] = {};
      walk(zv, eNode[k]);
    } else if (!(k in eNode)) {
      const tx = T[zv];
      if (tx === undefined) { missingTx.add(zv); continue; }
      eNode[k] = tx;
      added++;
    }
  }
}
walk(zh, en);

if (missingTx.size) {
  console.error("No English translation for " + missingTx.size + " zh strings:");
  for (const s of missingTx) console.error("  " + JSON.stringify(s));
  process.exit(1);
}

fs.writeFileSync(path.join(dir, "en.json"), JSON.stringify(en, null, 2) + "\n", "utf8");
console.log("Backfilled " + added + " keys into en.json");
