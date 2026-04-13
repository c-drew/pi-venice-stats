/**
 * Venice stats widget panel registry.
 *
 * Each panel is a named row in the belowEditor widget. Users enable/disable
 * panels with /venice-panel add|remove|reset and reorder with /venice-panel move.
 *
 * Adding a new panel:
 *   1. Add a key to PANEL_REGISTRY with id, label, description, and render().
 *   2. If it needs data beyond /api/metrics, add a `source` entry to DATA_SOURCES
 *      and handle the fetch in startPriceWidget() in helpers.ts.
 *   3. That's it — commands and persistence are automatic.
 */

// ---------------------------------------------------------------------------
// Data snapshot types (populated by widget fetchers in helpers.ts)
// ---------------------------------------------------------------------------

export interface MetricsData {
  vvvPrice: number;
  diemPrice: number;
  ethPrice: number;
  vvvPriceChange1h: number;
  vvvPriceChange4h: number;
  priceChange24h: number;
  vvvPriceChange7d: number;
  diemPriceChange1h: number;
  diemPriceChange4h: number;
  diemPriceChange24h: number;
  diemPriceChange7d: number;
  marketCap: number;
  stakingRatio: number;
  stakerApr: number;
  lockRatio: number;
  totalVvvStaked: number;
  mintRate: number;
  diemSupply: number;
  remainingMintable: number;
  diemStakeRatio: number;
  stakingGrowth7d: number;
  newStakers7dCount: number;
  cooldownVvv: number;
  cooldownWallets: number;
  cooldownCount: number;
  veniceRevenue: number;
  burnRevenueAnnualized: number;
  totalBurnedFromEvents: number;
  organicBurned: number;
  burnDeflationRate: number;
  emissionRate: number;
  netFlow7d: number;
  fdv: number;
  diemFdv: number;
}

export interface WalletData {
  label: string;
  role: string;
  sizeLabel: string;
  svvvBalance: number;
  vvvBalance: number;
  diemStaked: number;
  pendingRewards: number;
  rank: number;
  totalVenetians: number;
}

export interface SocialData {
  erikFollowers: number;
  sentimentUpPct: number;
  marketCapRank: number;
  diemMarketCapRank: number;
  socialVolume: number;
}

export interface MarketsData {
  volume: number;
  buyPct: number;
  traders: number;
  // 24h period changes (computed from current vs previous period)
  volumeChange: number | null;
  traderGrowth: number | null;
  swaps: number | null;
  swapGrowth: number | null;
  // top pool
  topPoolName: string | null;
  topPoolShare: number | null;
}

export interface BillingData {
  canConsume: boolean;
  consumptionCurrency: string | null;
  diemBalance: number | null;
  usdBalance: number | null;
  diemEpochAllocation: number;
}

export interface ChartsData {
  /** Price values in chronological order (LTTB-downsampled). */
  vvvPrices: number[];
  vvvTimestamps: number[];
  diemPrices: number[];
  diemTimestamps: number[];
  /** 7d cooldown wave series (VVV in cooldown queue at each timestamp). */
  cooldownWave: number[];
}

export interface WalletExposure {
  /** 8-level sparkline string (last 20 data points). */
  sparkline: string;
  /** Latest total exposure in USD. */
  currentExposure: number;
  /** Percentage change over the fetched period. */
  changePct: number;
  /** VVV in cooldown from the latest wallet-history point. */
  cooldownVvv: number;
}

export interface AllData {
  metrics: MetricsData | null;
  wallet: WalletData | null;
  walletAddr: string | undefined;
  social: SocialData | null;
  markets: MarketsData | null;
  billing: BillingData | null;
  charts: ChartsData | null;
  walletExposure: WalletExposure | null;
  flash: { vvv: "up" | "down" | null; diem: "up" | "down" | null };
}

// ---------------------------------------------------------------------------
// Thin theme duck-type (avoids importing the full Theme class)
// ---------------------------------------------------------------------------

export interface MiniTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function fmtUSD(n: number, decimals = 2): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(decimals)}`;
}

export function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Signed VVV amount: +286k, -1.2M, +42 */
export function fmtVVV(n: number): string {
  const sign = n >= 0 ? "+" : "";
  if (Math.abs(n) >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${sign}${(n / 1_000).toFixed(0)}k`;
  return `${sign}${Math.round(n)}`;
}

/** 4-significant-digit formatter with comma thousands separator.
 *  3300 → "3,300"  |  12345 → "12,345"  |  1023456 → "1.023M"
 */
export function fmtNum4(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Block-character gauge bar. ratio is 0–1, barWidth is char count. */
export function gauge(ratio: number, barWidth: number, theme: MiniTheme, color: string = "accent"): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled  = Math.round(clamped * barWidth);
  return theme.fg(color as any, "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
}

/** Arrow + percentage, e.g. ↑5.20% or ↓1.30% */
export function arrow(pct: number): string {
  return pct >= 0 ? `↑${pct.toFixed(2)}%` : `↓${Math.abs(pct).toFixed(2)}%`;
}

/** Compute a gauge bar width relative to the terminal width. */
export function gaugeWidth(termWidth: number, pct = 0.06): number {
  return Math.max(5, Math.min(12, Math.round(termWidth * pct)));
}

/** Thin-sample an array to at most `count` evenly-spaced values. */
function downsample(values: number[], count: number): number[] {
  if (values.length <= count) return values;
  const result: number[] = [];
  const step = (values.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) result.push(values[Math.round(i * step)]);
  return result;
}

const SPARK_BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * Convert an array of values into an 8-level block-character sparkline.
 * charCount controls how many characters wide the result is.
 * Returns empty string when values array is empty.
 */
export function sparkline(values: number[], charCount: number): string {
  if (values.length === 0) return "";
  const pts = downsample(values, charCount);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min;
  return pts.map(v => {
    const idx = range === 0 ? 3 : Math.round(((v - min) / range) * (SPARK_BLOCKS.length - 1));
    return SPARK_BLOCKS[idx];
  }).join("");
}


// ---------------------------------------------------------------------------
// Panel definition type
// ---------------------------------------------------------------------------

/**
 * Data source keys and their relative polling weights.
 * Higher weight = larger share of the 50 req/min budget.
 * These are used by helpers.ts to compute per-source intervals dynamically.
 */
// Source weights for venicestats.com only. Billing (venice.ai API) uses a
// separate timer with its own configurable interval.
export const SOURCE_WEIGHTS: Record<string, number> = {
  metrics: 10, // backbone — prices + all protocol KPIs
  markets:  2, // DEX aggregates
  wallet:   1, // Venetian wallet data (changes slowly)
  social: 0.5, // social signals (changes very slowly)
  charts: 0.3, // historical chart data for sparklines (rarely changes)
};

/** Default billing poll interval in seconds. */
export const BILLING_INTERVAL_DEFAULT = 60;
/** Minimum billing poll interval in seconds. */
export const BILLING_INTERVAL_MIN = 5;
/** Maximum billing poll interval in seconds. */
export const BILLING_INTERVAL_MAX = 600;

export interface PanelDef {
  id: string;
  label: string;
  /** One-line description shown in /venice-panels list */
  description: string;
  /**
   * All data sources this panel needs. Must be keys of SOURCE_WEIGHTS.
   * The widget uses this to compute which sources to poll and at what rate.
   */
  sources: Array<keyof typeof SOURCE_WEIGHTS>;
  /**
   * Render to a single terminal line. Return null to hide the row (e.g. data not
   * yet loaded). The sep helper produces the themed separator. width is the
   * terminal column count — use it for adaptive gauge widths etc.
   */
  render(data: AllData, theme: MiniTheme, sep: string, width: number): string | string[] | null;
}

// ---------------------------------------------------------------------------
// Venetian tier lookups (wallet panel)
// ---------------------------------------------------------------------------

export const SIZE_EMOJI: Record<string, string> = {
  Leviathan:  "🐉",
  Whale:      "🐋",
  Shark:      "🦈",
  Crocodile:  "🐊",
  Dolphin:    "🐬",
  Barracuda:  "🐟",
  Octopus:    "🐙",
  Squid:      "🦑",
  Crab:       "🦀",
  Pufferfish: "🐡",
  Shrimp:     "🦐",
  Plankton:   "🫧",
};

export const ROLE_COLOR: Record<string, string> = {
  Mercenary:  "error",    // red
  Gondolier:  "muted",    // lighter grey
  Glassblower:"accent",   // blue
  Merchant:   "syntaxType",  // teal — no true purple in the theme palette
  Patrician:  "warning",  // yellow
  Consul:     "warning",  // yellow
  Illuminati: "warning",  // yellow
};

// ---------------------------------------------------------------------------
// Panel registry — add new panels here
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clock overlay (not a panel — always rendered right-aligned on first row)
// ---------------------------------------------------------------------------

/**
 * Auto-detect the system timezone using Intl. Falls back to "UTC".
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Get a short timezone abbreviation (e.g. "EST", "PST", "CET").
 */
function getTzAbbr(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date());
    return parts.find(p => p.type === "timeZoneName")?.value ?? tz.split("/").pop() ?? "???";
  } catch {
    return tz.split("/").pop() ?? "???";
  }
}

export interface ClockParts {
  time: string;
  epoch: string;
  usd: string;
  diem: string;
}

export function renderClock(
  theme: MiniTheme,
  timezone: string,
  timeFormat: "24h" | "12h",
  billing?: BillingData | null,
): ClockParts {
  const now = new Date();
  const use12h = timeFormat === "12h";

  let timeStr: string;
  let tzAbbr: string;
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour12: use12h,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    };
    timeStr = now.toLocaleTimeString("en-US", options);
    tzAbbr = getTzAbbr(timezone);
  } catch {
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
    timeStr = use12h
      ? `${now.getUTCHours() % 12 || 12}:${mm}:${ss} ${now.getUTCHours() >= 12 ? "PM" : "AM"}`
      : `${hh}:${mm}:${ss}`;
    tzAbbr = "UTC";
  }

  const time = theme.fg("dim", tzAbbr + " ") + theme.fg("text", timeStr);

  if (!billing || (billing.diemBalance === null && billing.usdBalance === null)) {
    return { time, epoch: "", usd: "", diem: "" };
  }

  let epoch = "";
  if (billing.diemBalance !== null) {
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const diffMs = midnight.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
    const diffS = Math.floor((diffMs % 60_000) / 1_000);
    epoch = theme.fg("dim", "next epoch ") +
      theme.fg("accent", `${diffH}h ${String(diffM).padStart(2, "0")}m ${String(diffS).padStart(2, "0")}s`);
  }

  const diemRemaining = billing.diemBalance ?? 0;
  const diemDecimals =
    billing.diemEpochAllocation < 1  || diemRemaining < 1  ? 6 :
    billing.diemEpochAllocation < 10 || diemRemaining < 10 ? 4 :
    2;
  const fmtDiemVal = (n: number): string => n.toFixed(diemDecimals);
  const fmtUsdVal  = (n: number): string => n < 1 ? n.toFixed(4) : n.toFixed(2);

  let usd = "";
  if (billing.usdBalance !== null && billing.usdBalance >= 0.01) {
    usd = theme.fg("dim", "$") + theme.fg("text", fmtUsdVal(billing.usdBalance)) + theme.fg("dim", " USD");
  }

  let diem = "";
  if (billing.diemBalance !== null) {
    const remainingPct = billing.diemEpochAllocation > 0
      ? (billing.diemBalance / billing.diemEpochAllocation) * 100
      : 100;
    const usedDiem  = billing.diemEpochAllocation - billing.diemBalance;
    const diemColor = remainingPct < 10 ? "error" : "text";
    diem =
      theme.fg("dim", "DIEM ") +
      theme.fg(diemColor, fmtDiemVal(usedDiem)) +
      theme.fg("dim", "/") +
      theme.fg("text", fmtDiemVal(billing.diemEpochAllocation)) +
      theme.fg("dim", " used");
  }

  return { time, epoch, usd, diem };
}

export const PANEL_REGISTRY: Record<string, PanelDef> = {

  // ── prices ────────────────────────────────────────────────────────────────
  prices: {
    id: "prices",
    label: "Prices",
    description: "VVV + DIEM spot prices with 24h sparkline, market cap, and CoinGecko rank.",
    sources: ["metrics", "charts", "social"],
    render({ metrics, flash, charts }, theme, sep, _width) {
      if (!metrics) return null;
      const vvvColor  = flash.vvv  === "up" ? "success" : flash.vvv  === "down" ? "error" : "text";
      const diemColor = flash.diem === "up" ? "success" : flash.diem === "down" ? "error" : "text";
      const vvvChg    = metrics.priceChange24h     >= 0 ? "success" : "error";
      const diemChg   = metrics.diemPriceChange24h >= 0 ? "success" : "error";
      const D = theme.fg("dim", "│"); // sparkline box wall

      // Short fixed-width sparklines (12 chars) boxed with │...│
      const SPARK_W = 12;
      const vvvSpark  = charts?.vvvPrices.length
        ? " " + D + theme.fg(vvvChg,  sparkline(charts.vvvPrices,  SPARK_W)) + D
        : "";
      const diemSpark = charts?.diemPrices.length
        ? " " + D + theme.fg(diemChg, sparkline(charts.diemPrices, SPARK_W)) + D
        : "";

      const diemMCap = metrics.diemPrice * metrics.diemSupply;

      return (
        theme.fg("dim",    "VVV ")  +
        theme.fg(vvvColor, `$${metrics.vvvPrice.toFixed(4)}`) +
        theme.fg(vvvChg,   ` ${arrow(metrics.priceChange24h)}`) + theme.fg("dim", " 24h") +
        vvvSpark + theme.fg("dim", " MCap ") + theme.fg("text", fmtUSD(metrics.marketCap)) +
        sep +
        theme.fg("dim",     "DIEM ") +
        theme.fg(diemColor, `$${metrics.diemPrice.toFixed(2)}`) +
        theme.fg(diemChg,   ` ${arrow(metrics.diemPriceChange24h)}`) + theme.fg("dim", " 24h") +
        diemSpark + theme.fg("dim", " MCap ") + theme.fg("text", fmtUSD(diemMCap))
      );
    },
  },

  // ── protocol ─────────────────────────────────────────────────────────────
  protocol: {
    id: "protocol",
    label: "Protocol",
    description: "Market cap, staking ratio, staker APR, and sVVV lock ratio. (See 'staking' for cooldown data.)",
    sources: ["metrics"],
    render({ metrics }, theme, sep, width) {
      if (!metrics) return null;
      const gw = gaugeWidth(width);
      return (
        theme.fg("dim",  "MCap ")   + theme.fg("text", fmtUSD(metrics.marketCap)) +
        sep +
        theme.fg("dim",  "Staked ") + gauge(metrics.stakingRatio / 100, gw, theme) + theme.fg("text", ` ${metrics.stakingRatio.toFixed(1)}%`) +
        theme.fg("dim",  " @ ")     + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`) +
        sep +
        theme.fg("dim",  "Locked ") + gauge(metrics.lockRatio / 100, gw, theme, "syntaxType") + theme.fg("text", ` ${metrics.lockRatio.toFixed(1)}%`)
      );
    },
  },

  // ── wallet ────────────────────────────────────────────────────────────────
  wallet: {
    id: "wallet",
    label: "Wallet",
    description: "Your Venetian: sVVV balance, pending rewards, role, rank, and 7d exposure sparkline. Set address with /venice-wallet <0x…>.",
    sources: ["wallet"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ wallet, walletAddr, metrics }, theme, sep, _width) {
      if (!walletAddr) {
        return theme.fg("dim", "Wallet: /venice-wallet <0x…> or VENICE_WALLET=0x…");
      }
      if (!wallet) {
        return theme.fg("dim", `Loading ${fmtAddr(walletAddr)}…`);
      }
      const roleColor = ROLE_COLOR[wallet.role] ?? "dim";
      const emoji     = SIZE_EMOJI[wallet.sizeLabel] ?? "";
      const line1 =
        theme.fg("accent", wallet.label) +
        (wallet.role      ? theme.fg(roleColor, `  ${wallet.role}`)                              : "") +
        (wallet.sizeLabel ? theme.fg("dim",     ` ${wallet.sizeLabel}${emoji ? " " + emoji : ""}`) : "") +
        (metrics ? sep + theme.fg("dim", "Portfolio ") + theme.fg("text", fmtUSD(
          (wallet.svvvBalance + wallet.vvvBalance + wallet.pendingRewards) * metrics.vvvPrice
        )) : "") +
        sep +
        theme.fg("dim", "Rank #")  + theme.fg("text", String(wallet.rank)) +
        theme.fg("dim", `/${fmtK(wallet.totalVenetians)}`);
      const line2 =
        theme.fg("dim", " ⎿ ") +
        theme.fg("dim", "sVVV ")         + theme.fg("text", fmtNum4(wallet.svvvBalance)) +
        sep +
        theme.fg("dim", "Pending ")      + theme.fg("success", `${wallet.pendingRewards.toFixed(2)} VVV`);
      return [line1, line2];
    },
  },

  // ── diem ─────────────────────────────────────────────────────────────────
  diem: {
    id: "diem",
    label: "DIEM",
    description: "DIEM supply, daily mint rate, days until cap, and stake ratio.",
    sources: ["metrics"],
    render({ metrics }, theme, sep, width) {
      if (!metrics) return null;
      const gw = gaugeWidth(width, 0.05);
      return (
        theme.fg("dim",  "DIEM Supply ")    + theme.fg("text", fmtK(metrics.diemSupply)) +
        sep +
        theme.fg("dim",  "Mint Rate ")     + theme.fg("text", `${metrics.mintRate.toFixed(2)} sVVV`) +
        sep +
        theme.fg("dim",  "Remaining Mintable ") + theme.fg("text", fmtK(metrics.remainingMintable)) +
        sep +
        theme.fg("dim",  "Staked ") + gauge(metrics.diemStakeRatio, gw, theme) + theme.fg("text", ` ${(metrics.diemStakeRatio * 100).toFixed(1)}%`)
      );
    },
  },

  // ── staking ───────────────────────────────────────────────────────────────
  staking: {
    id: "staking",
    label: "Staking",
    description: "Staking + lock ratios with gauges, and cooldown wave sparkline with 7d trend.",
    sources: ["metrics", "charts"],
    render({ metrics, charts }, theme, sep, width) {
      if (!metrics) return null;
      const gw = gaugeWidth(width);

      const row1 =
        theme.fg("dim",  "Staked ") + gauge(metrics.stakingRatio / 100, gw, theme) +
        theme.fg("text", ` ${metrics.stakingRatio.toFixed(1)}%`) +
        theme.fg("dim",  " @ ")     + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`) +
        sep +
        theme.fg("dim",  "Locked ") + gauge(metrics.lockRatio / 100, gw, theme, "syntaxType") +
        theme.fg("text", ` ${metrics.lockRatio.toFixed(1)}%`);

      const wave   = charts?.cooldownWave ?? [];
      const waveChg = wave.length >= 2
        ? ((wave[wave.length - 1] - wave[0]) / wave[0]) * 100
        : 0;
      const waveDir = waveChg <= -2 ? "success" : waveChg >= 2 ? "error" : "text";
      const COOL_SPARK_W = 11;

      const row2 =
        theme.fg("dim", "Cooldown ") +
        (wave.length ? theme.fg(waveDir, sparkline(wave, COOL_SPARK_W)) + " " : "") +
        theme.fg("text", fmtK(metrics.cooldownVvv)) + theme.fg("dim", " VVV") +
        (wave.length >= 2 ? theme.fg(waveDir, ` ${arrow(waveChg)}`) + theme.fg("dim", " 7d") : "");

      return [row1, row2];
    },
  },

  // ── markets (24H MARKET) ──────────────────────────────────────────────────
  markets: {
    id: "markets",
    label: "24H Market",
    description: "24h DEX volume, traders, swaps with period changes, buy/sell ratio, net flow, top pool.",
    sources: ["markets", "metrics"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ markets, metrics }, theme, sep, width) {
      if (!markets) return null;

      const chg = (v: number | null, color = true): string => {
        if (v == null) return "";
        const c = v >= 0 ? "success" : "error";
        return color ? theme.fg(c, ` (${fmtPct(v)})`) : ` (${fmtPct(v)})`;
      };

      // ── Line 1: header + vol, traders, swaps ──
      const header = theme.fg("dim", "24H MARKET");
      const vol = theme.fg("dim", "Vol ") + theme.fg("text", fmtUSD(markets.volume)) + chg(markets.volumeChange);
      const traders = theme.fg("dim", "Traders ") + theme.fg("text", fmtNum4(markets.traders)) + chg(markets.traderGrowth);
      const swaps = markets.swaps != null
        ? theme.fg("dim", "Swaps ") + theme.fg("text", fmtK(markets.swaps)) + chg(markets.swapGrowth)
        : "";

      const line1Parts = [header, vol, traders];
      if (swaps && width >= 80) line1Parts.push(swaps);
      const line1 = line1Parts.join(sep);

      // ── Line 2: buy/sell, net flow, top pool ──
      const sellPct = 100 - markets.buyPct;
      const buyColor = markets.buyPct >= 50 ? "success" : "error";
      const buySell = theme.fg("dim", "Buy/Sell ") + theme.fg(buyColor, `${markets.buyPct}/${sellPct}%`);

      const netFlow = metrics?.netFlow7d != null
        ? theme.fg("dim", "Net Flow ") +
          theme.fg(metrics.netFlow7d >= 0 ? "success" : "error", `${fmtVVV(metrics.netFlow7d)} VVV`) +
          theme.fg("dim", " (7d)")
        : "";

      const pool = markets.topPoolName != null
        ? theme.fg("dim", "Top pool: ") +
          theme.fg("text", markets.topPoolName) +
          (markets.topPoolShare != null ? theme.fg("dim", ` (${markets.topPoolShare}%)`) : "")
        : "";

      const line2Parts = [buySell];
      if (netFlow) line2Parts.push(netFlow);
      if (pool && width >= 100) line2Parts.push(pool);
      const line2 = line2Parts.join(sep);

      return [line1, line2];
    },
  },

};

export const PANEL_IDS = Object.keys(PANEL_REGISTRY) as (keyof typeof PANEL_REGISTRY)[];
export const DEFAULT_PANELS: string[] = ["prices", "staking", "diem", "markets", "wallet"];
