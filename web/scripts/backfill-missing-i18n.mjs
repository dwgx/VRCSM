// One-shot backfill: add keys that are referenced in code via t(key,{defaultValue})
// but absent from BOTH en.json and zh-CN.json. en gets the English string
// (source-of-truth superset), zh-CN gets a natural Simplified Chinese string.
// Only sets a leaf when it is missing — never clobbers an existing translation.
// Run from web/:  node scripts/backfill-missing-i18n.mjs
import fs from "node:fs";
import path from "node:path";

const dir = path.join("src", "i18n", "locales");
const en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"));
const zh = JSON.parse(fs.readFileSync(path.join(dir, "zh-CN.json"), "utf8"));

// [dotPath, english, simplifiedChinese]
const ENTRIES = [];
function add(key, e, z) { ENTRIES.push([key, e, z]); }

add("avatars.referenceImageHint", "Wearer's current avatar/profile picture — not a verified historical match.", "佩戴者当前的模型/头像 —— 并非经过验证的历史匹配。");
add("avatars.referenceImageVerifiedHint", "Wearer's current avatar matches the logged name.", "佩戴者当前模型与记录的名称一致。");
add("avatars.search.go", "Search", "搜索");
add("avatars.search.noResults", "No results found", "未找到结果");
add("avatars.search.placeholder", "Search by avatar name…", "按模型名称搜索…");
add("avatars.search.searching", "Searching…", "搜索中…");
add("avatars.search.title", "Search Public Avatars", "搜索公开模型");
add("avatars.unavailable", "Avatar unavailable.", "模型不可用。");
add("avatars.wearerCurrentReference", "Wearer current reference", "佩戴者当前参考");
add("avatars.wearerReferenceNote", "Unknown", "未知");
add("benchmark.clear", "Clear", "清除");
add("benchmark.clearBenchmarkDesc", "This deletes persisted benchmark snapshots. Avatars still in the live scan reappear on the next scan. This cannot be undone.", "此操作将删除已保存的性能基准快照。仍在实时扫描中的模型会在下次扫描时重新出现。此操作无法撤销。");
add("benchmark.clearBenchmarkTitle", "Clear avatar benchmarks?", "清除模型性能基准?");
add("benchmark.clearFailed", "Failed to clear: {{error}}", "清除失败:{{error}}");
add("benchmark.clearSeenDesc", "This permanently deletes the logged history of avatars you've seen. This cannot be undone.", "此操作将永久删除你已见过的模型记录历史。此操作无法撤销。");
add("benchmark.clearSeenTitle", "Clear seen-avatar history?", "清除已见模型历史?");
add("benchmark.clearSuccess", "Cleared.", "已清除。");
add("benchmark.copyId", "Copy Avatar ID", "复制 Avatar ID");
add("benchmark.wornBy", "worn by", "佩戴者");
add("cmd.sections.globalSearch", "Global Search", "全局搜索");
add("cmd.sections.plugins", "Plugins", "插件");
add("common.all", "All", "全部");
add("common.allowed", "Allowed", "允许");
add("common.blocked", "Blocked", "已屏蔽");
add("common.collapse", "Collapse", "折叠");
add("common.deleting", "Deleting…", "删除中…");
add("common.detecting", "Detecting…", "检测中…");
add("common.expand", "Expand", "展开");
add("common.navigate", "Navigate", "导航");
add("common.refreshing", "refreshing", "刷新中");
add("common.showAll", "Show all ({{count}})", "显示全部 ({{count}})");
add("common.unavailable", "Unavailable", "不可用");
add("eventRecorder.delete", "Delete recording", "删除录制");
add("eventRecorder.deleteDesc", "This permanently removes \"{{name}}\" and its {{count}} attendee record(s). This cannot be undone.", "此操作将永久删除“{{name}}”及其 {{count}} 条参与者记录。此操作无法撤销。");
add("eventRecorder.deleteTitle", "Delete recording?", "删除录制?");
add("eventRecorder.deleted", "Recording deleted", "录制已删除");
add("friendDetail.avatarHistory", "Avatar History", "模型历史");
add("friendDetail.avatarIdCopied", "Avatar ID copied", "已复制 Avatar ID");
add("friendDetail.blocked", "User blocked", "已屏蔽用户");
add("friendDetail.boopSend", "Boop {{name}}", "戳一下 {{name}}");
add("friendDetail.boopSendEmoji", "Boop with {{e}}", "用 {{e}} 戳一下");
add("friendDetail.currentAvatar", "Current Avatar", "当前模型");
add("friendDetail.currentWorld", "Current World", "当前世界");
add("friendDetail.description", "Detailed friend information", "好友详细信息");
add("friendDetail.launch", "Launch", "启动");
add("friendDetail.muteConfirm", "Mute {{name}}?", "静音 {{name}}?");
add("friendDetail.muted", "User muted", "已静音用户");
add("friendDetail.noActivity", "No activity recorded yet.", "暂无活动记录。");
add("friendDetail.note", "Note", "备注");
add("friendDetail.notePlaceholder", "Write a private note about this friend...", "为该好友写一条私人备注…");
add("friendDetail.noteSaved", "Note saved", "备注已保存");
add("friendDetail.recentActivity", "Recent Activity", "最近活动");
add("friendDetail.saveNote", "Save", "保存");
add("friendDetail.sharedWorlds", "Shared Worlds", "共同世界");
add("friendDetail.timesSeen", "{{n}}x seen", "见过 {{n}} 次");
add("friendDetail.vrcProfile", "VRChat Profile", "VRChat 资料");
add("friendLog.loginRequired", "Log in to VRChat via the Settings page to view friend activity history.", "请在设置页登录 VRChat 以查看好友活动历史。");
add("friendLog.note.loadFailed", "Could not load note.", "无法加载备注。");
add("friendLog.perPage", "Items per page", "每页条数");
add("friends.trust.label", "Trust Rank", "信任等级");
add("friends.actions.copied", "Copied {{label}}", "已复制{{label}}");
add("friends.actions.copyAvatarId", "Copy current avatar ID", "复制当前模型 ID");
add("friends.actions.copyDisplayName", "Copy display name", "复制显示名称");
add("friends.actions.copyLocation", "Copy location", "复制位置");
add("friends.actions.copyUserId", "Copy user ID", "复制用户 ID");
add("friends.actions.copyWorldId", "Copy world ID", "复制世界 ID");
add("friends.actions.expand", "Expand", "展开");
add("friends.actions.favorited", "Favorited {{name}}", "已收藏 {{name}}");
add("friends.actions.inviteSelf", "Request invite to me", "请求发我邀请");
add("friends.actions.openProfile", "Open profile", "打开资料");
add("friends.actions.openWorldPage", "Open world page", "打开世界页面");
add("friends.actions.selfInviteSent", "Requested an invite to {{name}}'s current instance", "已请求 {{name}} 当前房间的邀请");
add("friends.actions.unfavorited", "Unfavorited {{name}}", "已取消收藏 {{name}}");
add("friends.copyLabels.avatarId", "avatar ID", "模型 ID");
add("friends.copyLabels.displayName", "display name", "显示名称");
add("friends.copyLabels.location", "location", "位置");
add("friends.copyLabels.userId", "user ID", "用户 ID");
add("friends.copyLabels.worldId", "world ID", "世界 ID");
add("friends.inspector.empty", "Select a friend to see their location, avatar and quick actions.", "选择一个好友查看位置、模型和快捷操作。");
add("friends.inspector.title", "Friend at a glance", "好友速览");
add("library.favorite", "Favorite", "收藏");
add("library.unfavorite", "Unfavorite", "取消收藏");
add("groups.nowRepresenting", "Representing {{name}}", "正在代表 {{name}}");
add("groups.represent", "Represent", "代表");
add("groups.representFailed", "Failed to update representation: {{error}}", "更新代表状态失败:{{error}}");
add("groups.stopRepresenting", "Stop representing", "停止代表");
add("groups.stoppedRepresenting", "Stopped representing {{name}}", "已停止代表 {{name}}");
add("migrate.junction", "junction", "连接点");
add("modelDb.harvest.empty", "No avatar ids found in the local analytics cache (or VRChat hasn't written one yet).", "本地分析缓存中未找到模型 ID(或 VRChat 尚未写入)。");
add("modelDb.harvest.found", "Found {{total}} avatar id(s) locally · {{fresh}} not in your owned list.", "本地找到 {{total}} 个模型 ID · 其中 {{fresh}} 个不在你的拥有列表中。");
add("modelDb.harvest.scan", "Scan local cache", "扫描本地缓存");
add("modelDb.harvest.tooltip", "Read-only scan of VRChat's local analytics cache for avatar ids (experimental).", "只读扫描 VRChat 本地分析缓存中的模型 ID(实验性)。");
add("nav.labSection", "Lab", "实验室");
add("profile.emailUnverified", "Set but unverified", "已设置但未验证");
add("profile.emailVerified", "Verified", "已验证");
add("profile.linkedAccounts", "Linked Accounts", "已关联账户");
add("profile.linkedAccountsDesc", "Bound platforms and identity fields from the VRChat login session, displayed natively.", "来自 VRChat 登录会话的已绑定平台与身份字段,原生显示。");
add("profile.manageOnVrchat", "Manage on vrchat.com", "在 vrchat.com 管理");
add("profile.notLinked", "Not linked", "未关联");
add("profile.security.avatarCopying", "Avatar Cloning", "模型克隆");
add("profile.security.clientLogin", "Game Client Login", "游戏客户端登录");
add("profile.security.twoFactor", "Two-Factor Auth", "双重验证");
add("radar.analysis.loginRequired", "Login required to scan local logs for session history.", "需要登录才能扫描本地日志中的会话历史。");
add("radar.analysis.unclosed", "Unclosed", "未结束");
add("radar.wearNotAllowed", "This avatar does not allow cloning.", "该模型不允许克隆。");
add("radar.wearNotFound", "Could not find this avatar. It may be private.", "找不到该模型,可能为私有。");
add("radar.wearSuccess", "Now wearing: {{name}}", "已切换到:{{name}}");
add("rules.yamlPlaceholder", "trigger: friend.online\ncondition: user.displayName contains 'Natsumi'\naction:\n  type: vrcsm.notification.show\n  title: Friend online!\n  message: '{{user.displayName}} is online'", "trigger: friend.online\ncondition: user.displayName contains 'Natsumi'\naction:\n  type: vrcsm.notification.show\n  title: 好友上线!\n  message: '{{user.displayName}} 上线了'");
add("settings.hardware.applied", "Settings applied! Restart SteamVR.", "设置已应用!请重启 SteamVR。");
add("settings.hardware.apply", "Apply recommended settings", "应用推荐设置");
add("settings.hardware.applying", "Applying…", "应用中…");
add("settings.hardware.bandwidth", "Bandwidth", "带宽");
add("settings.hardware.community", "Community", "社区");
add("settings.hardware.cpu", "CPU", "CPU");
add("settings.hardware.cpuScore", "CPU", "CPU");
add("settings.hardware.detecting", "Detecting hardware…", "正在检测硬件…");
add("settings.hardware.ffr", "FFR Level", "FFR 等级");
add("settings.hardware.gpu", "GPU", "GPU");
add("settings.hardware.gpuScore", "GPU", "GPU");
add("settings.hardware.hmd", "HMD", "头显");
add("settings.hardware.motionSmoothing", "Motion Smoothing", "运动平滑");
add("settings.hardware.ram", "RAM", "内存");
add("settings.hardware.ramBonus", "RAM", "内存");
add("settings.hardware.recommendedTier", "{{tier}} Tier Recommended", "推荐 {{tier}} 档");
add("settings.hardware.refresh", "Re-detect", "重新检测");
add("settings.hardware.refreshRate", "Refresh Rate", "刷新率");
add("settings.hardware.score", "HW Score", "硬件评分");
add("settings.hardware.scoreBreakdown", "Score Breakdown", "评分明细");
add("settings.hardware.subtitle", "Detect GPU and CPU to compute recommended VRChat settings for Steam Link / Quest.", "检测 GPU 和 CPU,为 Steam Link / Quest 计算推荐的 VRChat 设置。");
add("settings.hardware.supersampling", "Supersampling", "超采样");
add("settings.hardware.title", "Hardware & GPU", "硬件与 GPU");
add("settings.hardware.totalScore", "Total", "总分");
add("settings.hardware.vramBonus", "VRAM", "显存");
add("settings.tabs.hardware", "Hardware", "硬件");
add("settings.steamvr.configNotFoundBadge", "Settings not found", "未找到设置");
add("settings.steamvr.configNotFoundBody", "VRCSM could not read SteamVR's settings file. Diagnostics and backup-first repair remain available; the parameter editor is disabled until SteamVR creates the file.", "VRCSM 无法读取 SteamVR 的设置文件。诊断与“先备份再修复”仍可使用;在 SteamVR 创建该文件前,参数编辑器将保持禁用。");
add("settings.steamvr.configNotFoundTitle", "steamvr.vrsettings not found", "未找到 steamvr.vrsettings");
add("settings.steamvr.editorUnavailable", "SteamVR configuration editor unavailable: steamvr.vrsettings is not installed or has not been created yet.", "SteamVR 配置编辑器不可用:steamvr.vrsettings 尚未安装或创建。");
add("settings.steamvr.effectiveResolution.hint", "The Encoder Resolution shown by Steam Link is this value. Changing any field back-computes the Supersampling Scale (0.5–2.0, step 0.1).", "Steam Link 显示的 Encoder Resolution 就是这个值。改任一字段会反推 Supersampling Scale (0.5–2.0, 步进 0.1)。");
add("settings.steamvr.effectiveResolution.label", "Effective render resolution (per eye)", "有效渲染分辨率 (每眼)");
add("settings.steamvr.effectiveResolution.unknown", "Unknown HMD", "未知 HMD");
add("settings.steamvr.knownDevices", "Detected VR Devices:", "已检测到的 VR 设备:");
add("settings.steamvr.linkRepair.backupPartial", "Quest Link backup completed with warnings: {{msg}}", "Quest Link 备份完成但有警告:{{msg}}");
add("settings.steamvr.linkRepair.dryRunWarning", "Dry-run completed with warnings: {{msg}}", "试运行完成但有警告:{{msg}}");
add("settings.steamvr.linkRepair.dryRunWarningShort", "Dry-run warning", "试运行警告");
add("settings.steamvr.linkRepair.repairPartial", "Repair completed with warnings: {{msg}}", "修复完成但有警告:{{msg}}");
add("settings.steamvr.linkRepair.restorePartial", "Restore completed with warnings: {{msg}}", "还原完成但有警告:{{msg}}");
add("settings.steamvr.linkRepair.restoredShort", "Restored", "已还原");
add("settings.steamvr.linkRepair.resultRestoreCount", "Restore count", "还原数量");
add("settings.steamvr.linkRepair.reviewFailures", "Review the result details below.", "请查看下方的结果详情。");
add("settings.steamvr.profileApplied", "Applied {{name}} — click Save Settings to persist.", "已应用 {{name}} —— 点击“保存设置”以生效。");
add("settings.steamvr.unknownGpu", "Unknown GPU", "未知 GPU");
add("settings.steamvr.vrIdle", "VR Runtime Idle", "VR 运行时空闲");
add("settings.steamvr.vrRunning", "VR Runtime Active", "VR 运行时活动");
add("settings.vrDiag.avgBitrate", "Avg Bitrate", "平均码率");
add("settings.vrDiag.droppedFrames", "Dropped Frames", "丢帧");
add("settings.vrDiag.linkQuality", "Link Quality", "连接质量");
add("settings.vrDiag.maxLatency", "Max Latency", "最大延迟");
add("settings.vrDiag.supersampleFiltering", "Supersample Filtering", "超采样过滤");
add("socialGraph.clear", "Clear", "清除");
add("socialGraph.clearDesc", "This permanently deletes logged player encounters used for friend rankings and the co-presence graph. World-visit rankings are cleared separately on the World History page. This cannot be undone.", "此操作将永久删除用于好友排名与共同在场图谱的玩家相遇记录。世界访问排名需在“世界历史”页单独清除。此操作无法撤销。");
add("socialGraph.clearFailed", "Failed to clear: {{error}}", "清除失败:{{error}}");
add("socialGraph.clearSuccess", "Social analytics cleared.", "社交分析数据已清除。");
add("socialGraph.clearTitle", "Clear social analytics?", "清除社交分析数据?");
add("socialGraph.nodeFocused", "{{name}} focused", "已聚焦 {{name}}");
add("vrchatWorkspace.joinFailed", "Failed to launch: {{error}}", "启动失败:{{error}}");
add("vrchatWorkspace.launch", "Launch", "启动");
add("vrchatWorkspace.launchWorld", "Launch in VRChat", "在 VRChat 中启动");
add("vrchatWorkspace.noFavoriteWorlds", "No favorite worlds yet. Sync your VRChat favorites to see them here.", "还没有收藏的世界。同步你的 VRChat 收藏后会显示在这里。");
add("vrchatWorkspace.noRecentWorlds", "No recent worlds found in VRChat logs.", "VRChat 日志中未找到最近的世界。");
add("vrchatWorkspace.recentWorlds", "Recent Worlds", "最近的世界");
add("worldHistory.clear", "Clear", "清除");
add("worldHistory.clearDesc", "This permanently deletes all logged world visits. This cannot be undone.", "此操作将永久删除所有已记录的世界访问。此操作无法撤销。");
add("worldHistory.clearFailed", "Failed to clear: {{error}}", "清除失败:{{error}}");
add("worldHistory.clearSuccess", "World history cleared.", "世界历史已清除。");
add("worldHistory.clearTitle", "Clear world history?", "清除世界历史?");
add("worldHistory.customLimit", "Custom world history row limit", "自定义世界历史行数上限");
add("worldHistory.lastPlayerSeen", "last player event {{time}}", "最后玩家事件 {{time}}");
add("worldHistory.limitLabel", "Rows", "行数");
add("worldHistory.loggedPlayers", "{{count}} logged players", "已记录 {{count}} 名玩家");
add("worldHistory.noLoggedPlayers", "No player log", "无玩家记录");
add("worldHistory.noPlayerCountHint", "No local player join/leave events were recorded in this visit window.", "此次访问时间段内未记录到本地玩家的加入/离开事件。");
add("worldHistory.playerCountHint", "{{count}} local player log events in this visit window.", "此次访问时间段内有 {{count}} 条本地玩家日志事件。");
add("worldHistory.recentLimit", "Recent {{count}} visits", "最近 {{count}} 次访问");
add("worlds.unavailable", "World unavailable.", "世界不可用。");

function setIfMissing(root, dotPath, value) {
  const parts = dotPath.split(".");
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof node[k] !== "object" || node[k] === null || Array.isArray(node[k])) {
      if (k in node) return false; // collides with an existing leaf — skip
      node[k] = {};
    }
    node = node[k];
  }
  const leaf = parts[parts.length - 1];
  if (leaf in node) return false;
  node[leaf] = value;
  return true;
}

let enAdded = 0;
let zhAdded = 0;
for (const [key, e, z] of ENTRIES) {
  if (setIfMissing(en, key, e)) enAdded++;
  if (setIfMissing(zh, key, z)) zhAdded++;
}

fs.writeFileSync(path.join(dir, "en.json"), JSON.stringify(en, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(dir, "zh-CN.json"), JSON.stringify(zh, null, 2) + "\n", "utf8");
console.log(`en: +${enAdded}, zh-CN: +${zhAdded} (of ${ENTRIES.length} entries)`);
