# VRCSM Unity IDE Shell

## Goal

Replace the generic dashboard shell with a Unity Editor-like workspace:

- thin top menubar
- dedicated toolbar row
- left navigation dock
- center document panel with a tab strip
- optional right inspector/context dock
- bottom console/output/problems dock with a splitter
- narrow status bar

The shell is intentionally flat and panel-driven. No glow, no blur, no gradients, no SaaS card shell.

## App Shell JSX Skeleton

The shell in `web/src/App.tsx` is now structured as:

```tsx
<ToolbarSearchProvider searchQuery={searchQuery} onSearchQueryChange={setSearchQuery}>
  <RightDockProvider>
    <div className="flex h-screen w-screen overflow-hidden bg-[hsl(var(--canvas))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TitleBar
          currentPageLabel={currentMeta.title}
          isRescanning={isRescanning}
          onRescan={loadShellReport}
          onResetLayout={() => setLayoutResetToken((value) => value + 1)}
          vrcRunning={vrcRunning}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <section className="unity-dock flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex h-8 items-end border-b bg-[hsl(var(--surface-raised))] px-2 pt-1">
                <div className="unity-tab unity-tab-active">{currentMeta.title}</div>
              </div>
              <main className="scrollbar-thin flex-1 overflow-y-auto bg-[hsl(var(--surface))] px-6 py-5">
                <Routes>...</Routes>
              </main>
            </section>

            <RightDock fallback={rightDockFallback} />
          </div>

          <BottomDock report={shellReport} resetToken={layoutResetToken} />
          <StatusBar
            breadcrumb={currentMeta.breadcrumb}
            cacheTotal={shellReport?.total_bytes_human ?? "—"}
            currentPageLabel={currentMeta.title}
            version="v0.1.1"
            vrcRunning={vrcRunning}
          />
        </div>
      </div>
      <Toaster />
    </div>
  </RightDockProvider>
</ToolbarSearchProvider>
```

## Component Delivery

The following shell components were added or updated under `web/src/components`:

- `MenuBar.tsx`: keyboard-accessible menubar with Unity-like dropdowns and route stubs.
- `Toolbar.tsx`: toolbar row with app icon, VRChat-running indicator, rescan button, shared search state, and right-side chips.
- `RightDock.tsx`: right-dock provider and `useRightDock({ title, body })` hook. Existing pages can ignore it; the shell falls back to route-aware dock content.
- `BottomDock.tsx`: tabbed bottom dock with `Console`, `Output`, and `Problems`, plus drag resize and `logs.stream` wiring.
- `StatusBar.tsx`: 22px status bar with breadcrumb, cache total, VRChat state, and version label.
- `TitleBar.tsx`: now renders the `MenuBar` + `Toolbar` stack instead of returning `null`.

Implementation notes:

- `App.tsx` owns shell state for route labels, shared scan summary, running-state polling, search text, and layout reset.
- `RightDock` hides automatically when neither a page-provided dock nor a route fallback exists.
- `BottomDock` subscribes to `logs.stream` through the existing IPC event bus and tolerates a host that never emits data.

## CSS Additions

Appended to `web/src/styles/globals.css`:

- `.unity-menubar`
- `.unity-dock`
- `.unity-tab`
- `.unity-tab-active`
- `.unity-splitter`
- `.unity-statusbar`

These are minimal on purpose: flat dark fills, 1px borders, tab silhouettes, and a splitter highlight on hover/focus.

## i18n Additions

Merged into:

- `web/src/i18n/locales/en.json`
- `web/src/i18n/locales/zh-CN.json`

Added namespaces/keys:

- `menu.file`
- `menu.edit`
- `menu.assets`
- `menu.window`
- `menu.help`
- `menu.fileRescan`
- `menu.fileExportReport`
- `menu.fileExit`
- `menu.windowResetLayout`
- `menu.helpAbout`
- `menu.helpDocs`
- `menu.helpCheckUpdates`
- `toolbar.rescan`
- `toolbar.search`
- `toolbar.vrcRunning`
- `toolbar.vrcIdle`
- `dock.console`
- `dock.output`
- `dock.problems`
- `dock.clear`
- `statusBar.version`
- `statusBar.cacheTotal`

## Shell Decisions

- The right dock is route-aware by default because the current pages were left untouched. Pages can opt into real inspector content later through `useRightDock`.
- The toolbar search state is shared and ready for pages to consume, but existing pages still use their local filters.
- The bottom console is wired to `logs.stream` now, while the host-side producer remains optional.
- The visual direction takes cues from Unity Editor chrome and docking patterns, not from the VRChat player data itself. The local `VRChat_Data` tree was only used as runtime context.
