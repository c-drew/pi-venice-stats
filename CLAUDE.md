# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check (no emit — the only build step needed)
node_modules/.bin/tsc --noEmit
```

Before committing, sync `CLAUDE.md` and `README.md` with any command, config, or architecture changes made in the session.

No tests, no bundler. Pi loads `src/index.ts` directly at runtime as an ESM extension.

## What this package is

A standalone Pi Coding Agent extension that renders a live Venice Protocol stats dashboard below the editor. It has **no dependency on pi-venice** — it talks directly to `venicestats.com` and the venice.ai billing API. It can be installed and used on its own or alongside pi-venice.

## Architecture

```
src/index.ts      ← entry point; session events, widget start/stop
src/panels.ts     ← panel definitions, data types, format helpers, renderClock
src/widget.ts     ← polling engine, PID lock, startPriceWidget / stopPriceWidget
src/commands.ts   ← all /venice-* slash commands
src/state.ts      ← VeniceStatsConfig persistence via pi.appendEntry
```

### Data flow

`index.ts` loads config from the session log (`loadConfig`), then starts the widget via `startPriceWidget` (in `widget.ts`). All config getters are lambdas passed down so the widget always reads the latest value without needing a restart.

### Polling

Polling is **health-driven**. A lightweight `/api/health` check fires every ~90 s; each pipeline in the response carries an `ageSec` value. When `ageSec` drops below a per-pipeline stale threshold, the corresponding data fetch fires. This means data is only fetched when venicestats.com has actually updated it — not on a fixed timer.

`STALE_THRESHOLD` in `widget.ts` defines the per-pipeline thresholds (e.g. `prices: 180`, `diem: 300`, `staking: 300`).

The **venice.ai `/billing/balance`** poller is independent: max 1 req/min, also triggered after each agent loop completes. Uses `VENICE_ADMIN_API_KEY`.

### Panels

Each panel is a `PanelDef` in `src/panels.ts`:
```ts
{ id, label, description, sources, render(data, theme, sep): string | string[] | null }
```
Returning `string[]` emits multiple rows. `PANEL_REGISTRY` is the canonical list; `DEFAULT_PANELS` is the default ordered set. `renderClock` is separate — always overlaid right-aligned on the first row.

### Multi-session lock

Only one pi session may poll at a time (venicestats.com rate limit: 60 req/min per IP). A PID file at `~/.pi/venice-stats.pid` is the lock. `isPiProcess()` in `widget.ts` validates the PID against `/proc/<pid>/cmdline` on Linux/WSL to handle PID reuse after a crash. `/venice-widget claim` provides the user escape hatch.

### Theme colors

Only use named colors from the pi-tui theme: `text`, `dim`, `accent`, `muted`, `error`, `warning`, `success`, `syntaxType`, `syntaxKeyword`. Generic CSS names like `purple` or `magenta` throw a runtime error.

### State persistence

`VeniceStatsConfig` (wallet address, panel layout, timezone, time format, token/cooldown/exposure periods) is persisted via `pi.appendEntry("venice-stats-config", config)`. `loadConfig` replays the session log and takes the latest entry. Widget config never touches pi-venice's state.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VENICE_WALLET` | Wallet address fallback (if not set via `/venice-wallet`) |
| `VENICE_ADMIN_API_KEY` | Enables billing balance overlay in the clock |
