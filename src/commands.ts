import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { detectTimezone } from "./panels.ts";
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

  // Polling status + venice.ai billing info
  pi.registerCommand("venice-stats-health", {
    description: "Show polling status for venicestats.com and venice.ai billing",
    handler: async (args, ctx) => {
      const adminKey = process.env["VENICE_ADMIN_API_KEY"];
      if (!adminKey) {
        notify(ctx,
          `Polling: health-driven (venicestats.com checks every ~90s, fetches on data update)\n\n` +
          `Billing: VENICE_ADMIN_API_KEY not set \u2014 no balance tracking`,
          "info"
        );
        return;
      }
      notify(ctx,
        `Polling: health-driven (venicestats.com checks every ~90s, fetches on data update)\n\n` +
        `Billing: venice.ai /billing/balance\n  \u2022 Rate: 1 req/min max\n  \u2022 Also refreshes after each agent loop completes\n  \u2022 Endpoint: https://api.venice.ai/api/v1/billing/balance\n  \u2022 Last hit: shown on widget clock (US$ + DIEM balance)`,
        "info"
      );
    },
  });

  // Period command: /venice-stats-period [token|cooldown|exposure [<period>|reset]
  pi.registerCommand("venice-stats-period", {
    description: "Manage sparkline periods: /venice-stats-period [token|cooldown|exposure [<period>|reset]]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();
      const val = parts[1]?.toLowerCase();

      const validTokenPeriods     = ["1h", "24h", "7d", "30d"];
      const validCooldownPeriods   = ["24h", "7d", "30d"];
      const validExposurePeriods  = ["1h", "24h", "7d", "30d"];

      if (!sub) {
        // Show all periods
        const token = getConfig().tokenPeriod ?? "24h";
        const cool  = getConfig().cooldownPeriod ?? "7d";
        const exp   = getConfig().exposurePeriod ?? "30d";
        notify(ctx,
          `Sparkline periods:\n  Token:     ${token}\n  Cooldown: ${cool}\n  Exposure: ${exp}\n\n` +
          `Usage:\n  /venice-stats-period reset\n  /venice-stats-period token <1h|24h|7d|30d|reset>\n  /venice-stats-period cooldown <24h|7d|30d|reset>\n  /venice-stats-period exposure <1h|24h|7d|30d|reset>`,
          "info"
        );
        return;
      }

      if (sub === "reset") {
        const { tokenPeriod: _t, cooldownPeriod: _c, exposurePeriod: _e, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, "All sparkline periods reset to defaults (token 24h, cooldown 7d, exposure 30d).", "success");
        getController?.()?.triggerTokenRefresh();
        getController?.()?.triggerCooldownRefresh();
        getController?.()?.triggerExposureRefresh();
        return;
      }

      if (sub === "token") {
        const current = getConfig().tokenPeriod ?? "24h";
        if (!val) {
          notify(ctx, `Token period: ${current}\nValid: ${validTokenPeriods.join(", ")}`, "info");
          return;
        }
        if (val === "reset") {
          const { tokenPeriod: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, "Token period reset to default (24h).", "success");
          getController?.()?.triggerTokenRefresh();
          return;
        }
        if (!validTokenPeriods.includes(val)) {
          notify(ctx, `Invalid token period "${val}". Use one of: ${validTokenPeriods.join(", ")}`, "error");
          return;
        }
        save(ctx, { ...getConfig(), tokenPeriod: val as any });
        getController?.()?.triggerTokenRefresh();
        notify(ctx, `Token period set to ${val}. Refreshing\u2026`, "success");
        return;
      }

      if (sub === "cooldown") {
        const current = getConfig().cooldownPeriod ?? "7d";
        if (!val) {
          notify(ctx, `Cooldown period: ${current}\nValid: ${validCooldownPeriods.join(", ")}`, "info");
          return;
        }
        if (val === "reset") {
          const { cooldownPeriod: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, "Cooldown period reset to default (7d).", "success");
          getController?.()?.triggerCooldownRefresh();
          return;
        }
        if (!validCooldownPeriods.includes(val)) {
          notify(ctx, `Invalid cooldown period "${val}". Use one of: ${validCooldownPeriods.join(", ")}`, "error");
          return;
        }
        save(ctx, { ...getConfig(), cooldownPeriod: val as any });
        getController?.()?.triggerCooldownRefresh();
        notify(ctx, `Cooldown period set to ${val}. Refreshing\u2026`, "success");
        return;
      }

      if (sub === "exposure") {
        const current = getConfig().exposurePeriod ?? "30d";
        if (!val) {
          notify(ctx, `Exposure period: ${current}\nValid: ${validExposurePeriods.join(", ")}`, "info");
          return;
        }
        if (val === "reset") {
          const { exposurePeriod: _, ...rest } = getConfig();
          save(ctx, rest);
          notify(ctx, "Exposure period reset to default (30d).", "success");
          getController?.()?.triggerExposureRefresh();
          return;
        }
        if (!validExposurePeriods.includes(val)) {
          notify(ctx, `Invalid exposure period "${val}". Use one of: ${validExposurePeriods.join(", ")}`, "error");
          return;
        }
        save(ctx, { ...getConfig(), exposurePeriod: val as any });
        getController?.()?.triggerExposureRefresh();
        notify(ctx, `Exposure period set to ${val}. Refreshing\u2026`, "success");
        return;
      }

      notify(ctx,
        `Usage:\n  /venice-stats-period token <1h|24h|7d|30d|reset>\n  /venice-stats-period cooldown <24h|7d|30d|reset>\n  /venice-stats-period exposure <1h|24h|7d|30d|reset>`,
        "info"
      );
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
