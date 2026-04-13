import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATE_ENTRY_TYPE = "venice-stats-config";

export interface VeniceStatsConfig {
  walletAddress?: string;
  widgetPanels?: string[];
  widgetTimezone?: string;
  widgetTimeFormat?: "24h" | "12h";
  /** Token chart period (VVV + DIEM sparklines). Default: 24h. */
  tokenPeriod?: "1h" | "24h" | "7d" | "30d";
  /** Cooldown wave period. Default: 7d. */
  cooldownPeriod?: "24h" | "7d" | "30d";
  /** Protocol exposure period. Default: 30d. */
  exposurePeriod?: "1h" | "24h" | "7d" | "30d";
}

export function defaultConfig(): VeniceStatsConfig {
  return {};
}

export function persistConfig(pi: ExtensionAPI, config: VeniceStatsConfig): void {
  pi.appendEntry(STATE_ENTRY_TYPE, config);
}

export function loadConfig(ctx: ExtensionContext): VeniceStatsConfig {
  let latest: any;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE) {
      latest = entry.data;
    }
  }
  if (!latest || typeof latest !== "object") return defaultConfig();

  const config: VeniceStatsConfig = {};

  if (typeof latest.walletAddress === "string") config.walletAddress = latest.walletAddress;
  if (Array.isArray(latest.widgetPanels))        config.widgetPanels = latest.widgetPanels.filter((p: any) => typeof p === "string");
  if (typeof latest.widgetTimezone === "string") config.widgetTimezone = latest.widgetTimezone;
  if (latest.widgetTimeFormat === "12h" || latest.widgetTimeFormat === "24h") config.widgetTimeFormat = latest.widgetTimeFormat;
  const validTokenPeriods = ["1h", "24h", "7d", "30d"];
  const validCooldownPeriods = ["24h", "7d", "30d"];
  const validExposurePeriods = ["1h", "24h", "7d", "30d"];
  // tokenPeriod takes priority; fall back to old chartPeriod for backward compat
  if (validTokenPeriods.includes(latest.tokenPeriod)) config.tokenPeriod = latest.tokenPeriod;
  else if (validTokenPeriods.includes(latest.chartPeriod)) config.tokenPeriod = latest.chartPeriod;
  if (validCooldownPeriods.includes(latest.cooldownPeriod)) config.cooldownPeriod = latest.cooldownPeriod;
  if (validExposurePeriods.includes(latest.exposurePeriod)) config.exposurePeriod = latest.exposurePeriod;

  return config;
}
