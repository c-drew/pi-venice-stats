/**
 * Venice stats widget: polling, lock management, and TUI rendering.
 *
 * Polling is driven by /api/health — a lightweight sentinel that tells us when
 * each data pipeline has actually refreshed. Pipeline update frequencies
 * (observed from /api/health over 15+ min at 30s polling intervals):
 *   prices       ~150s    | diem        ~260s   | staking     ~270s
 *   holders      ~570s    | burns       ~570s   | diemEvents  ~570s
 *   rewards      ~570s    | stakingEvents ~570s | treasury    ~20min+
 *   vesting      ~4.7h+
 *
 * Strategy:
 *   1. Poll /api/health every ~90s — sentinel, ~1 req/min
 *   2. When a pipeline's ageSec drops (vs. previous poll), it just refreshed —
 *      trigger the corresponding data fetch
 *   3. Billing balance (venice.ai /billing/balance): 1 req/min max,
 *      also triggered after each agent loop completes
 */

import { appendFileSync, chmodSync, closeSync, constants as fsConstants, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import {
  PANEL_REGISTRY,
  ROLE_COLOR,
  SIZE_EMOJI,
  fmtAddr,
  fmtUSD,
  fmtPct,
  fmtK,
  fmtVVV,
  fmtNum4,
  gauge,
  gaugeWidth,
  arrow,
  sparkline,
  renderClock,
  DIEM_TARGET_SUPPLY,
  type AllData,
  type MetricsData,
  type WalletData,
  type SocialData,
  type MarketsData,
  type BillingData,
  type ChartsData,
  type WalletExposure,
} from "./panels.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENICE_API_BASE  = "https://api.venice.ai/api/v1";
const STATS_WIDGET_KEY = "venice-stats";

// Respect XDG_CONFIG_HOME if set (e.g. ~/.config/.pi), fall back to ~/.pi
const PI_CONFIG_DIR = process.env["XDG_CONFIG_HOME"]
  ? join(process.env["XDG_CONFIG_HOME"], ".pi")
  : join(homedir(), ".pi");

const STATS_LOG        = join(PI_CONFIG_DIR, "venice-stats.log");
const FLASH_MS         = 400;
const TICK_MS           = 500;

// How often to poll /api/health — 90s gives roughly 1-2 catch windows per
// pipeline cycle (prices ~150s, diem/staking ~270s, everything else ~570s+).
const HEALTH_POLL_MS   = 90_000;
const HEALTH_ENDPOINT  = "https://venicestats.com/api/health";
/** Per-request HTTP timeout. Network calls that hang longer than this are aborted
 *  so a single dead socket can't pin a fetch in flight forever and starve later
 *  polls (the in-flight guards block re-entry until the outstanding call resolves). */
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Multi-session lock
// ---------------------------------------------------------------------------

const WIDGET_LOCK = join(PI_CONFIG_DIR, "venice-stats.pid");
let _lockOwned = false;

function isPiProcess(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); } catch { return false; }
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.split("\0").some((tok) => /\bpi\b/.test(tok));
  } catch {
    return true;
  }
}

// Reject the lock path if it's a symlink, directory, or any non-regular file.
// Prevents a local attacker from clobbering an arbitrary file by pre-planting
// a symlink at WIDGET_LOCK, and prevents a stuck "another session" message
// when the path is unexpectedly a directory.
function lockPathIsSafe(): boolean {
  try {
    const st = lstatSync(WIDGET_LOCK);
    return st.isFile();
  } catch (err: any) {
    // ENOENT is fine — we'll create the file fresh.
    return err?.code === "ENOENT";
  }
}

export function tryAcquireWidgetLock(): boolean {
  if (!lockPathIsSafe()) {
    plog(`lock path unsafe (not a regular file) — refusing to acquire`);
    return false;
  }
  // O_EXCL fails atomically if the file already exists; O_NOFOLLOW refuses to
  // open through a symlink. Mode 0o600 keeps the PID file owner-only.
  try {
    const fd = openSync(
      WIDGET_LOCK,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
    _lockOwned = true;
    return true;
  } catch (err: any) {
    if (err?.code !== "EEXIST") {
      plog(`lock acquire failed: ${err?.code ?? err}`);
      return false;
    }
  }

  // File exists — check whether the recorded PID is still a live pi process.
  let pid: number;
  try {
    const raw = readFileSync(WIDGET_LOCK, "utf8").trim();
    pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return false;
  } catch { return false; }

  if (isPiProcess(pid) && pid !== process.pid) return false;

  // Stale lock — owner is dead. Replace it atomically: unlink, then create with O_EXCL.
  try { unlinkSync(WIDGET_LOCK); } catch { /* race with another claimer is fine */ }
  try {
    const fd = openSync(
      WIDGET_LOCK,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
    _lockOwned = true;
    return true;
  } catch (err: any) {
    plog(`stale lock takeover failed: ${err?.code ?? err}`);
    return false;
  }
}

export function tryClaimStaleWidgetLock(): boolean {
  return tryAcquireWidgetLock();
}

export function releaseWidgetLock(): void {
  if (!_lockOwned) return;
  try {
    if (readFileSync(WIDGET_LOCK, "utf8").trim() === String(process.pid)) {
      unlinkSync(WIDGET_LOCK);
    }
  } catch { /* ignore */ }
  _lockOwned = false;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Cap the log so a long-running session can't fill the disk. When STATS_LOG
 *  passes this size we rotate to STATS_LOG.1 (overwriting any prior rotation)
 *  before continuing to append. */
const LOG_MAX_BYTES = 1_048_576; // 1 MiB
let logRotateChecked = 0;
let logPermsTightened = false;

function plog(msg: string) {
  const ts = new Date().toISOString();
  try {
    // Check size at most once every ~5s to avoid statSync per write.
    const now = Date.now();
    if (now - logRotateChecked > 5_000) {
      logRotateChecked = now;
      try {
        const st = statSync(STATS_LOG);
        if (st.size > LOG_MAX_BYTES) {
          try { renameSync(STATS_LOG, STATS_LOG + ".1"); } catch { /* ignore */ }
        }
      } catch { /* ENOENT — file doesn't exist yet */ }
    }
    appendFileSync(STATS_LOG, `[${ts}] ${msg}\n`, { mode: 0o600 });
    // Tighten perms once per session in case the file pre-existed with looser bits.
    if (!logPermsTightened) {
      logPermsTightened = true;
      try { chmodSync(STATS_LOG, 0o600); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export interface WidgetController {
  triggerTokenRefresh(): void;
  triggerCooldownRefresh(): void;
  triggerExposureRefresh(): void;
  /** Force a billing refresh on the next tick (bypasses 1 req/min rate limit). */
  triggerBillingRefresh(): void;
}

export function startPriceWidget(
  ctx:                ExtensionContext,
  getWallet:          () => string | undefined,
  getPanels:          () => string[],
  getTimezone:        () => string,
  getTimeFormat:      () => "24h" | "12h",
  getTokenPeriod:    () => "1h" | "24h" | "7d" | "30d",
  getCooldownPeriod:  () => "24h" | "7d" | "30d",
  getExposurePeriod: () => "1h" | "24h" | "7d" | "30d",
  getPreset:         () => "off" | "usage" | "wallet" | "max",
): WidgetController {
  const controller: WidgetController = {
    triggerBillingRefresh:   () => {},
    triggerTokenRefresh:      () => {},
    triggerCooldownRefresh:   () => {},
    triggerExposureRefresh:   () => {},
  };
  plog(`startPriceWidget called — hasUI=${ctx.hasUI}`);
  if (!ctx.hasUI) return controller;

  ctx.ui.setWidget(
    STATS_WIDGET_KEY,
    (tui, theme) => {
      plog("widget factory invoked");

      let metrics:    MetricsData    | null = null;
      let wallet:     WalletData     | null = null;
      let social:     SocialData     | null = null;
      let markets:    MarketsData    | null = null;
      let billing:    BillingData   | null = null;
      let charts:     ChartsData    | null = null;
      let walletExposure: WalletExposure | null = null;
      let lastWalletAddr: string | undefined;
      let disposed = false;

      // Last seen ageSec per pipeline (from /api/health). When ageSec drops
      // below a threshold, the pipeline just updated and we should refetch.
      const pipelineAge = new Map<string, number>();

      const clockTick = setInterval(() => {
        if (!disposed) tui.requestRender();
      }, 1000);

      type Flash = "up" | "down" | null;
      let vvvFlash:       Flash = null;
      let diemFlash:      Flash = null;
      let vvvFlashTimer:  ReturnType<typeof setTimeout> | null = null;
      let diemFlashTimer: ReturnType<typeof setTimeout> | null = null;

      function setFlash(token: "vvv" | "diem", dir: Flash) {
        const isVvv = token === "vvv";
        if (isVvv) { if (vvvFlashTimer)  clearTimeout(vvvFlashTimer); }
        else       { if (diemFlashTimer) clearTimeout(diemFlashTimer); }
        if (isVvv) vvvFlash  = dir; else diemFlash  = dir;
        const t = setTimeout(() => {
          if (isVvv) vvvFlash = null; else diemFlash = null;
          if (!disposed) tui.requestRender();
        }, FLASH_MS);
        if (isVvv) vvvFlashTimer = t; else diemFlashTimer = t;
      }

      function logPanels() {
        const noTheme = {
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        };
        const allData: AllData = {
          metrics, wallet, social, markets, billing, charts, walletExposure,
          walletAddr: getWallet(),
          flash: { vvv: vvvFlash, diem: diemFlash },
        };
        for (const id of getPanels()) {
          const panel = PANEL_REGISTRY[id];
          if (!panel) continue;
          const line = panel.render(allData, noTheme, " | ", 120);
          if (Array.isArray(line)) line.forEach((l, i) => plog(`panel[${id}][${i}] ${l}`));
          else if (line) plog(`panel[${id}] ${line}`);
        }
      }

      // Notify the user once per session if the venice.ai admin key is rejected,
      // so a misconfigured VENICE_ADMIN_API_KEY surfaces instead of silently
      // suppressing the billing overlay forever.
      let billingAuthNotified = false;
      let billingKeyShapeNotified = false;

      async function fetchBilling() {
        const adminKey = process.env["VENICE_ADMIN_API_KEY"];
        if (!adminKey) { billing = null; return; }
        // Reject keys containing CR/LF or other control chars — pasting one with a
        // stray newline would otherwise inject extra HTTP headers via the
        // Authorization value. Notify once so the user knows to re-set it.
        if (/[\r\n\x00-\x1f\x7f]/.test(adminKey)) {
          billing = null;
          if (!billingKeyShapeNotified) {
            billingKeyShapeNotified = true;
            try { ctx.ui.notify("VENICE_ADMIN_API_KEY contains control characters — billing overlay disabled.", "error"); } catch { /* ignore */ }
          }
          return;
        }
        try {
          const res = await fetch(`${VENICE_API_BASE}/billing/balance`, {
            headers: { Authorization: `Bearer ${adminKey}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok) {
            plog(`billing error: ${res.status}`);
            if ((res.status === 401 || res.status === 403) && !billingAuthNotified) {
              billingAuthNotified = true;
              try { ctx.ui.notify(`VENICE_ADMIN_API_KEY rejected (${res.status}) — billing overlay disabled.`, "error"); } catch { /* ignore */ }
            }
            return;
          }
          const d = await res.json() as any;
          billing = {
            canConsume: Boolean(d.canConsume),
            consumptionCurrency: d.consumptionCurrency ?? null,
            diemBalance: typeof d.balances?.diem === "number" ? d.balances.diem : null,
            usdBalance: typeof d.balances?.usd === "number" ? d.balances.usd : null,
            diemEpochAllocation: typeof d.diemEpochAllocation === "number" ? d.diemEpochAllocation : 0,
          };
          plog(`billing ok — DIEM=${billing.diemBalance}/${billing.diemEpochAllocation} USD=${billing.usdBalance}`);
          logPanels();
        } catch (err) { plog(`billing error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      const sourceErrors = new Map<string, number>();

      async function fetchMetrics() {
        try {
          const res = await fetch("https://venicestats.com/api/metrics", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); plog(`metrics error: ${res.status}`); return; }
          const d = await res.json() as any;
          if (typeof d.vvvPrice !== "number") { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); return; }
          sourceErrors.set("metrics", 0);
          if (metrics && d.vvvPrice  !== metrics.vvvPrice)  setFlash("vvv",  d.vvvPrice  > metrics.vvvPrice  ? "up" : "down");
          if (metrics && d.diemPrice !== metrics.diemPrice) setFlash("diem", d.diemPrice > metrics.diemPrice ? "up" : "down");
          metrics = {
            vvvPrice: d.vvvPrice, diemPrice: d.diemPrice, ethPrice: d.ethPrice ?? 0,
            vvvPriceChange1h: d.vvvPriceChange1h ?? 0,
            vvvPriceChange4h: d.vvvPriceChange4h ?? 0,
            priceChange24h: d.priceChange24h ?? 0,
            vvvPriceChange7d: d.vvvPriceChange7d ?? 0,
            diemPriceChange1h: d.diemPriceChange1h ?? 0,
            diemPriceChange4h: d.diemPriceChange4h ?? 0,
            diemPriceChange24h: d.diemPriceChange24h ?? 0,
            diemPriceChange7d: d.diemPriceChange7d ?? 0,
            marketCap: d.marketCap ?? 0, stakingRatio: (d.stakingRatio ?? 0) * 100,
            stakerApr: d.stakerApr ?? 0, lockRatio: (d.lockRatio ?? 0) * 100,
            totalVvvStaked: d.totalStaked ?? 0,
            mintRate: d.mintRate ?? 0, diemSupply: d.diemSupply ?? 0,
            remainingMintable: d.remainingMintable ?? 0, diemStakeRatio: d.diemStakeRatio ?? 0,
            stakingGrowth7d: d.stakingGrowth7d ?? 1, newStakers7dCount: d.newStakers7dCount ?? 0,
            cooldownVvv: d.cooldownVvv ?? 0,
            cooldownWallets: d.cooldownWallets ?? 0,
            cooldownCount: d.cooldownCount ?? 0,
            veniceRevenue: d.veniceRevenue ?? 0,
            burnRevenueAnnualized: d.burnRevenueAnnualized ?? 0,
            totalBurnedFromEvents: d.totalBurnedFromEvents ?? 0,
            organicBurned: d.organicBurned ?? 0, burnDeflationRate: d.burnDeflationRate ?? 0,
            emissionRate: d.emissionRate ?? 0,
            netFlow7d: d.netFlow7d ?? 0,
            fdv: d.fdv ?? 0, diemFdv: d.diemFdv ?? 0,
          };
          plog(`metrics ok — VVV=$${d.vvvPrice?.toFixed(4)} DIEM=$${d.diemPrice?.toFixed(2)}`);
          logPanels();
        } catch (err) { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); plog(`metrics error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      // In-flight guards prevent overlapping fetches when health-sentinel
      // refreshes pile up faster than the wallet endpoints can respond.
      let walletInFlight = false;
      let walletHistoryInFlight = false;

      async function fetchWallet() {
        if (!getPanels().includes("wallet")) { wallet = null; return; }
        const addr = getWallet();
        if (!addr) { wallet = null; return; }
        if (walletInFlight) return;
        walletInFlight = true;
        if (addr !== lastWalletAddr) { wallet = null; lastWalletAddr = addr; }
        try {
          const res = await fetch(`https://venicestats.com/api/venetians?address=${addr}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) { sourceErrors.set("wallet", (sourceErrors.get("wallet") ?? 0) + 1); plog(`wallet error: ${res.status}`); return; }
          sourceErrors.set("wallet", 0);
          const d = await res.json() as any;
          wallet = {
            label: d.ensName ?? fmtAddr(d.address ?? addr),
            role: d.roleLabel ?? "", sizeLabel: d.sizeLabel ?? "",
            svvvBalance: d.svvvBalance ?? 0, vvvBalance: d.vvvBalance ?? 0, diemStaked: d.diemStaked ?? 0,
            pendingRewards: d.pendingRewards ?? 0,
            rank: d.rank ?? 0, totalVenetians: d.totalVenetians ?? 0,
          };
          plog(`wallet ok — ${wallet.label} rank #${wallet.rank}`);
          logPanels();
          fetchWalletHistory();
        } catch (err) { sourceErrors.set("wallet", (sourceErrors.get("wallet") ?? 0) + 1); plog(`wallet error: ${err}`); }
        finally { walletInFlight = false; }
        if (!disposed) tui.requestRender();
      }

      async function fetchSocial() {
        if (!getPanels().includes("social")) { social = null; return; }
        try {
          const res = await fetch("https://venicestats.com/api/social", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) { sourceErrors.set("social", (sourceErrors.get("social") ?? 0) + 1); plog(`social error: ${res.status}`); return; }
          sourceErrors.set("social", 0);
          const d = await res.json() as any;
          social = {
            erikFollowers: d.erikFollowers ?? 0, sentimentUpPct: d.sentimentUpPct ?? 0,
            marketCapRank: d.marketCapRank ?? 0, diemMarketCapRank: d.diemMarketCapRank ?? 0,
            socialVolume: d.socialVolume ?? 0,
          };
          plog(`social ok — Erik ${social.erikFollowers} sentiment=${social.sentimentUpPct.toFixed(0)}%`);
          logPanels();
        } catch (err) { sourceErrors.set("social", (sourceErrors.get("social") ?? 0) + 1); plog(`social error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchMarkets() {
        if (!getPanels().includes("markets")) { markets = null; return; }
        try {
          const res = await fetch("https://venicestats.com/api/markets?token=VVV&period=24h", { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) { sourceErrors.set("markets", (sourceErrors.get("markets") ?? 0) + 1); plog(`markets error: ${res.status}`); return; }
          sourceErrors.set("markets", 0);
          const d = await res.json() as any;
          const k = d.kpis;
          const pctChg = (cur: number | undefined, prev: number | undefined): number | null => {
            if (cur == null || prev == null || prev === 0) return null;
            return ((cur - prev) / prev) * 100;
          };
          const topPool = Array.isArray(d.pools) && d.pools.length > 0 ? d.pools[0] : null;
          markets = {
            volume: k?.volume ?? 0, buyPct: k?.buyPct ?? 0, traders: k?.traders ?? 0,
            volumeChange: pctChg(k?.volume, k?.volumePrev),
            traderGrowth: pctChg(k?.traders, k?.tradersPrev),
            swaps: k?.swaps ?? null,
            swapGrowth: pctChg(k?.swaps, k?.swapsPrev),
            topPoolName: topPool?.name ?? null,
            topPoolShare: topPool?.volumePct ?? null,
          };
          plog(`markets ok — vol=$${markets.volume.toFixed(0)} traders=${markets.traders}`);
          logPanels();
        } catch (err) { sourceErrors.set("markets", (sourceErrors.get("markets") ?? 0) + 1); plog(`markets error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchTokenCharts() {
        if (!getPanels().some(id => ["prices", "staking", "diem", "markets"].includes(id))) return;
        const tp = getTokenPeriod();
        try {
          const [vvvRes, diemRes] = await Promise.all([
            fetch(`https://venicestats.com/api/charts?period=${tp}&metric=vvvPrice`),
            fetch(`https://venicestats.com/api/charts?period=${tp}&metric=diemPrice`),
          ]);
          if (!vvvRes.ok || !diemRes.ok) {
            sourceErrors.set("charts", (sourceErrors.get("charts") ?? 0) + 1);
            plog(`charts error: ${vvvRes.status} / ${diemRes.status}`);
            return;
          }
          sourceErrors.set("charts", 0);
          const vvvD  = await vvvRes.json()  as any;
          const diemD = await diemRes.json() as any;
          charts = {
            vvvPrices:      Array.isArray(vvvD.data)  ? vvvD.data.map((p: any)  => p.v as number) : [],
            vvvTimestamps:  Array.isArray(vvvD.data)  ? vvvD.data.map((p: any)  => p.t as number) : [],
            diemPrices:     Array.isArray(diemD.data) ? diemD.data.map((p: any) => p.v as number) : [],
            diemTimestamps: Array.isArray(diemD.data) ? diemD.data.map((p: any) => p.t as number) : [],
            // Preserve existing cooldown wave data across token chart re-fetches
            cooldownWave: charts ? charts.cooldownWave : [],
          };
          plog(`token charts ok — vvv ${charts.vvvPrices.length}pts diem ${charts.diemPrices.length}pts`);
          if (!disposed) tui.requestRender();
        } catch (err) { sourceErrors.set("charts", (sourceErrors.get("charts") ?? 0) + 1); plog(`charts error: ${err}`); }
      }

      async function fetchCooldownChart() {
        if (!getPanels().some(id => ["staking", "diem"].includes(id))) return;
        const cp = getCooldownPeriod();
        try {
          const waveRes = await fetch(`https://venicestats.com/api/charts?period=${cp}&metric=cooldownWave`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!waveRes.ok) {
            plog(`cooldown error: ${waveRes.status}`);
            return;
          }
          const waveD = await waveRes.json() as any;
          const newWave = Array.isArray(waveD.data) ? waveD.data.map((p: any) => p.v as number) : [];
          const prevWave = charts?.cooldownWave ?? [];
          const waveChanged =
            prevWave.length !== newWave.length ||
            prevWave.some((v, i) => v !== newWave[i]);
          if (charts) {
            charts.cooldownWave = newWave;
          } else {
            charts = { vvvPrices: [], vvvTimestamps: [], diemPrices: [], diemTimestamps: [], cooldownWave: newWave };
          }
          plog(`cooldown chart ok — wave ${newWave.length}pts`);
          if (waveChanged && !disposed) tui.requestRender();
        } catch (err) { plog(`cooldown error: ${err}`); }
      }

      async function getExposureSparkline(period: "1h" | "24h" | "7d" | "30d" = "24h"): Promise<WalletExposure | null> {
        const periodMap: Record<string, { granularity: string; slice: number }> = {
          "1h":  { granularity: "1h", slice: 20 },
          "24h": { granularity: "1h", slice: 24 },
          "7d":  { granularity: "4h", slice: 42 },
          "30d": { granularity: "1d", slice: 30 },
        };
        const { granularity, slice } = periodMap[period] ?? periodMap["24h"];
        const addr = getWallet();
        if (!addr) return null;
        const url = `https://venicestats.com/api/wallet-history?address=${addr}&granularity=${granularity}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return null;
        const d = await res.json() as any;
        const rawPts: any[] = Array.isArray(d.points) ? d.points : [];
        if (rawPts.length === 0) return null;
        const pts: number[] = rawPts
          .map((p: any) => (p.svvvUsd ?? 0) + (p.diemUsd ?? 0) + (p.vvvUsd ?? 0) + (p.cooldownUsd ?? 0));
        const tail = pts.slice(-slice);
        const sparkW = Math.min(tail.length, 20);
        const first = tail[0];
        const last = tail[tail.length - 1];
        const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
        const lastPt = rawPts[rawPts.length - 1];
        const cooldownVvv: number = lastPt?.cooldown ?? 0;
        return { sparkline: sparkline(tail, sparkW), currentExposure: last, changePct, cooldownVvv };
      }

      async function fetchWalletHistory() {
        if (!getPanels().includes("wallet") || !getWallet()) { walletExposure = null; return; }
        if (walletHistoryInFlight) return;
        walletHistoryInFlight = true;
        try {
          walletExposure = await getExposureSparkline(getExposurePeriod());
          if (walletExposure) plog(`wallet-history ok — $${walletExposure.currentExposure.toFixed(0)} chg=${walletExposure.changePct.toFixed(1)}%`);
        } catch (err) { plog(`wallet-history error: ${err}`); }
        finally { walletHistoryInFlight = false; }
        if (!disposed) tui.requestRender();
      }

      // ── Health sentinel ───────────────────────────────────────────────────
      // Track the previous age per pipeline. When ageSec drops, the pipeline
      // just updated and we should refetch its data.
      const prevAge = new Map<string, number>();

      async function fetchHealth() {
        try {
          const res = await fetch(HEALTH_ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) { plog(`health error: ${res.status}`); return; }
          const d = await res.json() as any;
          const panels = getPanels();

          for (const p of d.pipelines ?? []) {
            const name = p.name as string;
            const age  = p.ageSec as number;
            const prev = prevAge.get(name) ?? Infinity;

            // Pipeline just refreshed (age dropped significantly)
            if (prev !== Infinity && age < prev) {
              plog(`pipeline ${name} updated (age ${prev}s → ${age}s)`);

              // Decide which data to refetch based on pipeline
              if (name === "prices") {
                fetchMetrics();
                fetchTokenCharts();
              } else if (name === "diem") {
                fetchMetrics();
              } else if (name === "staking") {
                fetchMetrics();
                fetchCooldownChart();
                fetchSocial();
              } else if (name === "rewards" && panels.includes("wallet")) {
                fetchWallet();
              }
            }

            prevAge.set(name, age);
          }
        } catch (err) { plog(`health error: ${err}`); }
      }

      // Controller wiring
      controller.triggerTokenRefresh = () => {
        charts = {
          vvvPrices:      [],
          vvvTimestamps: [],
          diemPrices:    [],
          diemTimestamps:[],
          cooldownWave:  charts?.cooldownWave ?? [],
        };
        fetchTokenCharts();
      };
      controller.triggerCooldownRefresh = () => {
        fetchCooldownChart();
      };
      controller.triggerExposureRefresh = () => {
        walletExposure = null;
        fetchWalletHistory();
      };
      // Billing: 1 req/min max (also triggered on agent_end)
      let billingLastHit = Date.now();

      // Force billing refresh now (bypasses 60s rate limit) — called after agent_end.
      // Reset billingLastHit so the next scheduled tick doesn't immediately re-fetch
      // and double up against the rate limit.
      controller.triggerBillingRefresh = () => {
        billingLastHit = Date.now();
        fetchBilling();
      };

      // Initial fetch so the widget isn't empty on startup
      plog("health/metrics init");
      fetchHealth();
      fetchMetrics();
      fetchTokenCharts();
      fetchCooldownChart();
      if (getPanels().includes("wallet")) fetchWallet();
      if (getPanels().includes("social")) fetchSocial();
      if (getPanels().includes("markets")) fetchMarkets();
      fetchBilling();
      let lastHealthFetch = Date.now();

      // Defensive wrapper — async fetchers already catch internally, but if
      // an unexpected throw escapes, an unhandled rejection from a setInterval
      // callback would crash the host pi process. Swallow + log instead.
      const safe = (fn: () => Promise<void>, label: string) => {
        try { fn().catch(err => plog(`${label} unhandled: ${err}`)); }
        catch (err) { plog(`${label} sync throw: ${err}`); }
      };

      const ticker = setInterval(() => {
        if (disposed) return;
        const now = Date.now();

        // Health sentinel
        if (now - lastHealthFetch >= HEALTH_POLL_MS) {
          lastHealthFetch = now;
          safe(fetchHealth, "fetchHealth");
        }

        // Billing: 1 req/min max (also triggered on agent_end)
        if (now - billingLastHit >= 60_000) {
          billingLastHit = now;
          safe(fetchBilling, "fetchBilling");
        }
      }, TICK_MS);

      return {
        invalidate() {},

        render(width: number): string[] {
          function fitLine(content: string, w: number): string {
            const measured = visibleWidth(content);
            if (measured > w) return truncateToWidth(content, w, "");
            return content + " ".repeat(w - measured);
          }

          const allData: AllData = {
            metrics, wallet: wallet as WalletData | null,
            social, markets, billing, charts, walletExposure,
            walletAddr: getWallet(),
            flash: { vvv: vvvFlash, diem: diemFlash },
          };

          const activeStatsSrcs = getPanels();
          const dataBySource: Record<string, unknown> = { metrics, wallet, social, markets, charts };
          const hasAnyData = activeStatsSrcs.some(id => dataBySource[PANEL_REGISTRY[id]?.sources?.[0]] != null);
          const apiDown = activeStatsSrcs.length > 0
            && !hasAnyData
            && activeStatsSrcs.every(id => {
              const s = (PANEL_REGISTRY[id]?.sources ?? [])[0];
              return s ? (sourceErrors.get(s) ?? 0) >= 3 : true;
            });

          if (apiDown) return [fitLine(theme.fg("dim", "venicestats.com unavailable, retrying\u2026"), width)];

          const panels = getPanels();
          const RAIL_W = 40;
          const isNarrow = width < 80;
          const isWide = width >= 120;
          const hasRail = !isNarrow;
          const leftW = hasRail ? width - RAIL_W - 3 : width;
          const clock = renderClock(theme, getTimezone(), getTimeFormat(), billing);
          const spc = "   ";

          const H = "\u2500", V = "\u2502";
          const dim = (s: string) => theme.fg("dim", s);
          const hdr = (s: string) => theme.fg("syntaxKeyword", s);

          const hLineL = H.repeat(leftW);
          const hLineR = H.repeat(RAIL_W);
          const borderTop    = dim("\u250C" + hLineL + "\u252C" + hLineR + "\u2510");
          const borderBot    = dim("\u2514" + hLineL + "\u2534" + hLineR + "\u2518");
          const divBoth      = dim("\u251C" + hLineL + "\u253C" + hLineR + "\u2524");
          const divLeftOnly  = dim("\u251C" + hLineL + "\u2524");
          const bL = dim(V);
          const bM = dim(V);

          function contentRow(left: string, right: string): string {
            return bL + fitLine(left, leftW) + bM + fitLine(right, RAIL_W) + bL;
          }
          function divLeftRow(right: string): string {
            return divLeftOnly + fitLine(right, RAIL_W) + bL;
          }

          const preset = getPreset();

          // ── PRESET: off ──
          if (preset === "off") return [];

          // ── PRESET: usage ──
          if (preset === "usage") {
            const rightAlign = (s: string): string => {
              const w = visibleWidth(s);
              return w >= width ? s : " ".repeat(width - w) + s;
            };
            const sysLine = clock.epoch
              ? clock.time + dim(" \u00B7 ") + clock.epoch
              : clock.time;
            const lines: string[] = [rightAlign(sysLine)];
            if (clock.usd || clock.diem) {
              const parts = [clock.usd, clock.diem].filter(Boolean);
              lines.push(rightAlign(parts.join(dim(" \u00B7 "))));
            }
            return lines;
          }

          // ── PRICES ──
          let priceL1 = "", priceL2 = "";
          if (metrics) {
            const vvvColor  = vvvFlash  === "up" ? "success" : vvvFlash  === "down" ? "error" : "text";
            const diemColor = diemFlash === "up" ? "success" : diemFlash === "down" ? "error" : "text";

            const PERIOD_MS: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 };
            const tp = getTokenPeriod();

            function trimToWindow(pts: number[], ts: number[]): number[] {
              if (!pts.length || !ts.length) return pts;
              const windowMs = PERIOD_MS[tp] ?? 86_400_000;
              const cutoff = ts[ts.length - 1] - windowMs;
              let idx = 0;
              for (let i = 0; i < ts.length; i++) { if (ts[i] >= cutoff) { idx = i; break; } }
              return pts.slice(idx);
            }

            const vvvSparkPts  = charts ? trimToWindow(charts.vvvPrices,  charts.vvvTimestamps)  : [];
            const diemSparkPts = charts ? trimToWindow(charts.diemPrices, charts.diemTimestamps) : [];



            let vvvChangePct: number;
            let diemChangePct: number;
            if (tp === "30d") {
              const vvvFirst = vvvSparkPts[0]  ?? 0;
              const vvvLast  = vvvSparkPts[vvvSparkPts.length - 1]  ?? 0;
              const diemFirst = diemSparkPts[0] ?? 0;
              const diemLast  = diemSparkPts[diemSparkPts.length - 1] ?? 0;
              vvvChangePct  = vvvFirst  > 0 ? ((vvvLast  - vvvFirst)  / vvvFirst)  * 100 : 0;
              diemChangePct = diemFirst > 0 ? ((diemLast - diemFirst) / diemFirst) * 100 : 0;
            } else {
              const PERIOD_KEYS: Record<string, { vvv: keyof MetricsData; diem: keyof MetricsData }> = {
                "1h":  { vvv: "vvvPriceChange1h",  diem: "diemPriceChange1h" },
                "24h": { vvv: "priceChange24h",    diem: "diemPriceChange24h" },
                "7d":  { vvv: "vvvPriceChange7d",   diem: "diemPriceChange7d" },
              };
              const pk = PERIOD_KEYS[tp] ?? PERIOD_KEYS["24h"];
              vvvChangePct  = metrics[pk.vvv]  as number;
              diemChangePct = metrics[pk.diem] as number;
            }
            const vvvSparkColor = vvvChangePct  >= 0 ? "success" : "error";
            const diemSparkColor = diemChangePct >= 0 ? "success" : "error";
            const sparkW = isWide ? 12 : 8;
            const vvvSpark  = vvvSparkPts.length >= 2
              ? theme.fg(vvvSparkColor,  sparkline(vvvSparkPts,  sparkW)) : "";
            const diemSpark = diemSparkPts.length >= 2
              ? theme.fg(diemSparkColor, sparkline(diemSparkPts, sparkW)) : "";
            const diemMCap = metrics.diemPrice * metrics.diemSupply;
            const gap = isWide ? "      " : "    ";

            const vvvP = hdr("VVV ") +
              theme.fg(vvvColor, `$${metrics.vvvPrice.toFixed(4)}`) +
              (vvvSpark ? " " + vvvSpark : "") +
              theme.fg(vvvSparkColor, ` ${arrow(vvvChangePct)}`) +
              dim(` ${tp}`);
            const diemP = hdr("DIEM ") +
              theme.fg(diemColor, `$${metrics.diemPrice.toFixed(2)}`) +
              (diemSpark ? " " + diemSpark : "") +
              theme.fg(diemSparkColor, ` ${arrow(diemChangePct)}`) +
              dim(` ${tp}`);

            const vvvRank  = social?.marketCapRank     ? dim(" \u00B7 Ranked #") + theme.fg("text", String(social.marketCapRank))     : "";
            const diemRank = social?.diemMarketCapRank ? dim(" \u00B7 Ranked #") + theme.fg("text", String(social.diemMarketCapRank)) : "";
            const vvvFdv  = metrics.fdv     ? dim(" \u00B7 FDV ") + theme.fg("text", fmtUSD(metrics.fdv))     : "";
            const diemFdv = metrics.diemFdv ? dim(" \u00B7 FDV ") + theme.fg("text", fmtUSD(metrics.diemFdv)) : "";
            const vvvM = dim("MCap ") + theme.fg("text", fmtUSD(metrics.marketCap)) + vvvRank + vvvFdv;
            const diemM = dim("MCap ") + theme.fg("text", fmtUSD(diemMCap)) + diemRank + diemFdv;

            const vvvBlockW = Math.max(visibleWidth(vvvP), visibleWidth(vvvM));
            priceL1 = fitLine(vvvP, vvvBlockW) + gap + diemP;
            priceL2 = fitLine(vvvM, vvvBlockW) + gap + diemM;
          } else {
            priceL1 = dim("Loading\u2026");
          }

          // ── STAKING ──
          let stakingHeader = hdr("VVV STAKING");
          let stakingData = "";
          const hasStaking = panels.includes("staking") || panels.includes("protocol");
          if (hasStaking && metrics) {
            const gw = gaugeWidth(leftW);
            const staked =
              dim("Staked ") + gauge(metrics.stakingRatio / 100, gw, theme) +
              theme.fg("text", ` ${metrics.stakingRatio.toFixed(1)}%`) +
              dim(" @ ") + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`);
            const locked =
              dim("Locked ") + gauge(metrics.lockRatio / 100, gw, theme, "syntaxType") +
              theme.fg("text", ` ${metrics.lockRatio.toFixed(1)}%`);

            const wave = charts?.cooldownWave ?? [];
            const cooldownP = getCooldownPeriod();
            const waveChg = wave.length >= 2 && wave[0] > 0
              ? ((wave[wave.length - 1] - wave[0]) / wave[0]) * 100 : 0;
            const waveDir = waveChg <= -2 ? "success" : waveChg >= 2 ? "error" : "text";
            const coolSparkW = isWide ? 11 : 7;
            const coolSpark = wave.length ? theme.fg(waveDir, sparkline(wave, coolSparkW)) + " " : "";
            const coolFull =
              dim("Cooldown ") + coolSpark +
              theme.fg("text", fmtK(metrics.cooldownVvv)) +
              (wave.length >= 2 ? theme.fg(waveDir, ` ${arrow(waveChg)}`) + dim(` ${cooldownP}`) : "");
            const coolShort =
              dim("Cooldown ") + coolSpark + theme.fg("text", fmtK(metrics.cooldownVvv));

            stakingData = staked + spc + locked + spc + coolFull;
            if (visibleWidth(stakingData) > leftW) stakingData = staked + spc + locked + spc + coolShort;
            if (visibleWidth(stakingData) > leftW) stakingData = staked + spc + locked;
            if (visibleWidth(stakingData) > leftW) stakingData = staked;
          }

          // ── DIEM ──
          let diemHeader = hdr("DIEM ANALYTICS");
          let diemData = "";
          if (panels.includes("diem") && metrics) {
            const gw = gaugeWidth(leftW, 0.05);
            const delta = DIEM_TARGET_SUPPLY - metrics.diemSupply;
            const deltaSign = delta >= 0 ? "+" : "\u2212";
            const deltaColor = delta >= 0 ? "success" : "error";
            diemData =
              dim("DIEM Supply ") + theme.fg("text", fmtK(metrics.diemSupply)) + spc +
              dim("Mint Rate ") + theme.fg("text", `${metrics.mintRate.toFixed(0)} sVVV`) + spc +
              dim("Target \u0394 ") + theme.fg(deltaColor, `${deltaSign}${fmtK(Math.abs(delta))}`) + spc +
              dim("Staked ") + gauge(metrics.diemStakeRatio, gw, theme) +
              theme.fg("text", ` ${(metrics.diemStakeRatio * 100).toFixed(1)}%`);
          }

          // ── 24H MARKET ──
          let mktHeader = hdr("24H MARKET");
          let mktLine1 = "", mktLine2 = "";
          if (panels.includes("markets") && markets) {
            const chg = (v: number | null): string => {
              if (v == null) return "";
              return theme.fg(v >= 0 ? "success" : "error", ` ${arrow(v)}`);
            };

            const vol = dim("Vol ") + theme.fg("text", fmtUSD(markets.volume)) + chg(markets.volumeChange);
            const traders = dim("Traders ") + theme.fg("text", fmtNum4(markets.traders)) + chg(markets.traderGrowth);
            const swaps = markets.swaps != null
              ? dim("Swaps ") + theme.fg("text", fmtK(markets.swaps)) + chg(markets.swapGrowth) : "";

            mktLine1 = vol + spc + traders;
            if (swaps && visibleWidth(mktLine1 + spc + swaps) <= leftW) mktLine1 += spc + swaps;

            const sellPct = 100 - markets.buyPct;
            const buyColor = markets.buyPct >= 50 ? "success" : "error";
            const buySell = dim("Buy/Sell ") + theme.fg(buyColor, `${markets.buyPct}/${sellPct}%`);
            const netFlow = metrics?.netFlow7d != null
              ? dim("Net Flow ") +
                theme.fg(metrics.netFlow7d >= 0 ? "success" : "error", `${fmtVVV(metrics.netFlow7d)} VVV`) +
                dim(" (7d)")
              : "";
            const pool = markets.topPoolName != null
              ? dim("Top: ") + theme.fg("text", markets.topPoolName) +
                (markets.topPoolShare != null ? dim(` (${markets.topPoolShare}%)`) : "")
              : "";

            mktLine2 = buySell;
            if (netFlow) mktLine2 += spc + netFlow;
            if (pool && visibleWidth(mktLine2 + spc + pool) <= leftW) mktLine2 += spc + pool;
          }

          // ── RIGHT RAIL ──
          const systemHeader = hdr("SYSTEM");
          const systemLine = clock.epoch
            ? clock.time + dim(" \u00B7 ") + clock.epoch
            : clock.time;

          const balanceHeader = hdr("BALANCE");
          let balanceLine = "";
          if (clock.usd || clock.diem) {
            const parts: string[] = [];
            if (clock.usd) parts.push(clock.usd);
            if (clock.diem) parts.push(clock.diem);
            balanceLine = parts.join(dim(" \u00B7 "));
          }

          const walletHeader = hdr("WALLET");
          let walletAddrLine = "";
          let walletPortLine = "";
          let walletSvvvLine = "";
          const expHeader = hdr("PROTOCOL EXPOSURE");
          let expLine = "";

          if (panels.includes("wallet")) {
            const addr = getWallet();
            if (wallet && metrics) {
              const emoji = SIZE_EMOJI[wallet.sizeLabel] ?? "";
              const roleColor = (ROLE_COLOR[wallet.role] ?? "dim") as import("@mariozechner/pi-coding-agent").ThemeColor;
              walletAddrLine =
                theme.fg(roleColor, fmtAddr(addr ?? "")) +
                (wallet.role ? " " + theme.fg(roleColor, wallet.role) : "") +
                (wallet.sizeLabel ? " " + theme.fg("accent", wallet.sizeLabel) : "") +
                (emoji ? " " + emoji : "");
              const cdVvv = walletExposure?.cooldownVvv ?? 0;
              walletPortLine =
                dim("Portfolio ") + theme.fg("text", fmtUSD(
                  (wallet.svvvBalance + wallet.vvvBalance + wallet.pendingRewards + cdVvv) * metrics.vvvPrice
                )) +
                "   " + dim("Rank #") + theme.fg("text", String(wallet.rank)) +
                dim(`/${fmtK(wallet.totalVenetians)}`);
              walletSvvvLine =
                dim("\u23BF sVVV ") + theme.fg("text", fmtNum4(wallet.svvvBalance)) +
                spc + dim("Pending ") + theme.fg("success", `${wallet.pendingRewards.toFixed(2)} VVV`);
              if (walletExposure) {
                const liveExposure =
                  (wallet.svvvBalance + wallet.vvvBalance + wallet.pendingRewards + walletExposure.cooldownVvv) * metrics.vvvPrice +
                  wallet.diemStaked * metrics.diemPrice;
                const expDir = walletExposure.changePct >= 0 ? "success" : "error";
                expLine =
                  theme.fg(expDir, walletExposure.sparkline) + " " +
                  theme.fg("text", fmtUSD(liveExposure)) +
                  theme.fg(expDir, ` ${arrow(walletExposure.changePct)}`) +
                  dim(` ${getExposurePeriod()}`);
              }
            } else if (addr) {
              walletAddrLine = dim(`Loading ${fmtAddr(addr)}\u2026`);
            } else {
              walletAddrLine = dim("/venice-wallet <0x\u2026>");
            }
          }

          // ── PRESET: wallet ──
          if (preset === "wallet") {
            let walletL1 = hdr("WALLET") + "  ";
            let walletL2 = "";
            const wAddr = getWallet();
            if (wallet && metrics) {
              const emoji      = SIZE_EMOJI[wallet.sizeLabel] ?? "";
              const roleColor  = (ROLE_COLOR[wallet.role] ?? "dim") as import("@mariozechner/pi-coding-agent").ThemeColor;
              const cdVvv      = walletExposure?.cooldownVvv ?? 0;
              walletL1 +=
                theme.fg(roleColor, fmtAddr(wAddr ?? "")) +
                (wallet.role      ? " " + theme.fg(roleColor, wallet.role)           : "") +
                (wallet.sizeLabel ? " " + theme.fg("accent",  wallet.sizeLabel)      : "") +
                (emoji            ? " " + emoji                                       : "") +
                "   " + dim("Rank #") + theme.fg("text", String(wallet.rank)) +
                dim("/" + fmtK(wallet.totalVenetians));
              walletL2 =
                dim("\u23BF Portfolio ") + theme.fg("text", fmtUSD(
                  (wallet.svvvBalance + wallet.vvvBalance + wallet.pendingRewards + cdVvv) * metrics.vvvPrice
                )) + spc +
                dim("sVVV ") + theme.fg("text", fmtNum4(wallet.svvvBalance)) + spc +
                dim("Pending ") + theme.fg("success", `${wallet.pendingRewards.toFixed(2)} VVV`);
            } else if (wAddr) {
              walletL1 += dim(`Loading ${fmtAddr(wAddr)}\u2026`);
            } else {
              walletL1 += dim("/venice-wallet <0x\u2026>");
            }

            const outRows: string[] = [];
            if (hasRail) {
              outRows.push(borderTop);
              outRows.push(contentRow(priceL1, systemHeader));
              outRows.push(contentRow(priceL2, systemLine));
              outRows.push(divBoth);
              outRows.push(contentRow(walletL1, balanceHeader));
              outRows.push(contentRow(walletL2, balanceLine));
              outRows.push(borderBot);
            } else {
              const lines = [priceL1, priceL2, dim(H.repeat(width)), walletL1];
              if (walletL2) lines.push(walletL2);
              const clockParts = [clock.time, clock.epoch, clock.usd, clock.diem].filter(Boolean);
              if (clockParts.length) { lines.push(dim(H.repeat(width))); lines.push(clockParts.join("   ")); }
              for (const l of lines) outRows.push(fitLine(l, width));
            }
            return outRows;
          }

          // ── ASSEMBLE GRID ──
          const outRows: string[] = [];
          if (hasRail) {
            outRows.push(borderTop);
            outRows.push(contentRow(priceL1, systemHeader));
            outRows.push(contentRow(priceL2, systemLine));
            outRows.push(divBoth);
            outRows.push(contentRow(stakingHeader, balanceHeader));
            outRows.push(contentRow(stakingData, balanceLine));
            outRows.push(divBoth);
            outRows.push(contentRow(diemHeader, walletHeader));
            outRows.push(contentRow(diemData, walletAddrLine));
            outRows.push(divLeftRow(walletPortLine));
            outRows.push(contentRow(mktHeader, walletSvvvLine));
            outRows.push(contentRow(mktLine1, expHeader));
            outRows.push(contentRow(mktLine2, expLine));
            outRows.push(borderBot);
          } else {
            const lines = [priceL1, priceL2];
            if (stakingData) { lines.push(dim(H.repeat(width))); lines.push(stakingHeader, stakingData); }
            if (diemData)    { lines.push(dim(H.repeat(width))); lines.push(diemHeader, diemData); }
            if (mktLine1)    { lines.push(dim(H.repeat(width))); lines.push(mktHeader, mktLine1, mktLine2); }
            const clockParts = [clock.time, clock.epoch, clock.usd, clock.diem].filter(Boolean);
            if (clockParts.length) {
              lines.push(dim(H.repeat(width)));
              lines.push(clockParts.join("   "));
            }
            if (panels.includes("wallet")) {
              const walletPanel = PANEL_REGISTRY.wallet;
              if (walletPanel) {
                const line = walletPanel.render(allData, theme as any, spc, width);
                if (line !== null) {
                  lines.push(dim(H.repeat(width)));
                  if (Array.isArray(line)) for (const l of line) lines.push(l);
                  else lines.push(line);
                }
              }
            }
            for (const l of lines) outRows.push(fitLine(l, width));
          }

          return outRows;
        },

        dispose() {
          plog("dispose() called");
          disposed = true;
          controller.triggerTokenRefresh = () => {};
          controller.triggerCooldownRefresh = () => {};
          controller.triggerExposureRefresh = () => {};
          clearInterval(ticker);
          clearInterval(clockTick);
          if (vvvFlashTimer)  clearTimeout(vvvFlashTimer);
          if (diemFlashTimer) clearTimeout(diemFlashTimer);
        },
      };
    },
    { placement: "belowEditor" },
  );
  plog("setWidget call returned");
  return controller;
}

export function stopPriceWidget(ctx: ExtensionContext): void {
  plog("stopPriceWidget called");
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATS_WIDGET_KEY, undefined);
}
