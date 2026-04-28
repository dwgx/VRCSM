<div align="center">

<img src="https://q.qlogo.cn/headimg_dl?dst_uin=136666451&spec=640" width="96" height="96" alt="VRCSM" style="border-radius:50%" />

# VRCSM

**VRChat Settings Manager**

一款用于扫描、预览、清理与迁移 VRChat 本地数据的 Windows 11 桌面工具

[![Version](https://img.shields.io/badge/version-0.14.3-blue)](https://github.com/dwgx/VRCSM/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6)](#)
[![License](https://img.shields.io/badge/license-VSAL-red)](LICENSE)
[![Stack](https://img.shields.io/badge/stack-C%2B%2B20%20%C2%B7%20WebView2%20%C2%B7%20React%2019-success)](#)

[中文](#中文) · [English](#english) · [日本語](#日本語) · [下载 / Download](https://github.com/dwgx/VRCSM/releases/latest)

</div>

---

## 中文

VRCSM 是一款原生 Windows 11 桌面工具，使用 C++ 主机 + WebView2 内嵌 React 前端，专为 VRChat 玩家打造。它把日常缓存清理、好友追踪、设置管理、化身预览这些散落的需求集中到一个无边框的 Mica 窗口里。

### 主要功能

- **缓存扫描** 按目录归类显示大小、文件数、时间戳、损坏链接
- **化身预览** 直接从本地 UnityFS Bundle 解析三维模型，支持轨道控制
- **安全删除** 默认 dry-run，自动检测 VRChat.exe 运行状态，避免误删
- **NTFS 迁移** 把 `Cache-WindowsPlayer` 通过 junction 迁出系统盘，无需管理员权限
- **设置接口** 读写 VRChat config.json 与启动参数
- **历史雷达** 离线分析 `output_log_*.txt` 重建好友进出会话记录、世界停留时长、化身切换
- **本地数据库** 内置 SQLite 持久化好友追踪、备注、收藏世界
- **Steam Link / Quest 修复** 诊断 VRLink 会话、SteamVR beta、Quest 配对缓存、音频与串流参数，并提供备份优先的修复方案
- **多语言** 简体中文、English、日本語、한국어、ภาษาไทย、हिन्दी、Русский

### 安装方式

直接到 [Releases](https://github.com/dwgx/VRCSM/releases/latest) 下载：

- `VRCSM_v0.14.3_x64_Installer.msi` — 推荐，标准 WiX 安装器
- `VRCSM_v0.14.3_x64.zip` — 解压即用，绿色版

### 自行编译

环境要求：Windows 10 22H2+ x64、Visual Studio 2026 Build Tools (MSVC)、CMake 3.28+、Ninja、Git、pnpm。仓库自带 `third_party/vcpkg`。

```powershell
# 前端
cd web && pnpm install && pnpm build && cd ..

# C++ 主机
cmake --preset x64-release
cmake --build --preset x64-release

# 运行
.\build\x64-release\src\host\VRCSM.exe
```

### 使用须知

- 默认所有破坏性操作都是 dry-run，请认真看清单后再确认执行
- 删除/迁移前会自动检测 VRChat 进程，运行中会被阻断
- 数据迁移使用 NTFS junction，与 VRChat 完全兼容，无需管理员权限
- VRCSM 是 local-first：扫描、解析、清理与迁移优先处理本地文件；登录后会调用 VRChat API，更新检查与 update/plugin feed 也会访问网络。不会向 VRChat 服务器发起非常规请求，但仍请遵守 VRChat 服务条款

### 许可证

本项目采用 **VRCSM 源码可见许可证 (VSAL)**，详见 [LICENSE](LICENSE)。

源代码公开仅供学习与审计，**不属于开源软件**。未经书面授权禁止转发、修改后再发布、商用或二次打包。仅允许个人非商业使用。

---

## English

VRCSM is a native Windows 11 desktop tool that combines a C++ host with an embedded WebView2-rendered React frontend. It consolidates everything a VRChat power user usually does by hand — cache cleanup, friend tracking, settings management, avatar previewing — into a single borderless Mica window.

### Features

- **Cache scanning** — size, file count, timestamps, broken-link detection per category
- **Avatar preview** — parse local UnityFS bundles into three-dimensional models with orbit controls
- **Safe deletion** — dry-run by default; aborts when VRChat.exe is running
- **NTFS migration** — relocate `Cache-WindowsPlayer` off the system drive via junctions, no admin needed
- **Settings interface** — read/write VRChat `config.json` and launch arguments
- **Historical radar** — replay `output_log_*.txt` offline to reconstruct friend join/leave sessions, world dwell time, avatar switches
- **Local database** — built-in SQLite for friend tracking, notes, world favorites
- **Steam Link / Quest repair** — diagnose VRLink sessions, SteamVR beta state, Quest pairing cache, audio, and streaming parameters with backup-first repair plans
- **Localization** — Simplified Chinese, English, Japanese, Korean, Thai, Hindi, Russian

### Install

Grab the prebuilt artifact from [Releases](https://github.com/dwgx/VRCSM/releases/latest):

- `VRCSM_v0.14.3_x64_Installer.msi` — recommended, WiX installer
- `VRCSM_v0.14.3_x64.zip` — portable, run in place

### Build From Source

Requirements: Windows 10 22H2+ x64, Visual Studio 2026 Build Tools (MSVC), CMake 3.28+, Ninja, Git, pnpm. The vcpkg checkout lives at `third_party/vcpkg`.

```powershell
cd web && pnpm install && pnpm build && cd ..
cmake --preset x64-release
cmake --build --preset x64-release
.\build\x64-release\src\host\VRCSM.exe
```

### Usage Notes

- Every destructive action is a dry-run first — review the planned changes before confirming
- VRChat process detection blocks delete/migrate while the game is running
- Cache migration uses NTFS junctions, fully compatible with VRChat, no admin elevation
- VRCSM is local-first: scanning, parsing, cleanup, and migration operate on local files first; after sign-in it calls the VRChat API, and update checks / plugin feed requests also use the network. It does not perform abnormal requests against VRChat servers, but you remain responsible for compliance with the VRChat ToS

### License

This project is released under the **VRCSM Source-Available License (VSAL)** — see [LICENSE](LICENSE).

Source is published for study and audit only and is **not open source**. Redistribution, modified republication, commercial use, and repackaging require prior written permission. Personal non-commercial use is permitted.

---

## 日本語

VRCSM は C++ ホスト + WebView2 に React フロントエンドを埋め込んだ、VRChat プレイヤーのためのネイティブ Windows 11 デスクトップツールです。キャッシュ整理、フレンド追跡、設定管理、アバタープレビューといった作業を、ボーダーレスな Mica ウィンドウひとつにまとめています。

### 主な機能

- **キャッシュスキャン** カテゴリ別にサイズ、ファイル数、タイムスタンプ、壊れたリンクを表示
- **アバタープレビュー** ローカル UnityFS Bundle から 3D モデルを解析、軌道操作対応
- **安全な削除** 既定で dry-run、VRChat.exe 実行中は自動で中断
- **NTFS 移行** `Cache-WindowsPlayer` をジャンクションでシステムドライブから退避、管理者権限不要
- **設定インターフェース** VRChat の `config.json` と起動引数を読み書き
- **ヒストリカルレーダー** `output_log_*.txt` をオフライン再生してフレンドの出入り、ワールド滞在時間、アバター切替を再構成
- **ローカル DB** SQLite 内蔵、フレンド追跡・メモ・お気に入りワールド
- **Steam Link / Quest 修復** VRLink セッション、SteamVR beta、Quest ペアリングキャッシュ、音声、ストリーミング設定を診断し、バックアップ優先の修復プランを提供
- **多言語対応** 簡体字中国語、英語、日本語、韓国語、タイ語、ヒンディー語、ロシア語

### インストール

[Releases](https://github.com/dwgx/VRCSM/releases/latest) からビルド済みアーティファクトを入手してください。

- `VRCSM_v0.14.3_x64_Installer.msi` — 推奨、WiX インストーラ
- `VRCSM_v0.14.3_x64.zip` — 解凍してそのまま実行可能

### ソースからビルド

要件：Windows 10 22H2 以降 x64、Visual Studio 2026 Build Tools (MSVC)、CMake 3.28+、Ninja、Git、pnpm。vcpkg チェックアウトはリポジトリ同梱の `third_party/vcpkg` を使用します。

```powershell
cd web && pnpm install && pnpm build && cd ..
cmake --preset x64-release
cmake --build --preset x64-release
.\build\x64-release\src\host\VRCSM.exe
```

### 使用上の注意

- 破壊的操作はすべて dry-run が初期動作です。一覧を確認してから実行してください
- 削除・移行前に VRChat プロセスを検出し、実行中はブロックされます
- キャッシュ移行は NTFS ジャンクションを使用するため、VRChat と完全互換、管理者権限は不要です
- VRCSM は local-first です。スキャン、解析、削除、移行はローカルファイルを優先して処理しますが、ログイン後は VRChat API を呼び出し、更新確認 / plugin feed もネットワークを使用します。VRChat サーバーへの異常な要求は行いませんが、利用者は VRChat 利用規約を遵守する必要があります

### ライセンス

本プロジェクトは **VRCSM ソースアベイラブルライセンス (VSAL)** で提供されます。詳細は [LICENSE](LICENSE) を参照してください。

ソースコードは学習と監査のために公開されており、**オープンソースではありません**。書面による事前許可なしの再配布、改変版の公開、商用利用、再パッケージングは禁止されています。個人の非商用利用は許可されます。

---

<div align="center">

### Tech Stack

`C++20` · `WebView2` · `React 19` · `Vite 6` · `Tailwind 4` · `shadcn/ui` · `WiX v7` · `SQLite` · `nlohmann/json` · `fmt` · `spdlog`

### Author / 作者

**dwgx** · [somdhmtb@gmail.com](mailto:somdhmtb@gmail.com) · QQ `136666451` · QQ Group `901738883`

Special thanks to 嗯呐！！ (QQ `1033484989`)

</div>
