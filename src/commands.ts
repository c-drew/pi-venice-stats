import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { detectTimezone, BILLING_INTERVAL_DEFAULT, BILLING_INTERVAL_MIN, BILLING_INTERVAL_MAX } from "./panels.ts";
import { tryClaimStaleWidgetLock, stopPriceWidget } from "./widget.ts";
import type { WidgetController } from "./widget.ts";
import { persistConfig } from "./state.ts";
import type { VeniceStatsConfig } from "./state.ts";

function notify(ctx: ExtensionContext, message: string, kind: "info" | "success" | "error" = "info") {
  if (!ctx.hasUI) return;
  ctx.ui.notify(message, kind === "success" ? "info" : kind);
}

export function registerVeniceStatsCommands(
  pi: ExtensionAPI,
  getConfig: () => VeniceStatsConfig,
  setConfig: (next: VeniceStatsConfig) => void,
  startWidget: (ctx: any) => void,
  getController?: () => WidgetController | null,
) {
  const save = (ctx: ExtensionContext, next: VeniceStatsConfig) => {
    setConfig(next);
    persistConfig(pi, next);
  };

  pi.registerCommand("venice-stats-wallet", {
    description: "Show or set your wallet address: /venice-stats-wallet [0x...] or /venice-stats-wallet clear",
    handler: async (args, ctx) => {
      const addr = (args ?? "").trim();

      if (!addr) {
        const current = getConfig().walletAddress ?? process.env["VENICE_WALLET"];
        notify(ctx, current ? `Wallet: ${current}` : "No wallet set. Use /venice-stats-wallet <0x...>", "info");
        return;
      }
      if (addr === "clear") {
        const { walletAddress: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, "Wallet cleared.", "info");
        return;
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        notify(ctx, "Invalid address \u2014 must be 0x followed by 40 hex chars.", "error");
        return;
      }
      save(ctx, { ...getConfig(), walletAddress: addr });
      notify(ctx, `Wallet set: ${addr}`, "success");
    },
  });

  // Polling is now health-driven for venicestats.com (automatic). Billing interval
  // is still configurable via /venice-stats-billing.
  pi.registerCommand("venice-stats-polling", {
    description: "Show current polling status (venicestats.com polls on data updates automatically)",
    handler: async (args, ctx) => {
      const bill = getConfig().billingInterval ?? BILLING_INTERVAL_DEFAULT;
      const billSrc = getConfig().billingInterval ? "(configured)" : "(default)";
      notify(ctx,
        `Polling: health-driven (venicestats.com checks every ~90s, fetches on data update)\n  Billing (venice.ai API): ${bill}s ${billSrc} (range: ${BILLING_INTERVAL_MIN}\u2013${BILLING_INTERVAL_MAX}s)\n\n` +
        `Usage:\n  /venice-stats-billing <${BILLING_INTERVAL_MIN}\u2013${BILLING_INTERVAL_MAX}|reset>  \u2014 venice.ai billing poll interval`,
        "info"
      );
    },
  });

  // venice.ai billing interval (formerly /venice-stats-polling billing)
  pi.registerCommand("venice-stats-billing", {
    description: "Set venice.ai billing balance poll interval in seconds",
    handler: async (args, ctx) => {
      const val = (args ?? "").trim();
      const current = getConfig().billingInterval ?? BILLING_INTERVAL_DEFAULT;
      if (!val) {
        const src = getConfig().billingInterval ? "(configured)" : "(default)";
        notify(ctx, `Billing interval: ${current}s ${src} (range: ${BILLING_INTERVAL_MIN}\u2013${BILLING_INTERVAL_MAX}s)`, "info");
        return;
      }
      if (val === "reset") {
        const { billingInterval: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Billing interval reset to default (${BILLING_INTERVAL_DEFAULT}s).`, "success");
        return;
      }
      const n = Number(val);
      if (!Number.isFinite(n) || n < BILLING_INTERVAL_MIN || n > BILLING_INTERVAL_MAX) {
        notify(ctx, `Invalid interval "${val}". Provide a number between ${BILLING_INTERVAL_MIN} and ${BILLING_INTERVAL_MAX} seconds.`, "error");
        return;
      }
      save(ctx, { ...getConfig(), billingInterval: Math.round(n) });
      notify(ctx, `Billing interval set to ${Math.round(n)}s (was ${current}s).`, "success");
    },
  });

  // Combined time command: /venice-stats-time timezone <tz> | format <12h|24h> | reset
  pi.registerCommand("venice-stats-time", {
    description: "Manage time settings: /venice-stats-time timezone <IANA|reset> | format <12h|24h|reset>",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();
      const val = parts[1]?.trim();
      const detected = detectTimezone();

      if (!sub) {
        const tz = getConfig().widgetTimezone ?? detected;
        const tzSrc = getConfig().widgetTimezone ? "(configured)" : "(auto-detected)";
        const fmt = getConfig().widgetTimeFormat ?? "24h";
        const fmtSrc = getConfig().widgetTimeFormat ? "(configured)" : "(default)";
        notify(ctx,
          `Time settings:\n  Timezone: ${tz} ${tzSrc}\n  Format: ${fmt} ${fmtSrc}\n\n` +
          `Usage:\n  /venice-stats-time timezone <IANA timezone|reset>\n  /venice-stats-time format <12h|24h|reset>`,
          "info"
        );
        return;
      }

      if (sub === "timezone" || sub === "tz") {
        const current = getConfig().widgetTimezone ?? detected;
        if (!val) {
          const src = getConfig().widgetTimezone ? "(configured)" : "(auto-detected)";
          notify(ctx, `Timezone: ${current} ${src}`, "info");
          return;
        }
        if (val === "reset") {
          const { widgetTimezone: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, `Timezone reset to auto-detected: ${detected}`, "success");
          return;
        }
        try {
          new Date().toLocaleString("en-US", { timeZone: val, timeZoneName: "short" });
        } catch {
          notify(ctx, `Invalid timezone "${val}". Use an IANA timezone like "America/New_York" or "UTC".`, "error");
          return;
        }
        save(ctx, { ...getConfig(), widgetTimezone: val });
        notify(ctx, `Timezone set to ${val} (was ${current})`, "success");
        return;
      }

      if (sub === "format" || sub === "fmt") {
        const current = getConfig().widgetTimeFormat ?? "24h";
        if (!val) {
          const src = getConfig().widgetTimeFormat ? "(configured)" : "(default)";
          notify(ctx, `Time format: ${current} ${src}`, "info");
          return;
        }
        if (val === "reset") {
          const { widgetTimeFormat: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, `Time format reset to default (24h).`, "success");
          return;
        }
        const v = val.toLowerCase();
        if (v !== "12h" && v !== "24h") {
          notify(ctx, `Invalid format "${val}". Use 12h or 24h.`, "error");
          return;
        }
        save(ctx, { ...getConfig(), widgetTimeFormat: v });
        notify(ctx, `Time format set to ${v} (was ${current})`, "success");
        return;
      }

      notify(ctx,
        `Usage:\n  /venice-stats-time timezone <IANA timezone|reset>\n  /venice-stats-time format <12h|24h|reset>`,
        "info"
      );
    },
  });

  // Combined period command: /venice-stats-period chart <1h|24h|7d|30d> | exposure <1h|24h|7d|30d> | reset
  pi.registerCommand("venice-stats-period", {
    description: "Manage sparkline periods: /venice-stats-period chart <1h|24h|7d|30d|reset> | exposure <1h|24h|7d|30d|reset>",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();
      const val = parts[1]?.toLowerCase();
      const validPeriods = ["1h", "24h", "7d", "30d"];

      if (!sub) {
        const chart = getConfig().chartPeriod ?? "24h";
        const chartSrc = getConfig().chartPeriod ? "(configured)" : "(default)";
        const exp = getConfig().exposurePeriod ?? "30d";
        const expSrc = getConfig().exposurePeriod ? "(configured)" : "(default)";
        notify(ctx,
          `Sparkline periods:\n  Chart: ${chart} ${chartSrc}\n  Exposure: ${exp} ${expSrc}\n\n` +
          `Usage:\n  /venice-stats-period chart <1h|24h|7d|30d|reset>\n  /venice-stats-period exposure <1h|24h|7d|30d|reset>`,
          "info"
        );
        return;
      }

      if (sub === "chart") {
        const current = getConfig().chartPeriod ?? "24h";
        if (!val) {
          const src = getConfig().chartPeriod ? "(configured)" : "(default)";
          notify(ctx, `Chart period: ${current} ${src}\nValid: ${validPeriods.join(", ")}`, "info");
          return;
        }
        if (val === "reset") {
          const { chartPeriod: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, `Chart period reset to default (24h).`, "success");
          getController?.()?.triggerChartsRefresh();
          return;
        }
        if (!validPeriods.includes(val)) {
          notify(ctx, `Invalid period "${val}". Use one of: ${validPeriods.join(", ")}`, "error");
          return;
        }
        save(ctx, { ...getConfig(), chartPeriod: val as any });
        getController?.()?.triggerChartsRefresh();
        notify(ctx, `Chart period set to ${val} (was ${current}). Refreshing\u2026`, "success");
        return;
      }

      if (sub === "exposure" || sub === "exp") {
        const current = getConfig().exposurePeriod ?? "30d";
        if (!val) {
          const src = getConfig().exposurePeriod ? "(configured)" : "(default)";
          notify(ctx, `Exposure period: ${current} ${src}\nValid: ${validPeriods.join(", ")}`, "info");
          return;
        }
        if (val === "reset") {
          const { exposurePeriod: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, `Exposure period reset to default (30d).`, "success");
          getController?.()?.triggerExposureRefresh();
          return;
        }
        if (!validPeriods.includes(val)) {
          notify(ctx, `Invalid period "${val}". Use one of: ${validPeriods.join(", ")}`, "error");
          return;
        }
        save(ctx, { ...getConfig(), exposurePeriod: val as any });
        getController?.()?.triggerExposureRefresh();
        notify(ctx, `Exposure period set to ${val} (was ${current}). Refreshing\u2026`, "success");
        return;
      }

      notify(ctx,
        `Usage:\n  /venice-stats-period chart <1h|24h|7d|30d|reset>\n  /venice-stats-period exposure <1h|24h|7d|30d|reset>`,
        "info"
      );
    },
  });

  pi.registerCommand("venice-stats-widget", {
    description: "Manage the stats widget lock: /venice-stats-widget claim \u2014 take over when the previous session is gone",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim();
      if (sub === "claim") {
        if (tryClaimStaleWidgetLock()) {
          stopPriceWidget(ctx);
          startWidget(ctx);
          notify(ctx, "Stats widget claimed \u2014 polling started in this session.", "success");
        } else {
          notify(ctx, "Another pi session is still running and holds the widget lock.\nClose it first, then run /venice-stats-widget claim again.", "error");
        }
        return;
      }
      notify(ctx,
        "Usage: /venice-stats-widget claim \u2014 force-take the widget lock when the previous session is gone.",
        "info"
      );
    },
  });
}
