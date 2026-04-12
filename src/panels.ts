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
  priceChange24h: number;
  diemPriceChange24h: number;
  marketCap: number;
  stakingRatio: number;
  stakerApr: number;
  lockRatio: number;
  mintRate: number;
  diemSupply: number;
  remainingMintable: number;
  diemStakeRatio: number;
  stakingGrowth7d: number;
  newStakers7dCount: number;
  cooldownVvv: number;
  veniceRevenue: number;
  burnRevenueAnnualized: number;
  totalBurnedFromEvents: number;
  organicBurned: number;
  burnDeflationRate: number;
  emissionRate: number;
}

export interface WalletData {
  label: string;
  role: string;
  sizeLabel: string;
  svvvBalance: number;
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
}

export interface BillingData {
  canConsume: boolean;
  consumptionCurrency: string | null;
  diemBalance: number | null;
  usdBalance: number | null;
  diemEpochAllocation: number;
}

export interface AllData {
  metrics: MetricsData | null;
  wallet: WalletData | null;
  walletAddr: string | undefined;
  social: SocialData | null;
  markets: MarketsData | null;
  billing: BillingData | null;
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
   * yet loaded). The sep helper produces the themed mid-dot separator.
   */
  render(data: AllData, theme: MiniTheme, sep: string): string | string[] | null;
}

// ---------------------------------------------------------------------------
// Venetian tier lookups (wallet panel)
// ---------------------------------------------------------------------------

const SIZE_EMOJI: Record<string, string> = {
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

const ROLE_COLOR: Record<string, string> = {
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

/**
 * Render the clock line that appears right-aligned on the top row of the widget.
 *
 * When billing data is present, shows:
 *   TZAbbrev HH:MM:SS  ·  allocation/balance DIEM  ·  reset Xh XXm XXs
 * When billing data is absent (no VENICE_ADMIN_API_KEY), shows just:
 *   TZAbbrev HH:MM:SS
 *
 * The DIEM reset countdown and balance segment are only shown when we actually
 * have billing data — they're irrelevant without a staking account.
 */
/**
 * Returns [row1, row2] where:
 *   row1 — time + "next epoch" countdown (always present)
 *   row2 — USD balance + DIEM balance (empty string when no billing data)
 */
export function renderClock(
  theme: MiniTheme,
  timezone: string,
  timeFormat: "24h" | "12h",
  billing?: BillingData | null,
): [string, string] {
  const now = new Date();
  const use12h = timeFormat === "12h";
  const sep = theme.fg("dim", "  ·  ");

  // Format current time in the user's chosen timezone
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
    // Invalid timezone — fall back to UTC
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
    timeStr = use12h
      ? `${now.getUTCHours() % 12 || 12}:${mm}:${ss} ${now.getUTCHours() >= 12 ? "PM" : "AM"}`
      : `${hh}:${mm}:${ss}`;
    tzAbbr = "UTC";
  }

  const timeSegment = theme.fg("dim", tzAbbr + " ") + theme.fg("text", timeStr);

  // No billing data — just the time on row 1, nothing on row 2
  if (!billing || (billing.diemBalance === null && billing.usdBalance === null)) {
    return [timeSegment, ""];
  }

  // Row 1: time  ·  next epoch Xh YYm ZZs
  const row1Parts: string[] = [timeSegment];
  if (billing.diemBalance !== null) {
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const diffMs = midnight.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
    const diffS = Math.floor((diffMs % 60_000) / 1_000);
    const epochStr = `${diffH}h ${String(diffM).padStart(2, "0")}m ${String(diffS).padStart(2, "0")}s`;
    row1Parts.push(theme.fg("dim", "next epoch ") + theme.fg("accent", epochStr));
  }

  // Precision is set by epoch allocation size, with a finer-grained trigger
  // when remaining balance drops below 1 DIEM regardless of allocation.
  const diemRemaining = billing.diemBalance ?? 0;
  const diemDecimals =
    billing.diemEpochAllocation < 1  || diemRemaining < 1  ? 6 :
    billing.diemEpochAllocation < 10 || diemRemaining < 10 ? 4 :
    2;
  const fmtDiem = (n: number): string => n.toFixed(diemDecimals);
  const fmtUsd = (n: number): string => n < 1 ? n.toFixed(4) : n.toFixed(2);

  // Row 2: $X.XX USD  ·  DIEM Balance X / Y used
  const row2Parts: string[] = [];
  if (billing.usdBalance !== null && billing.usdBalance >= 0.01) {
    row2Parts.push(
      theme.fg("dim", "$") + theme.fg("text", fmtUsd(billing.usdBalance)) +
      theme.fg("dim", " USD")
    );
  }
  if (billing.diemBalance !== null) {
    const remainingPct = billing.diemEpochAllocation > 0
      ? (billing.diemBalance / billing.diemEpochAllocation) * 100
      : 100;
    const usedDiem  = billing.diemEpochAllocation - billing.diemBalance;
    const diemColor = remainingPct < 10 ? "error" : "text";
    row2Parts.push(
      theme.fg("dim", "DIEM Balance ") +
      theme.fg(diemColor, fmtDiem(usedDiem)) +
      theme.fg("dim", " / ") +
      theme.fg("text", fmtDiem(billing.diemEpochAllocation)) +
      theme.fg("dim", " used")
    );
  }

  return [row1Parts.join(sep), row2Parts.join(sep)];
}

export const PANEL_REGISTRY: Record<string, PanelDef> = {

  // ── prices ────────────────────────────────────────────────────────────────
  prices: {
    id: "prices",
    label: "Prices",
    description: "VVV + DIEM spot prices with 24h % change and ETH. Prices flash green/red on tick.",
    sources: ["metrics"],
    render({ metrics, flash }, theme, sep) {
      if (!metrics) return null;
      const vvvColor  = flash.vvv  === "up" ? "success" : flash.vvv  === "down" ? "error" : "text";
      const diemColor = flash.diem === "up" ? "success" : flash.diem === "down" ? "error" : "text";
      const vvvChg    = metrics.priceChange24h  >= 0 ? "success" : "error";
      const diemChg   = metrics.diemPriceChange24h >= 0 ? "success" : "error";
      return (
        theme.fg("dim",    "VVV ")  +
        theme.fg(vvvColor, `$${metrics.vvvPrice.toFixed(4)}`) +
        theme.fg(vvvChg,   ` ${fmtPct(metrics.priceChange24h)} 24h`) +
        sep +
        theme.fg("dim",     "DIEM ") +
        theme.fg(diemColor, `$${metrics.diemPrice.toFixed(2)}`) +
        theme.fg(diemChg,   ` ${fmtPct(metrics.diemPriceChange24h)} 24h`) +
        sep +
        theme.fg("dim",  "ETH ") + theme.fg("text", `$${metrics.ethPrice.toFixed(2)}`)
      );
    },
  },

  // ── protocol ─────────────────────────────────────────────────────────────
  protocol: {
    id: "protocol",
    label: "Protocol",
    description: "Market cap, staking ratio, staker APR, and sVVV lock ratio.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "MCap ")   + theme.fg("text", fmtUSD(metrics.marketCap)) +
        sep +
        theme.fg("dim",  "Staked ") + theme.fg("text", `${metrics.stakingRatio.toFixed(1)}%`) +
        theme.fg("dim",  " @ ")     + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`) +
        sep +
        theme.fg("dim",  "Locked ") + theme.fg("text", `${metrics.lockRatio.toFixed(1)}%`)
      );
    },
  },

  // ── wallet ────────────────────────────────────────────────────────────────
  wallet: {
    id: "wallet",
    label: "Wallet",
    description: "Your Venetian: sVVV staked, DIEM staked, pending rewards, role and rank. Set address with /venice-wallet <0x…>.",
    sources: ["wallet"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ wallet, walletAddr, metrics }, theme, sep) {
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
        (metrics ? sep + theme.fg("dim", "Portfolio ") + theme.fg("text", fmtUSD(wallet.svvvBalance * metrics.vvvPrice)) : "") +
        sep +
        theme.fg("dim", "Rank #")  + theme.fg("text", String(wallet.rank)) +
        theme.fg("dim", `/${fmtK(wallet.totalVenetians)}`);
      const line2 =
        theme.fg("dim", " ⎿ ") +
        theme.fg("dim", "sVVV ")         + theme.fg("text", fmtNum4(wallet.svvvBalance)) +
        sep +
        theme.fg("dim", "DIEM staked ")  + theme.fg("text", wallet.diemStaked.toFixed(2)) +
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
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "DIEM Supply ")    + theme.fg("text", fmtK(metrics.diemSupply)) +
        sep +
        theme.fg("dim",  "Mint Rate ")     + theme.fg("text", `${metrics.mintRate.toFixed(2)} sVVV`) +
        sep +
        theme.fg("dim",  "Remaining Mintable ") + theme.fg("text", fmtK(metrics.remainingMintable)) +
        sep +
        theme.fg("dim",  "Staked ")        + theme.fg("text", `${(metrics.diemStakeRatio * 100).toFixed(1)}%`)
      );
    },
  },

  // ── social ────────────────────────────────────────────────────────────────
  social: {
    id: "social",
    label: "Social",
    description: "Erik Voorhees followers, CoinGecko sentiment %, VVV + DIEM market cap ranks.",
    sources: ["social"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ social }, theme, sep) {
      if (!social) return null;
      const sentColor = social.sentimentUpPct >= 50 ? "success" : "error";
      return (
        theme.fg("dim",      "Erik Voorhees ") + theme.fg("text", fmtK(social.erikFollowers)) +
        sep +
        theme.fg("dim",      "Sentiment ")  + theme.fg(sentColor, `${social.sentimentUpPct.toFixed(0)}% ↑`) +
        sep +
        theme.fg("dim",      "MCap #")      + theme.fg("text", String(social.marketCapRank)) +
        sep +
        theme.fg("dim",      "DIEM #")      + theme.fg("text", String(social.diemMarketCapRank))
      );
    },
  },

  // ── burns ─────────────────────────────────────────────────────────────────
  burns: {
    id: "burns",
    label: "Burns",
    description: "Total VVV burned, organic burn volume, and annual deflation rate.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "Burned ")   + theme.fg("text", fmtK(metrics.totalBurnedFromEvents) + " VVV") +
        sep +
        theme.fg("dim",  "Organic Burn ")  + theme.fg("text", fmtK(metrics.organicBurned) + " VVV") +
        sep +
        theme.fg("dim",  "Deflation ") + theme.fg("text", `${metrics.burnDeflationRate.toFixed(2)}%/yr`)
      );
    },
  },

  // ── staking ───────────────────────────────────────────────────────────────
  staking: {
    id: "staking",
    label: "Staking",
    description: "New stakers (7d), 7d staking growth, and VVV currently in cooldown.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      const growthColor = metrics.stakingGrowth7d >= 1 ? "success" : "error";
      const growthPct   = (metrics.stakingGrowth7d - 1) * 100;
      return (
        theme.fg("text", String(metrics.newStakers7dCount)) + theme.fg("dim", " New Stakers (7d)") +
        sep +
        theme.fg("dim",        "7d Growth ")      + theme.fg(growthColor, fmtPct(growthPct)) +
        sep +
        theme.fg("dim",        "Cooldown ")        + theme.fg("text", `${fmtK(metrics.cooldownVvv)} VVV`)
      );
    },
  },

  // ── markets ───────────────────────────────────────────────────────────────
  markets: {
    id: "markets",
    label: "Markets",
    description: "VVV DEX 24h trading volume, buy%, and unique traders.",
    sources: ["markets"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ markets }, theme, sep) {
      if (!markets) return null;
      const buyColor = markets.buyPct >= 50 ? "success" : "error";
      return (
        theme.fg("dim",   "Vol ")      + theme.fg("text", fmtUSD(markets.volume)) + theme.fg("dim", " 24h") +
        sep +
        theme.fg("dim",   "Buys ")     + theme.fg(buyColor, `${markets.buyPct}%`) +
        sep +
        theme.fg("dim",   "Traders ")  + theme.fg("text", fmtK(markets.traders))
      );
    },
  },

  // ── revenue ───────────────────────────────────────────────────────────────
  revenue: {
    id: "revenue",
    label: "Revenue",
    description: "Venice protocol revenue to date, annualized burn revenue, and VVV emission rate.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "Revenue ")    + theme.fg("text", fmtUSD(metrics.veniceRevenue)) +
        sep +
        theme.fg("dim",  "Ann. Revenue ") + theme.fg("text", fmtUSD(metrics.burnRevenueAnnualized)) +
        sep +
        theme.fg("dim",  "VVV Emission ") + theme.fg("text", `${(metrics.emissionRate * 100).toFixed(1)}%/yr`)
      );
    },
  },

};

export const PANEL_IDS = Object.keys(PANEL_REGISTRY) as (keyof typeof PANEL_REGISTRY)[];
export const DEFAULT_PANELS: string[] = ["prices", "protocol", "wallet"];
