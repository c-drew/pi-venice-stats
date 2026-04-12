/**
 * Venice stats widget: polling, lock management, and TUI rendering.
 *
 * Two independent polling groups share a single 500 ms master ticker:
 *   1. venicestats.com sources — budget-driven via SOURCE_WEIGHTS
 *   2. venice.ai /billing/balance — own fixed interval (default 30s)
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import {
  PANEL_REGISTRY,
  SOURCE_WEIGHTS,
  BILLING_INTERVAL_MIN,
  BILLING_INTERVAL_MAX,
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

const VENICE_API_BASE   = "https://api.venice.ai/api/v1";
const STATS_WIDGET_KEY  = "venice-stats";
const STATS_LOG         = join(homedir(), ".pi", "venice-stats.log");
const FLASH_MS          = 400;
const BUDGET_MIN        = 1;
const BUDGET_MAX        = 59;
const TICK_MS           = 500;

// ---------------------------------------------------------------------------
// Multi-session lock
// ---------------------------------------------------------------------------

const WIDGET_LOCK = join(homedir(), ".pi", "venice-stats.pid");
let _lockOwned = false;

function isPiProcess(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); } catch { return false; }
  // On Linux/WSL verify the PID belongs to a pi process to guard against
  // PID reuse after a crash.
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.split("\0").some((tok) => /\bpi\b/.test(tok));
  } catch {
    return true; // /proc not available (macOS/Windows) — trust kill(0)
  }
}

export function tryAcquireWidgetLock(): boolean {
  try {
    if (existsSync(WIDGET_LOCK)) {
      const raw = readFileSync(WIDGET_LOCK, "utf8").trim();
      const pid = Number(raw);
      if (!isNaN(pid) && isPiProcess(pid) && pid !== process.pid) {
        return false; // another live pi session owns the lock
      }
    }
    writeFileSync(WIDGET_LOCK, String(process.pid), "utf8");
    _lockOwned = true;
    return true;
  } catch { return false; }
}

/** Try to claim a lock left by a session that appears to be gone.
 *  Refuses if another live pi session still holds it. */
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
// Rate helpers
// ---------------------------------------------------------------------------

function getActiveSources(panels: string[]): Set<string> {
  const sources = new Set<string>();
  for (const id of panels) {
    for (const src of (PANEL_REGISTRY[id]?.sources ?? [])) sources.add(src);
  }
  return sources;
}

function computeIntervals(activeSources: Set<string>, budgetPerMin: number): Map<string, number> {
  const budget = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, budgetPerMin));
  const minInterval = Math.ceil(60_000 / budget);
  const totalWeight = [...activeSources].reduce(
    (s, src) => s + (SOURCE_WEIGHTS[src] ?? 1), 0
  );
  const map = new Map<string, number>();
  for (const src of activeSources) {
    const reqPerMin = ((SOURCE_WEIGHTS[src] ?? 1) / totalWeight) * budget;
    map.set(src, Math.max(minInterval, Math.round(60_000 / reqPerMin)));
  }
  return map;
}

function plog(msg: string) {
  const ts = new Date().toISOString();
  try { appendFileSync(STATS_LOG, `[${ts}] ${msg}\n`); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export interface WidgetController {
  /** Trigger an out-of-schedule billing refresh. Call after an agent response
   * so the balance updates promptly rather than waiting for the next interval. */
  triggerBillingRefresh(): void;
}

export function startPriceWidget(
  ctx:                ExtensionContext,
  getWallet:          () => string | undefined,
  getPanels:          () => string[],
  getBudget:          () => number,
  getTimezone:        () => string,
  getTimeFormat:      () => "24h" | "12h",
  getBillingInterval: () => number,
): WidgetController {
  const controller: WidgetController = {
    triggerBillingRefresh: () => {}, // wired up once the widget factory runs
  };
  plog(`startPriceWidget called — hasUI=${ctx.hasUI}`);
  if (!ctx.hasUI) return controller;

  ctx.ui.setWidget(
    STATS_WIDGET_KEY,
    (tui, theme) => {
      plog("widget factory invoked");

      let metrics:  MetricsData  | null = null;
      let wallet:   WalletData   | null = null;
      let social:   SocialData   | null = null;
      let markets:  MarketsData  | null = null;
      let billing:  BillingData  | null = null;
      let charts:   ChartsData   | null = null;
      let walletExposure: WalletExposure | null = null;
      let lastWalletAddr: string | undefined;
      let disposed = false;

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

      async function fetchBilling() {
        const adminKey = process.env["VENICE_ADMIN_API_KEY"];
        if (!adminKey) { billing = null; return; }
        try {
          const res = await fetch(`${VENICE_API_BASE}/billing/balance`, {
            headers: { Authorization: `Bearer ${adminKey}` },
          });
          if (!res.ok) { plog(`billing error: ${res.status}`); return; }
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
          const res = await fetch("https://venicestats.com/api/metrics");
          if (!res.ok) { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); plog(`metrics error: ${res.status}`); return; }
          const d = await res.json() as any;
          if (typeof d.vvvPrice !== "number") { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); return; }
          sourceErrors.set("metrics", 0);
          if (metrics && d.vvvPrice  !== metrics.vvvPrice)  setFlash("vvv",  d.vvvPrice  > metrics.vvvPrice  ? "up" : "down");
          if (metrics && d.diemPrice !== metrics.diemPrice) setFlash("diem", d.diemPrice > metrics.diemPrice ? "up" : "down");
          metrics = {
            vvvPrice: d.vvvPrice, diemPrice: d.diemPrice, ethPrice: d.ethPrice ?? 0,
            priceChange24h: d.priceChange24h ?? 0, diemPriceChange24h: d.diemPriceChange24h ?? 0,
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
          };
          plog(`metrics ok — VVV=$${d.vvvPrice?.toFixed(4)} DIEM=$${d.diemPrice?.toFixed(2)}`);
          logPanels();
        } catch (err) { sourceErrors.set("metrics", (sourceErrors.get("metrics") ?? 0) + 1); plog(`metrics error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchWallet() {
        if (!getPanels().includes("wallet")) { wallet = null; return; }
        const addr = getWallet();
        if (!addr) { wallet = null; return; }
        if (addr !== lastWalletAddr) { wallet = null; lastWalletAddr = addr; }
        try {
          const res = await fetch(`https://venicestats.com/api/venetians?address=${addr}`);
          if (!res.ok) { sourceErrors.set("wallet", (sourceErrors.get("wallet") ?? 0) + 1); plog(`wallet error: ${res.status}`); return; }
          sourceErrors.set("wallet", 0);
          const d = await res.json() as any;
          wallet = {
            label: d.ensName ?? fmtAddr(d.address ?? addr),
            role: d.roleLabel ?? "", sizeLabel: d.sizeLabel ?? "",
            svvvBalance: d.svvvBalance ?? 0, diemStaked: d.diemStaked ?? 0,
            pendingRewards: d.pendingRewards ?? 0,
            rank: d.rank ?? 0, totalVenetians: d.totalVenetians ?? 0,
          };
          plog(`wallet ok — ${wallet.label} rank #${wallet.rank}`);
          logPanels();
          // Fire wallet history in parallel (non-blocking, shares wallet budget)
          fetchWalletHistory();
        } catch (err) { sourceErrors.set("wallet", (sourceErrors.get("wallet") ?? 0) + 1); plog(`wallet error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchSocial() {
        if (!getActiveSources(getPanels()).has("social")) return;
        try {
          const res = await fetch("https://venicestats.com/api/social");
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
        if (!getPanels().includes("markets")) return;
        try {
          const res = await fetch("https://venicestats.com/api/markets?token=VVV&period=24h");
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

      async function fetchCharts() {
        if (!getActiveSources(getPanels()).has("charts")) return;
        try {
          const [vvvRes, diemRes, waveRes] = await Promise.all([
            fetch("https://venicestats.com/api/charts?period=24h&metric=vvvPrice"),
            fetch("https://venicestats.com/api/charts?period=24h&metric=diemPrice"),
            fetch("https://venicestats.com/api/charts?period=7d&metric=cooldownWave"),
          ]);
          if (!vvvRes.ok || !diemRes.ok || !waveRes.ok) {
            sourceErrors.set("charts", (sourceErrors.get("charts") ?? 0) + 1);
            plog(`charts error: ${vvvRes.status} / ${diemRes.status} / ${waveRes.status}`);
            return;
          }
          sourceErrors.set("charts", 0);
          const vvvD  = await vvvRes.json()  as any;
          const diemD = await diemRes.json() as any;
          const waveD = await waveRes.json() as any;
          charts = {
            vvvPrices:    Array.isArray(vvvD.data)  ? vvvD.data.map((p: any)  => p.v as number) : [],
            diemPrices:   Array.isArray(diemD.data) ? diemD.data.map((p: any) => p.v as number) : [],
            cooldownWave: Array.isArray(waveD.data) ? waveD.data.map((p: any) => p.v as number) : [],
          };
          plog(`charts ok — vvv ${charts.vvvPrices.length}pts diem ${charts.diemPrices.length}pts wave ${charts.cooldownWave.length}pts`);
        } catch (err) { sourceErrors.set("charts", (sourceErrors.get("charts") ?? 0) + 1); plog(`charts error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      /**
       * Fetch wallet exposure history and build a sparkline + change%.
       * Accepts granularity ("1h" | "4h" | "1d"). Uses last 20 data points.
       * Each point's totalExposureUsd = svvvUsd + diemUsd + vvvUsd + cooldownUsd.
       */
      async function getExposureSparkline(granularity: "1h" | "4h" | "1d" = "1d"): Promise<WalletExposure | null> {
        const addr = getWallet();
        if (!addr) return null;
        const url = `https://venicestats.com/api/wallet-history?address=${addr}&granularity=${granularity}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const d = await res.json() as any;
        const pts: number[] = (Array.isArray(d.points) ? d.points : [])
          .map((p: any) => (p.svvvUsd ?? 0) + (p.diemUsd ?? 0) + (p.vvvUsd ?? 0) + (p.cooldownUsd ?? 0));
        if (pts.length === 0) return null;

        const tail = pts.slice(-20);
        const first = tail[0];
        const last = tail[tail.length - 1];
        const changePct = first > 0 ? ((last - first) / first) * 100 : 0;

        return { sparkline: sparkline(tail, tail.length), currentExposure: last, changePct };
      }

      async function fetchWalletHistory() {
        if (!getPanels().includes("wallet") || !getWallet()) { walletExposure = null; return; }
        try {
          walletExposure = await getExposureSparkline("1d");
          if (walletExposure) plog(`wallet-history ok — $${walletExposure.currentExposure.toFixed(0)} chg=${walletExposure.changePct.toFixed(1)}%`);
        } catch (err) { plog(`wallet-history error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      const fetchFns: Record<string, () => Promise<void>> = {
        metrics: fetchMetrics,
        wallet:  fetchWallet,
        social:  fetchSocial,
        markets: fetchMarkets,
        charts:  fetchCharts,
        billing: fetchBilling,
      };

      const lastFetch = new Map<string, number>();

      // Wire the controller so agent_end can trigger an early billing refresh
      controller.triggerBillingRefresh = () => {
        lastFetch.set("billing", 0);
      };

      function clampBillingMs(): number {
        return Math.max(
          BILLING_INTERVAL_MIN * 1000,
          Math.min(BILLING_INTERVAL_MAX * 1000, getBillingInterval() * 1000),
        );
      }

      const initSrcs = getActiveSources(getPanels());
      const initIntervals = computeIntervals(initSrcs, getBudget());
      plog(`schedule (budget=${getBudget()}/min panels=${getPanels().join(",")}): ` +
        [...initSrcs].map(s => `${s}=${((initIntervals.get(s) ?? 0) / 1000).toFixed(1)}s`).join(" | ")
      );

      for (const src of initSrcs) {
        fetchFns[src]?.();
        lastFetch.set(src, Date.now());
      }
      fetchFns.billing();
      lastFetch.set("billing", Date.now());

      const ticker = setInterval(() => {
        if (disposed) return;
        const now        = Date.now();
        const activeSrcs = getActiveSources(getPanels());
        const intervals  = computeIntervals(activeSrcs, getBudget());

        for (const src of activeSrcs) {
          const due = (lastFetch.get(src) ?? 0) + (intervals.get(src) ?? Math.ceil(60_000 / getBudget()));
          if (now >= due) {
            lastFetch.set(src, now);
            fetchFns[src]?.();
          }
        }

        const billingDue = (lastFetch.get("billing") ?? 0) + clampBillingMs();
        if (now >= billingDue) {
          lastFetch.set("billing", now);
          fetchFns.billing();
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

          const activeStatsSrcs = [...getActiveSources(getPanels())].filter(s => s !== "billing");
          const dataBySource: Record<string, unknown> = { metrics, wallet, social, markets, charts };
          const hasAnyData = activeStatsSrcs.some(s => dataBySource[s] != null);
          const apiDown = activeStatsSrcs.length > 0
            && !hasAnyData
            && activeStatsSrcs.every(s => (sourceErrors.get(s) ?? 0) >= 3);

          if (apiDown) return [fitLine(theme.fg("dim", "venicestats.com unavailable, retrying\u2026"), width)];

          const panels = getPanels();
          const RAIL_W = 40;
          const isNarrow = width < 80;
          const isWide = width >= 120;
          const hasRail = !isNarrow;
          const leftW = hasRail ? width - RAIL_W - 1 : width;
          const B = theme.fg("dim", "\u2502");
          const SEP_L = theme.fg("dim", "\u2500".repeat(leftW));
          const SEP_R = theme.fg("dim", "\u2500".repeat(RAIL_W));
          const clock = renderClock(theme, getTimezone(), getTimeFormat(), billing);
          const hasBilling = clock.usd !== "" || clock.diem !== "";
          const spc = "   ";

          // ══════════════════════════════════════════════════════════════════
          // LEFT COLUMN — protocol + market intelligence
          // ══════════════════════════════════════════════════════════════════
          const leftLines: string[] = [];

          // ── PRICES ──
          if (metrics) {
            const vvvColor  = vvvFlash  === "up" ? "success" : vvvFlash  === "down" ? "error" : "text";
            const diemColor = diemFlash === "up" ? "success" : diemFlash === "down" ? "error" : "text";
            const vvvChg    = metrics.priceChange24h     >= 0 ? "success" : "error";
            const diemChg   = metrics.diemPriceChange24h >= 0 ? "success" : "error";

            const sparkW = isWide ? 12 : isNarrow ? 6 : 8;
            const vvvSpark  = charts?.vvvPrices.length
              ? theme.fg(vvvChg, sparkline(charts.vvvPrices, sparkW)) : "";
            const diemSpark = charts?.diemPrices.length
              ? theme.fg(diemChg, sparkline(charts.diemPrices, sparkW)) : "";
            const diemMCap = metrics.diemPrice * metrics.diemSupply;
            const gap = isWide ? "      " : "    ";

            const vvvP = theme.fg("dim", "VVV ") +
              theme.fg(vvvColor, `$${metrics.vvvPrice.toFixed(4)}`) +
              (vvvSpark ? " " + vvvSpark : "") +
              theme.fg(vvvChg, ` ${arrow(metrics.priceChange24h)}`) +
              theme.fg("dim", " 24h");
            const diemP = theme.fg("dim", "DIEM ") +
              theme.fg(diemColor, `$${metrics.diemPrice.toFixed(2)}`) +
              (diemSpark ? " " + diemSpark : "") +
              theme.fg(diemChg, ` ${arrow(metrics.diemPriceChange24h)}`) +
              theme.fg("dim", " 24h");

            const vvvRank  = social?.marketCapRank     ? theme.fg("dim", " Ranked #") + theme.fg("text", String(social.marketCapRank))     : "";
            const diemRank = social?.diemMarketCapRank ? theme.fg("dim", " Ranked #") + theme.fg("text", String(social.diemMarketCapRank)) : "";
            const vvvM = theme.fg("dim", "MCap ") + theme.fg("text", fmtUSD(metrics.marketCap)) + vvvRank;
            const diemM = theme.fg("dim", "MCap ") + theme.fg("text", fmtUSD(diemMCap)) + diemRank;

            const vvvBlockW = Math.max(visibleWidth(vvvP), visibleWidth(vvvM));
            leftLines.push(fitLine(vvvP, vvvBlockW) + gap + diemP);
            leftLines.push(fitLine(vvvM, vvvBlockW) + gap + diemM);
          } else {
            leftLines.push(theme.fg("dim", "Loading\u2026"));
          }

          // ── STAKING ──
          const hasStaking = panels.includes("staking") || panels.includes("protocol");
          if (hasStaking && metrics) {
            leftLines.push(SEP_L);
            leftLines.push(theme.fg("dim", "STAKING"));

            const gw = gaugeWidth(leftW);
            const staked =
              theme.fg("dim", "Staked ") + gauge(metrics.stakingRatio / 100, gw, theme) +
              theme.fg("text", ` ${metrics.stakingRatio.toFixed(1)}%`) +
              theme.fg("dim", " @ ") + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`);
            const locked =
              theme.fg("dim", "Locked ") + gauge(metrics.lockRatio / 100, gw, theme, "syntaxType") +
              theme.fg("text", ` ${metrics.lockRatio.toFixed(1)}%`);

            const wave = charts?.cooldownWave ?? [];
            const waveChg = wave.length >= 2
              ? ((wave[wave.length - 1] - wave[0]) / wave[0]) * 100 : 0;
            const waveDir = waveChg <= -2 ? "success" : waveChg >= 2 ? "error" : "text";
            const coolSparkW = isWide ? 11 : 7;
            const coolSpark = wave.length ? theme.fg(waveDir, sparkline(wave, coolSparkW)) + " " : "";
            const coolFull =
              theme.fg("dim", "Cooldown ") + coolSpark +
              theme.fg("text", fmtK(metrics.cooldownVvv)) +
              (wave.length >= 2 ? theme.fg(waveDir, ` ${arrow(waveChg)}`) + theme.fg("dim", " 7d") : "");
            const coolShort =
              theme.fg("dim", "Cooldown ") + coolSpark + theme.fg("text", fmtK(metrics.cooldownVvv));

            let stakingLine = staked + spc + locked + spc + coolFull;
            if (visibleWidth(stakingLine) > leftW) stakingLine = staked + spc + locked + spc + coolShort;
            if (visibleWidth(stakingLine) > leftW) stakingLine = staked + spc + locked;
            if (visibleWidth(stakingLine) > leftW) stakingLine = staked;

            leftLines.push(stakingLine);
          }

          // ── DIEM ──
          if (panels.includes("diem") && metrics) {
            leftLines.push(SEP_L);
            leftLines.push(theme.fg("dim", "DIEM"));

            const gw = gaugeWidth(leftW, 0.05);
            const diemLine =
              theme.fg("dim", "DIEM Supply ") + theme.fg("text", fmtK(metrics.diemSupply)) + spc +
              theme.fg("dim", "Mint Rate ") + theme.fg("text", `${metrics.mintRate.toFixed(2)} sVVV`) + spc +
              theme.fg("dim", "Remaining Mintable ") + theme.fg("text", fmtK(metrics.remainingMintable)) + spc +
              theme.fg("dim", "Staked ") + gauge(metrics.diemStakeRatio, gw, theme) +
              theme.fg("text", ` ${(metrics.diemStakeRatio * 100).toFixed(1)}%`);
            leftLines.push(diemLine);
          }

          // ── 24H MARKET ──
          if (panels.includes("markets") && markets) {
            leftLines.push(SEP_L);
            leftLines.push(theme.fg("dim", "24H MARKET"));

            const chg = (v: number | null): string => {
              if (v == null) return "";
              return theme.fg(v >= 0 ? "success" : "error", ` (${fmtPct(v)})`);
            };

            const vol = theme.fg("dim", "Vol ") + theme.fg("text", fmtUSD(markets.volume)) + chg(markets.volumeChange);
            const traders = theme.fg("dim", "Traders ") + theme.fg("text", fmtNum4(markets.traders)) + chg(markets.traderGrowth);
            const swaps = markets.swaps != null
              ? theme.fg("dim", "Swaps ") + theme.fg("text", fmtK(markets.swaps)) + chg(markets.swapGrowth) : "";

            let mktLine1 = vol + spc + traders;
            if (swaps && visibleWidth(mktLine1 + spc + swaps) <= leftW) mktLine1 += spc + swaps;
            leftLines.push(mktLine1);

            const sellPct = 100 - markets.buyPct;
            const buyColor = markets.buyPct >= 50 ? "success" : "error";
            const buySell = theme.fg("dim", "Buy/Sell ") + theme.fg(buyColor, `${markets.buyPct}/${sellPct}%`);
            const netFlow = metrics?.netFlow7d != null
              ? theme.fg("dim", "Net Flow ") +
                theme.fg(metrics.netFlow7d >= 0 ? "success" : "error", `${fmtVVV(metrics.netFlow7d)} VVV`) +
                theme.fg("dim", " (7d)")
              : "";
            const pool = markets.topPoolName != null
              ? theme.fg("dim", "Top: ") + theme.fg("text", markets.topPoolName) +
                (markets.topPoolShare != null ? theme.fg("dim", ` (${markets.topPoolShare}%)`) : "")
              : "";

            let mktLine2 = buySell;
            if (netFlow) mktLine2 += spc + netFlow;
            if (pool && visibleWidth(mktLine2 + spc + pool) <= leftW) mktLine2 += spc + pool;
            leftLines.push(mktLine2);
          }

          // ══════════════════════════════════════════════════════════════════
          // RIGHT RAIL — system, balance, wallet
          // ══════════════════════════════════════════════════════════════════
          const railLines: string[] = [];
          if (hasRail) {
            // SYSTEM
            railLines.push(theme.fg("dim", "SYSTEM"));
            railLines.push(clock.time);
            if (clock.epoch) railLines.push(clock.epoch);

            // BALANCE
            if (hasBilling) {
              railLines.push(SEP_R);
              railLines.push(theme.fg("dim", "BALANCE"));
              if (clock.usd) railLines.push(clock.usd);
              if (clock.diem) railLines.push(clock.diem);
            }

            // WALLET
            if (panels.includes("wallet")) {
              railLines.push(SEP_R);
              railLines.push(theme.fg("dim", "WALLET"));
              const addr = getWallet();
              if (wallet && metrics) {
                const roleColor = ROLE_COLOR[wallet.role] ?? "dim";
                const emoji = SIZE_EMOJI[wallet.sizeLabel] ?? "";
                railLines.push(
                  theme.fg("accent", wallet.label) +
                  (wallet.role ? (theme as any).fg(roleColor, ` ${wallet.role}`) : "") +
                  (wallet.sizeLabel ? theme.fg("dim", ` ${wallet.sizeLabel}`) : "") +
                  (emoji ? " " + emoji : ""),
                );
                railLines.push(
                  theme.fg("dim", "Portfolio ") + theme.fg("text", fmtUSD(wallet.svvvBalance * metrics.vvvPrice)) +
                  "  " + theme.fg("dim", "Rank #") + theme.fg("text", String(wallet.rank)) +
                  theme.fg("dim", `/${fmtK(wallet.totalVenetians)}`),
                );
                railLines.push(
                  theme.fg("dim", "\u23BF sVVV ") + theme.fg("text", fmtNum4(wallet.svvvBalance)) +
                  spc + theme.fg("dim", "Pending ") + theme.fg("success", `${wallet.pendingRewards.toFixed(2)} VVV`),
                );
                // 7d exposure sparkline
                if (walletExposure) {
                  const expDir = walletExposure.changePct >= 0 ? "success" : "error";
                  railLines.push(
                    theme.fg(expDir, walletExposure.sparkline) + " " +
                    theme.fg("text", fmtUSD(walletExposure.currentExposure)) +
                    theme.fg(expDir, ` ${arrow(walletExposure.changePct)}`) +
                    theme.fg("dim", " 7d"),
                  );
                }
              } else if (addr) {
                railLines.push(theme.fg("dim", `Loading ${fmtAddr(addr)}\u2026`));
              } else {
                railLines.push(theme.fg("dim", "/venice-wallet <0x\u2026>"));
              }
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // MERGE COLUMNS
          // ══════════════════════════════════════════════════════════════════
          const outRows: string[] = [];
          if (hasRail) {
            const totalRows = Math.max(leftLines.length, railLines.length);
            for (let i = 0; i < totalRows; i++) {
              outRows.push(fitLine(leftLines[i] ?? "", leftW) + B + fitLine(railLines[i] ?? "", RAIL_W));
            }
          } else {
            // Narrow mode: stack everything vertically
            for (const l of leftLines) outRows.push(fitLine(l, width));
            const clockParts = [clock.time, clock.epoch, clock.usd, clock.diem].filter(Boolean);
            if (clockParts.length) {
              outRows.push(theme.fg("dim", "\u2500".repeat(width)));
              outRows.push(fitLine(clockParts.join("   "), width));
            }
            // Wallet in narrow mode — use panel render
            if (panels.includes("wallet")) {
              const walletPanel = PANEL_REGISTRY.wallet;
              if (walletPanel) {
                const line = walletPanel.render(allData, theme as any, spc, width);
                if (line !== null) {
                  outRows.push(theme.fg("dim", "\u2500".repeat(width)));
                  if (Array.isArray(line)) for (const l of line) outRows.push(fitLine(l, width));
                  else outRows.push(fitLine(line, width));
                }
              }
            }
          }

          return outRows;
        },

        dispose() {
          plog("dispose() called");
          disposed = true;
          controller.triggerBillingRefresh = () => {};
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
