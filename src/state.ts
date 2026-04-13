import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATE_ENTRY_TYPE = "venice-stats-config";

export interface VeniceStatsConfig {
  walletAddress?: string;
  widgetPanels?: string[];
  widgetTimezone?: string;
  widgetTimeFormat?: "24h" | "12h";
  chartPeriod?: "1h" | "24h" | "7d" | "30d";
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
  const validChartPeriods = ["1h", "24h", "7d", "30d"];
  if (validChartPeriods.includes(latest.chartPeriod)) config.chartPeriod = latest.chartPeriod;
  const validExposurePeriods = ["1h", "24h", "7d", "30d"];
  if (validExposurePeriods.includes(latest.exposurePeriod)) config.exposurePeriod = latest.exposurePeriod;

  return config;
}
