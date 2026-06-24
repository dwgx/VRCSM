# OSC Studio Plan

Last updated: 2026-06-24

VRCSM already has the low-level OSC bridge: `OscBridge`, `osc.send`,
`osc.listen.start`, `osc.listen.stop`, and the `/tools/osc` page. The next step
is to turn that raw sender into an OSC Studio: a visual, modular, draggable
control surface for VRChat Chatbox, avatar parameters, inputs and telemetry.

## Product Goal

Build a GUI that lets users compose useful OSC output from cards:

- Chatbox text with variables.
- CPU/GPU/RAM/HMD/system information.
- VRChat status and local session data.
- Avatar parameter controls.
- Input/action buttons.
- Custom raw OSC messages.

The page should feel like a dashboard builder, not a debug form. Users should be
able to pick cards, reorder them, edit templates, preview the exact text and
send safely.

## Current Baseline

Existing backend/frontend pieces:

- `src/core/OscBridge.{h,cpp}`: OSC 1.0 UDP send/listen.
- `src/host/bridges/PipelineBridge.cpp`: `osc.send`,
  `osc.listen.start`, `osc.listen.stop`, `osc.message`.
- `web/src/pages/OscTools.tsx`: raw send/listen and simple chatbox quick send.
- `src/host/bridges/HwBridge.cpp`: `hw.detect`, `hw.recommend`.
- `src/core/hw/HwDetector.cpp`: CPU, GPU, VRAM, RAM, HMD and OS detection.
- `web/src/pages/Settings/TabHardware.tsx`: existing hardware UI consumer.
- `web/src/lib/ipc.ts`: `oscSend`, `oscListenStart`, `oscListenStop`,
  `readMemoryStatus`.

Resolved in the 2026-06-23 telemetry slice:

- Visual OSC card composer.
- Template variable system.
- Reusable frontend `osc-api.ts` facade.
- Persistent local card layout.
- Native HTML5 drag/reorder support.
- Controlled auto-send scheduler.
- `hw.telemetry` backend for static motherboard/RAM inventory and best-effort
  real sensor data.
- Local avatar parameter reader for `LocalAvatarData` files.
- DXGI GPU adapter enumeration for real display adapters and reliable
  dedicated VRAM, with virtual/indirect display adapters scored down.
- NVML multi-GPU selection for NVIDIA telemetry instead of assuming adapter 0.
- Finite WMI row timeouts so broken sensor providers fail as a source badge
  instead of hanging the OSC page.

Resolved in the 2026-06-23 card-builder slice:

- Default OSC Studio profile version 4 contains exactly four Chatbox-oriented
  templates: clock, compact performance, hardware names, and thermal/power.
- Hardware data is exposed as draggable component cards, not only raw variable
  tokens. Cards cover time/date, CPU load/temp/power, GPU load/temp/VRAM/power,
  RAM usage/module info, motherboard name, hardware names, and sensor counts.
- The selected card now has a larger template edit area. Users can type custom
  text directly, click a component to append it, or drag a component card into
  the editor.
- The same builder panel shows a Chatbox-style preview and 144-character count,
  so the user sees the final text before manual or automatic send.

Resolved in the 2026-06-23 DIY composer slice:

- The selected template now has a visual composer above the raw textarea.
  Template chunks split on pipes/newlines, can be moved left/right, removed,
  and then written back to the same plain `template` string.
- Users can add custom text without knowing token syntax, insert pipe/newline
  separators with one click, or drag component cards into the composer drop
  zone.
- Component cards now show their description, token fragment, and live preview
  value so users can decide what to add without memorizing variables.
- The implementation deliberately avoids a new persisted graph/schema for this
  slice. Existing profiles remain compatible, and the raw template editor stays
  available for exact formatting.

Resolved in the 2026-06-23 usability + SMBIOS slice:

- Component cards default to a smaller "Recommended" set and can be filtered by
  Time, CPU, GPU, RAM, or System. The palette also has search and an explicit
  click-to-insert affordance so users do not have to discover drag-and-drop.
- Drag payloads now include both `application/x-vrcsm-osc-template` and
  `text/plain`; the composer drop zone and raw textarea both accept drops.
- The avatar-parameter scanner now has inline copy explaining that it turns
  local Avatar OSC parameters into control cards, not model unpacking.
- `hw.telemetry` now uses raw SMBIOS (`GetSystemFirmwareTable('RSMB')`) as a
  static identity fallback for motherboard and RAM modules when WMI/CIM is slow
  or empty.

Resolved in the 2026-06-24 auto-send + sensor visibility slice:

- Every card in the OSC Studio card list has its own Auto/Stop button. The
  selected-template panel shows the active auto-send card, sent/skipped counts,
  next-send countdown, last rendered message, and last error.
- `hw.telemetry` reads AIDA64's public `AIDA64_SensorValues` shared memory when
  AIDA64 External Applications publishing is enabled, parses its XML-ish sensor
  rows, and folds temperature/fan/power/load/voltage/clock rows into the same
  source-status model as WMI monitor providers and NVML.
- The hardware variable panel now lists the first live sensor readings instead
  of only showing aggregate sensor counts.
- Thermal defaults and saved old `Fan {gpu.fanPct}` templates migrate to
  `{fan.0}`, because many machines expose fans as RPM sensors rather than a GPU
  fan percentage.
- A Windows built-in fallback now reads `ROOT\WMI:MSAcpi_ThermalZoneTemperature`
  and converts tenths-Kelvin values to Celsius. These are ACPI thermal-zone
  readings, not guaranteed CPU package/core sensors, so they are labeled as
  `acpi_thermal_zone`.

Current gaps:

- Sensor support depends on what the machine exposes. VRCSM reads real values
  from already-installed WMI/NVML providers; it does not fake values or install
  sensor drivers.
- OSCQuery/runtime avatar parameter discovery is not wired yet. The first
  implementation scans local `LocalAvatarData/<usr>/<avtr>` JSON.

## VRChat OSC Rules

Default VRChat OSC direction:

- VRCSM -> VRChat: `127.0.0.1:9000`
- VRChat -> VRCSM: listen on `9001`

Safety defaults:

- Preview before sending.
- Chatbox hard cap at 144 characters.
- Chatbox send cooldown of at least 2 seconds.
- Auto-send is off by default.
- Auto-send must have an interval control and a visible stop button.
- Send only to local host unless the user edits the host field.

## Architecture

Frontend modules:

- `web/src/lib/osc-studio.ts`
  - card types
  - default card presets
  - template rendering
  - variable catalog
  - card reorder helpers
  - storage load/save helpers
- `web/src/lib/osc-api.ts`
  - `sendOscMessage`
  - `sendChatbox`
  - `startOscListener`
  - `stopOscListener`
- `web/src/pages/OscTools.tsx`
  - page composition only: Studio, Raw Send, Listen Log

Backend modules:

- `src/core/hw/HwTelemetry.*`
  - CPU/GPU temperature
  - CPU/GPU load and power when providers expose it
  - GPU fan speed, VRAM used/total when NVML exposes it
  - RAM used/free/total
  - RAM use
  - motherboard model
  - RAM module manufacturer/model/speed
- `src/host/bridges/HwBridge.cpp`
  - `hw.telemetry`

Telemetry source order:

- Windows `ROOT\CIMV2` WMI:
  - `Win32_BaseBoard`
  - `Win32_PhysicalMemory`
  - `GlobalMemoryStatusEx`
- Windows `ROOT\WMI` ACPI:
  - `MSAcpi_ThermalZoneTemperature`
  - Best-effort platform thermal-zone temperatures, converted from tenths
    Kelvin to Celsius and labeled as `acpi_thermal_zone`.
- DXGI:
  - `IDXGIFactory1::EnumAdapters1`
  - `DXGI_ADAPTER_DESC1`
  - primary GPU scoring, vendor IDs, software/virtual filtering, dedicated
    video memory
- `ROOT\LibreHardwareMonitor` WMI, if LibreHardwareMonitor is already running.
- `ROOT\OpenHardwareMonitor` WMI, if OpenHardwareMonitor is already running.
- `AIDA64_SensorValues` shared memory, if AIDA64 External Applications sensor
  publishing is enabled.
- NVIDIA NVML loaded dynamically from `nvml.dll` / NVIDIA NVSMI path.

If none of the sensor providers is available, the UI shows unavailable source
badges and leaves temperature/fan/power variables as `--`.

Important accuracy boundary:

- Static identity should be high coverage on normal Windows machines:
  CPU from `Win32_Processor` plus registry fallback, motherboard from
  `Win32_BaseBoard`, RAM modules from `Win32_PhysicalMemory`, GPU list/VRAM
  from DXGI, and memory pressure from `GlobalMemoryStatusEx`.
- Temperature, fan, power and some utilization counters are not guaranteed by
  Windows alone. VRCSM must collect them from real providers only and label the
  source. It must never invent values to make a card look complete.
- "Every computer reads every sensor" is not technically achievable from a
  normal user-mode app. Many boards expose fan/VRM/EC values only through
  vendor EC/Super I/O chips, ACPI methods, a monitoring-driver stack, BIOS
  cooperation, or vendor SDKs. VRCSM's target is layered best-effort coverage
  with explicit source badges and unavailable reasons, not fabricated values.
- Next vendor-specific sensor backends should be added behind the same
  `HwTelemetry` source-status contract: AMD ADLX, Intel Level Zero Sysman or
  Graphics Control Library, HWiNFO shared memory only with a clear legal/SDK
  boundary, and embedded LibreHardwareMonitor if licensing/distribution is
  acceptable.

## Card Types

Initial frontend-only cards:

- `chatbox-template`
  - address: `/chatbox/input`
  - value type: string
  - template text
  - send/notify flags
- `hardware-summary`
  - CPU/GPU/RAM/HMD/OS variables from `hw.recommend`
- `raw-message`
  - custom OSC address/type/value
- `avatar-bool`
  - boolean avatar parameter toggle
- `avatar-float`
  - float avatar parameter slider
- `input-button`
  - common VRChat input address button

Later cards:

- `session-world`
- `friend-status`
- `now-playing`
- `rotating-message`
- `conditional-message`

## Variable Catalog

Initial variables available without new backend:

- `{time}`
- `{date}`
- `{appVersion}` if wired later
- `{cpu.name}`
- `{cpu.cores}`
- `{cpu.threads}`
- `{cpu.clockGhz}`
- `{gpu.name}`
- `{gpu.vramGb}`
- `{gpu.driver}`
- `{ram.gb}`
- `{hmd.model}`
- `{hmd.manufacturer}`
- `{os.build}`

Telemetry variables:

- `{cpu.tempC}`
- `{cpu.loadPct}`
- `{cpu.powerW}`
- `{gpu.tempC}`
- `{gpu.loadPct}`
- `{gpu.fanPct}`
- `{gpu.powerW}`
- `{gpu.vramUsedGb}`
- `{gpu.vramTotalGb}`
- `{ram.usedGb}`
- `{ram.usedPct}`
- `{motherboard.vendor}`
- `{motherboard.model}`
- `{ram.module0.model}`
- `{ram.module0.speedMhz}`

## Implemented Slices

2026-06-23 initial slice:

1. Add `osc-studio.ts` with card model, presets, renderer, reorder and
   localStorage persistence.
2. Add `osc-api.ts` wrapper around existing IPC calls.
3. Rewrite `/tools/osc` into a studio layout while preserving raw send/listen.
4. Add card reorder buttons now; replace with pointer drag later if desired.
5. Add hardware snapshot variables from `hw.recommend`.
6. Add template preview and manual send.
7. Add auto-send interval for the selected chatbox card with a visible stop.

2026-06-23 telemetry/workbench slice:

1. Add `src/core/hw/HwTelemetry.{h,cpp}`.
2. Add `hw.telemetry` IPC.
3. Add best-effort real CPU/GPU temperature/load/power/fan/VRAM values via
   LHM/OHM WMI and NVML.
4. Add motherboard/RAM module static inventory via Windows WMI.
5. Add `avatar.parameters.local` IPC for local `LocalAvatarData` parameter
   extraction.
6. Upgrade `/tools/osc` with native drag/drop, card groups, scene presets,
   import/export, telemetry panels and avatar parameter quick-add.
7. Add shared GPU candidate scoring in `src/core/hw/GpuProbe.*` and reuse it
   from `HwDetector` and `HwTelemetry`.
8. Return GPU vendor/source/virtual status through `hw.recommend`, and return
   `gpu_adapters` through `hw.telemetry`.
9. Use DXGI dedicated memory to avoid `Win32_VideoController.AdapterRAM`
   truncation/virtual-adapter ordering issues.

2026-06-23 card-builder slice:

1. Bump OSC Studio local profile defaults to version 4.
2. Replace the scene dropdown with four visible template buttons.
3. Add `OSC_TEMPLATE_CARDS` as the reusable component-card catalog in
   `web/src/lib/osc-studio.ts`.
4. Replace the variable list with a component-card panel that supports click
   insert and HTML5 drag/drop into the template editor.
5. Keep raw OSC send/listen and local avatar parameter cards as separate
   advanced panels below the main builder.

Do later:

1. Add OSCQuery/runtime avatar parameter discovery.
2. Add telemetry watch events instead of manual refresh polling.
3. Add card grid persistence in DB instead of only localStorage.
4. Add richer card layout geometry, if the page needs free-position canvas
   behavior instead of ordered cards.
5. Add AMD/Intel vendor-specific GPU telemetry behind source badges.
6. Add an optional embedded sensor service strategy, but keep it opt-in and
   explicit if it needs driver-level or admin behavior.

## Acceptance Criteria

- Existing raw OSC send/listen still works.
- Chatbox cards preview exact rendered output.
- Chatbox output is clipped to 144 characters.
- Auto-send cannot run without a selected card and visible stop.
- Card order persists across reloads.
- Hardware cards show current detected CPU/GPU/RAM/HMD data when available.
- Telemetry fields are real provider values or `--`; no fake production values.
- Local avatar parameter cards can be created from scanned local avatar JSON.
