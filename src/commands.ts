import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PANEL_REGISTRY, PANEL_IDS, DEFAULT_PANELS, detectTimezone, BILLING_INTERVAL_DEFAULT, BILLING_INTERVAL_MIN, BILLING_INTERVAL_MAX } from "./panels.ts";
import { tryClaimStaleWidgetLock, stopPriceWidget } from "./widget.ts";
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
) {
  const save = (ctx: ExtensionContext, next: VeniceStatsConfig) => {
    setConfig(next);
    persistConfig(pi, next);
  };

  pi.registerCommand("venice-stats-panels", {
    description: "List all available dashboard panels with their descriptions and enabled status.",
    handler: async (_args, ctx) => {
      const enabled = getConfig().widgetPanels ?? DEFAULT_PANELS;
      const lines = PANEL_IDS.map((id) => {
        const panel = PANEL_REGISTRY[id];
        const idx   = enabled.indexOf(id);
        const status = idx >= 0 ? `[${idx + 1}] enabled` : "disabled";
        return `${status.padEnd(12)} ${panel.id.padEnd(12)} ${panel.label.padEnd(10)}  ${panel.description}`;
      });
      notify(ctx,
        `Venice dashboard panels\n\nUse /venice-stats-panel add|remove|move|reset to configure.\n\n` +
        lines.join("\n"),
        "info"
      );
    },
  });

  pi.registerCommand("venice-stats-panel", {
    description: "Manage dashboard panels: add <id> | remove <id> | move <id> up|down | reset",
    handler: async (args, ctx) => {
      const parts   = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const action  = parts[0];
      const current = [...(getConfig().widgetPanels ?? DEFAULT_PANELS)];

      const commit = (panels: string[]) => save(ctx, { ...getConfig(), widgetPanels: panels });

      if (action === "reset") {
        commit([...DEFAULT_PANELS]);
        notify(ctx, `Dashboard reset to defaults: ${DEFAULT_PANELS.join(", ")}`, "success");
        return;
      }

      if (action === "add") {
        const id = parts[1];
        if (id === "all") {
          const next = [...current, ...PANEL_IDS.filter(p => !current.includes(p))];
          commit(next);
          notify(ctx, `All panels enabled. Dashboard: ${next.join(", ")}`, "success");
          return;
        }
        if (!id || !PANEL_REGISTRY[id]) {
          notify(ctx, `Unknown panel "${id ?? ""}". Run /venice-stats-panels to see available panels.`, "error");
          return;
        }
        if (current.includes(id)) {
          notify(ctx, `Panel "${id}" is already enabled.`, "info");
          return;
        }
        commit([...current, id]);
        notify(ctx, `Panel "${id}" added. Dashboard: ${[...current, id].join(", ")}`, "success");
        return;
      }

      if (action === "remove") {
        const id = parts[1];
        if (!id || !current.includes(id)) {
          notify(ctx, `Panel "${id ?? ""}" is not enabled.`, "error");
          return;
        }
        const next = current.filter((p) => p !== id);
        commit(next);
        notify(ctx, `Panel "${id}" removed. Dashboard: ${next.join(", ") || "(empty)"}`, "success");
        return;
      }

      if (action === "move") {
        const id  = parts[1];
        const dir = parts[2];
        const idx = current.indexOf(id);
        if (!id || idx < 0) {
          notify(ctx, `Panel "${id ?? ""}" is not enabled.`, "error");
          return;
        }
        if (dir !== "up" && dir !== "down") {
          notify(ctx, `Usage: /venice-stats-panel move <id> up|down`, "error");
          return;
        }
        const next = [...current];
        const swap = dir === "up" ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= next.length) {
          notify(ctx, `"${id}" is already at the ${dir === "up" ? "top" : "bottom"}.`, "info");
          return;
        }
        [next[idx], next[swap]] = [next[swap], next[idx]];
        commit(next);
        notify(ctx, `Moved "${id}" ${dir}. Dashboard: ${next.join(", ")}`, "success");
        return;
      }

      notify(ctx,
        `Usage: /venice-stats-panel add <id> | remove <id> | move <id> up|down | reset\nRun /venice-stats-panels to see all panels.`,
        "info"
      );
    },
  });

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
        notify(ctx, "Invalid address — must be 0x followed by 40 hex chars.", "error");
        return;
      }
      save(ctx, { ...getConfig(), walletAddress: addr });
      notify(ctx, `Wallet set: ${addr}`, "success");
    },
  });

  pi.registerCommand("venice-stats-budget", {
    description: "Show or set the stats polling budget (1–59 req/min, default 30): /venice-stats-budget [1-59|reset]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      const BUDGET_DEFAULT = 30;
      const BUDGET_MIN = 1;
      const BUDGET_MAX = 59;

      if (!raw) {
        const current = getConfig().widgetBudget ?? BUDGET_DEFAULT;
        notify(ctx, `Stats widget polling budget: ${current} req/min (range: ${BUDGET_MIN}–${BUDGET_MAX}, default: ${BUDGET_DEFAULT})`, "info");
        return;
      }
      if (raw === "reset") {
        const { widgetBudget: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Polling budget reset to default (${BUDGET_DEFAULT} req/min).`, "success");
        return;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < BUDGET_MIN || n > BUDGET_MAX) {
        notify(ctx, `Invalid budget "${raw}". Provide a whole number between ${BUDGET_MIN} and ${BUDGET_MAX}.`, "error");
        return;
      }
      save(ctx, { ...getConfig(), widgetBudget: n });
      notify(ctx, `Polling budget set to ${n} req/min. Takes effect on the next tick.`, "success");
    },
  });

  pi.registerCommand("venice-stats-tz", {
    description: "Show or set the widget timezone (auto-detected by default): /venice-stats-tz [timezone|reset]",
    handler: async (args, ctx) => {
      const raw      = (args ?? "").trim();
      const detected = detectTimezone();
      const current  = getConfig().widgetTimezone ?? detected;

      if (!raw) {
        const source    = getConfig().widgetTimezone ? "(configured)" : "(auto-detected)";
        const available = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : undefined;
        let msg = `Widget timezone: ${current} ${source}`;
        if (available) msg += `\nAuto-detected: ${detected}`;
        msg += `\n\nUsage: /venice-stats-tz <IANA timezone> to set, /venice-stats-tz reset to clear.`;
        notify(ctx, msg, "info");
        return;
      }
      if (raw === "reset") {
        const { widgetTimezone: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Timezone reset to auto-detected: ${detected}`, "success");
        return;
      }
      try {
        new Date().toLocaleString("en-US", { timeZone: raw, timeZoneName: "short" });
      } catch {
        notify(ctx, `Invalid timezone "${raw}". Use an IANA timezone like "America/New_York" or "UTC".`, "error");
        return;
      }
      save(ctx, { ...getConfig(), widgetTimezone: raw });
      notify(ctx, `Widget timezone set to ${raw} (was ${current})`, "success");
    },
  });

  pi.registerCommand("venice-stats-time-format", {
    description: "Show or set the widget time format (24h or 12h, default 24h): /venice-stats-time-format [24h|12h|reset]",
    handler: async (args, ctx) => {
      const raw     = (args ?? "").trim().toLowerCase();
      const current = getConfig().widgetTimeFormat ?? "24h";

      if (!raw) {
        const source = getConfig().widgetTimeFormat ? "(configured)" : "(default)";
        notify(ctx, `Widget time format: ${current} ${source}\nUsage: /venice-stats-time-format 12h or /venice-stats-time-format 24h or /venice-stats-time-format reset`, "info");
        return;
      }
      if (raw === "reset") {
        const { widgetTimeFormat: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Time format reset to default (24h).`, "success");
        return;
      }
      if (raw !== "12h" && raw !== "24h") {
        notify(ctx, `Invalid format "${raw}". Use 12h or 24h.`, "error");
        return;
      }
      save(ctx, { ...getConfig(), widgetTimeFormat: raw });
      notify(ctx, `Time format set to ${raw} (was ${current})`, "success");
    },
  });

  pi.registerCommand("venice-stats-billing-interval", {
    description: `Show or set the billing poll interval in seconds (${BILLING_INTERVAL_MIN}–${BILLING_INTERVAL_MAX}, default ${BILLING_INTERVAL_DEFAULT}): /venice-stats-billing-interval [N|reset]`,
    handler: async (args, ctx) => {
      const raw     = (args ?? "").trim();
      const current = getConfig().billingInterval ?? BILLING_INTERVAL_DEFAULT;

      if (!raw) {
        const source = getConfig().billingInterval ? "(configured)" : "(default)";
        notify(ctx, `Billing poll interval: ${current}s ${source}\nUsage: /venice-stats-billing-interval <${BILLING_INTERVAL_MIN}-${BILLING_INTERVAL_MAX}> or /venice-stats-billing-interval reset`, "info");
        return;
      }
      if (raw === "reset") {
        const { billingInterval: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Billing poll interval reset to default (${BILLING_INTERVAL_DEFAULT}s).`, "success");
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < BILLING_INTERVAL_MIN || n > BILLING_INTERVAL_MAX) {
        notify(ctx, `Invalid interval "${raw}". Provide a number between ${BILLING_INTERVAL_MIN} and ${BILLING_INTERVAL_MAX} seconds.`, "error");
        return;
      }
      save(ctx, { ...getConfig(), billingInterval: Math.round(n) });
      notify(ctx, `Billing poll interval set to ${Math.round(n)}s (was ${current}s). Takes effect on the next tick.`, "success");
    },
  });

  pi.registerCommand("venice-stats-chart-period", {
    description: "Show or set the price sparkline period (1h, 24h, 7d, 30d, default 24h): /venice-stats-chart-period [period|reset]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim().toLowerCase();
      const valid = ["1h", "24h", "7d", "30d"] as const;
      const current = getConfig().chartPeriod ?? "24h";

      if (!raw) {
        const source = getConfig().chartPeriod ? "(configured)" : "(default)";
        notify(ctx, `Chart period: ${current} ${source}\nValid: ${valid.join(", ")}`, "info");
        return;
      }
      if (raw === "reset") {
        const { chartPeriod: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Chart period reset to default (24h).`, "success");
        return;
      }
      if (!valid.includes(raw as any)) {
        notify(ctx, `Invalid period "${raw}". Use one of: ${valid.join(", ")}`, "error");
        return;
      }
      save(ctx, { ...getConfig(), chartPeriod: raw as typeof valid[number] });
      notify(ctx, `Chart period set to ${raw} (was ${current}). Takes effect on the next tick.`, "success");
    },
  });

  pi.registerCommand("venice-stats-exposure-period", {
    description: "Show or set the wallet exposure sparkline period (1h, 24h, 7d, 30d, default 30d): /venice-stats-exposure-period [period|reset]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim().toLowerCase();
      const valid = ["1h", "24h", "7d", "30d"] as const;
      const current = getConfig().exposurePeriod ?? "30d";

      if (!raw) {
        const source = getConfig().exposurePeriod ? "(configured)" : "(default)";
        notify(ctx, `Exposure period: ${current} ${source}\nValid: ${valid.join(", ")}`, "info");
        return;
      }
      if (raw === "reset") {
        const { exposurePeriod: _, ...rest } = getConfig();
        save(ctx, rest);
        notify(ctx, `Exposure period reset to default (1d).`, "success");
        return;
      }
      if (!valid.includes(raw as any)) {
        notify(ctx, `Invalid period "${raw}". Use one of: ${valid.join(", ")}`, "error");
        return;
      }
      save(ctx, { ...getConfig(), exposurePeriod: raw as typeof valid[number] });
      notify(ctx, `Exposure period set to ${raw} (was ${current}). Takes effect on the next tick.`, "success");
    },
  });

  pi.registerCommand("venice-stats-widget", {
    description: "Manage the stats widget lock: /venice-stats-widget claim — take over when the previous session is gone",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim();
      if (sub === "claim") {
        if (tryClaimStaleWidgetLock()) {
          stopPriceWidget(ctx);
          startWidget(ctx);
          notify(ctx, "Stats widget claimed — polling started in this session.", "success");
        } else {
          notify(ctx, "Another pi session is still running and holds the widget lock.\nClose it first, then run /venice-stats-widget claim again.", "error");
        }
        return;
      }
      notify(ctx,
        "Usage: /venice-stats-widget claim — force-take the widget lock when the previous session is gone.",
        "info"
      );
    },
  });
}
