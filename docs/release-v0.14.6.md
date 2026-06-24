## VRCSM v0.14.6

This release is the current checkpoint before pausing active development.

Highlights:

- Migration, updater, and `world_visits` schema repair work are now shipped together instead of sitting unreleased.
- OSC Studio now has real starter templates, visual composition, corrected `/chatbox/input` argument ordering, clearer auto-send state, and structured OSC send errors instead of a bare generic `ERROR`.
- Hardware telemetry coverage improved with GPU adapter details, SMBIOS fallback for motherboard/RAM identity, AIDA64 shared-memory sensors, and ACPI thermal-zone fallback.
- Friend/world/social surfaces were tightened with better i18n coverage, self-exclusion in encounter rankings, and lazier world/thumbnail loading.
- Asset metadata caching is now reusable across worlds, avatars, users, and popup badges.

Project status:

- Active feature development is paused after `v0.14.6`.
- Only critical bugfixes, packaging repairs, or security updates should be expected unless development is explicitly resumed.

Artifacts:

- `VRCSM_v0.14.6_x64_Installer.msi`
  - SHA256: `37C605FB3DCF75F07ED40DA5AF7FCEDF6FB33D94DA2FFC65D29DD3D9814A8614`
- `VRCSM_v0.14.6_x64.zip`
  - SHA256: `E431C1CF2436C0A4F82D8C0C7988F39823FA6BBEA7CE6D0502D0CBB7B05CA50E`
