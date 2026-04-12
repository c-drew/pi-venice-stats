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
  fmtAddr,
  renderClock,
  type AllData,
  type MetricsData,
  type WalletData,
  type SocialData,
  type MarketsData,
  type BillingData,
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

export function startPriceWidget(
  ctx:                ExtensionContext,
  getWallet:          () => string | undefined,
  getPanels:          () => string[],
  getBudget:          () => number,
  getTimezone:        () => string,
  getTimeFormat:      () => "24h" | "12h",
  getBillingInterval: () => number,
): void {
  plog(`startPriceWidget called — hasUI=${ctx.hasUI}`);
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(
    STATS_WIDGET_KEY,
    (tui, theme) => {
      plog("widget factory invoked");

      let metrics:  MetricsData  | null = null;
      let wallet:   WalletData   | null = null;
      let social:   SocialData   | null = null;
      let markets:  MarketsData  | null = null;
      let billing:  BillingData  | null = null;
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
          metrics, wallet, social, markets, billing,
          walletAddr: getWallet(),
          flash: { vvv: vvvFlash, diem: diemFlash },
        };
        for (const id of getPanels()) {
          const panel = PANEL_REGISTRY[id];
          if (!panel) continue;
          const line = panel.render(allData, noTheme, " · ");
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

      async function fetchMetrics() {
        try {
          const res = await fetch("https://venicestats.com/api/metrics");
          if (!res.ok) return;
          const d = await res.json() as any;
          if (typeof d.vvvPrice !== "number") return;
          if (metrics && d.vvvPrice  !== metrics.vvvPrice)  setFlash("vvv",  d.vvvPrice  > metrics.vvvPrice  ? "up" : "down");
          if (metrics && d.diemPrice !== metrics.diemPrice) setFlash("diem", d.diemPrice > metrics.diemPrice ? "up" : "down");
          metrics = {
            vvvPrice: d.vvvPrice, diemPrice: d.diemPrice, ethPrice: d.ethPrice ?? 0,
            priceChange24h: d.priceChange24h ?? 0, diemPriceChange24h: d.diemPriceChange24h ?? 0,
            marketCap: d.marketCap ?? 0, stakingRatio: (d.stakingRatio ?? 0) * 100,
            stakerApr: d.stakerApr ?? 0, lockRatio: (d.lockRatio ?? 0) * 100,
            mintRate: d.mintRate ?? 0, diemSupply: d.diemSupply ?? 0,
            remainingMintable: d.remainingMintable ?? 0, diemStakeRatio: d.diemStakeRatio ?? 0,
            stakingGrowth7d: d.stakingGrowth7d ?? 1, newStakers7dCount: d.newStakers7dCount ?? 0,
            cooldownVvv: d.cooldownVvv ?? 0, veniceRevenue: d.veniceRevenue ?? 0,
            burnRevenueAnnualized: d.burnRevenueAnnualized ?? 0,
            totalBurnedFromEvents: d.totalBurnedFromEvents ?? 0,
            organicBurned: d.organicBurned ?? 0, burnDeflationRate: d.burnDeflationRate ?? 0,
            emissionRate: d.emissionRate ?? 0,
          };
          plog(`metrics ok — VVV=$${d.vvvPrice?.toFixed(4)} DIEM=$${d.diemPrice?.toFixed(2)}`);
          logPanels();
        } catch (err) { plog(`metrics error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchWallet() {
        if (!getPanels().includes("wallet")) { wallet = null; return; }
        const addr = getWallet();
        if (!addr) { wallet = null; return; }
        if (addr !== lastWalletAddr) { wallet = null; lastWalletAddr = addr; }
        try {
          const res = await fetch(`https://venicestats.com/api/venetians?address=${addr}`);
          if (!res.ok) return;
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
        } catch (err) { plog(`wallet error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchSocial() {
        if (!getPanels().includes("social")) return;
        try {
          const res = await fetch("https://venicestats.com/api/social");
          if (!res.ok) return;
          const d = await res.json() as any;
          social = {
            erikFollowers: d.erikFollowers ?? 0, sentimentUpPct: d.sentimentUpPct ?? 0,
            marketCapRank: d.marketCapRank ?? 0, diemMarketCapRank: d.diemMarketCapRank ?? 0,
            socialVolume: d.socialVolume ?? 0,
          };
          plog(`social ok — Erik ${social.erikFollowers} sentiment=${social.sentimentUpPct.toFixed(0)}%`);
          logPanels();
        } catch (err) { plog(`social error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchMarkets() {
        if (!getPanels().includes("markets")) return;
        try {
          const res = await fetch("https://venicestats.com/api/markets?token=VVV&period=24h");
          if (!res.ok) return;
          const d = await res.json() as any;
          markets = { volume: d.kpis?.volume ?? 0, buyPct: d.kpis?.buyPct ?? 0, traders: d.kpis?.traders ?? 0 };
          plog(`markets ok — vol=$${markets.volume.toFixed(0)} traders=${markets.traders}`);
          logPanels();
        } catch (err) { plog(`markets error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      const fetchFns: Record<string, () => Promise<void>> = {
        metrics: fetchMetrics,
        wallet:  fetchWallet,
        social:  fetchSocial,
        markets: fetchMarkets,
        billing: fetchBilling,
      };

      const lastFetch = new Map<string, number>();

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
          const sep: string = theme.fg("dim", "  ·  ");
          const allData: AllData = {
            metrics, wallet, social, markets, billing,
            walletAddr: getWallet(),
            flash: { vvv: vvvFlash, diem: diemFlash },
          };
          const rows: string[] = [];
          for (const id of getPanels()) {
            const panel = PANEL_REGISTRY[id];
            if (!panel) continue;
            const line = panel.render(allData, theme as any, sep);
            if (Array.isArray(line)) rows.push(...line);
            else if (line) rows.push(line);
          }

          const clockStr   = renderClock(theme, getTimezone(), getTimeFormat(), billing);
          const clockWidth = visibleWidth(clockStr);
          const minPadding = 2;

          if (rows.length > 0) {
            const firstRow      = rows[0];
            const firstRowWidth = visibleWidth(firstRow);
            const totalNeeded   = firstRowWidth + minPadding + clockWidth;
            if (totalNeeded <= width) {
              rows[0] = firstRow + " ".repeat(width - firstRowWidth - clockWidth) + clockStr;
            } else {
              const availForFirst = width - minPadding - clockWidth;
              if (availForFirst > 10) {
                rows[0] = truncateToWidth(firstRow, availForFirst, "") + " ".repeat(minPadding) + clockStr;
              }
            }
          } else {
            rows.push(clockWidth < width ? " ".repeat(width - clockWidth) + clockStr : clockStr);
          }

          return rows;
        },

        dispose() {
          plog("dispose() called");
          disposed = true;
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
}

export function stopPriceWidget(ctx: ExtensionContext): void {
  plog("stopPriceWidget called");
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATS_WIDGET_KEY, undefined);
}
