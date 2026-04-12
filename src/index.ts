import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_PANELS, detectTimezone, BILLING_INTERVAL_DEFAULT } from "./panels.ts";
import { startPriceWidget, stopPriceWidget, tryAcquireWidgetLock, releaseWidgetLock } from "./widget.ts";
import type { WidgetController } from "./widget.ts";
import { loadConfig, persistConfig, defaultConfig } from "./state.ts";
import { registerVeniceStatsCommands } from "./commands.ts";
import type { VeniceStatsConfig } from "./state.ts";

const AGENT_END_BILLING_DELAY_MS = 3_000;

export default function (pi: ExtensionAPI) {
  let config: VeniceStatsConfig = defaultConfig();
  let widgetController: WidgetController | null = null;

  const getConfig = () => config;
  const setConfig = (next: VeniceStatsConfig) => { config = next; };

  const startWidget = (ctx: any) => {
    widgetController = startPriceWidget(
      ctx,
      () => config.walletAddress ?? process.env["VENICE_WALLET"],
      () => config.widgetPanels ?? DEFAULT_PANELS,
      () => config.widgetBudget ?? 30,
      () => config.widgetTimezone ?? detectTimezone(),
      () => config.widgetTimeFormat ?? "24h",
      () => config.billingInterval ?? BILLING_INTERVAL_DEFAULT,
    );
  };

  registerVeniceStatsCommands(pi, getConfig, setConfig, startWidget);

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx);

    if (tryAcquireWidgetLock()) {
      startWidget(ctx);
    } else {
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Venice stats widget skipped — another pi session is already polling venicestats.com.\n" +
          "If that session is no longer running, use /venice-widget claim to take over.",
          "info",
        );
      }
    }
  });

  // After each agent loop completes, trigger an early billing refresh so the
  // balance updates promptly rather than waiting for the next scheduled tick.
  pi.on("agent_end", async () => {
    if (!widgetController) return;
    setTimeout(() => widgetController?.triggerBillingRefresh(), AGENT_END_BILLING_DELAY_MS);
  });

  pi.on("session_tree", async (_event, ctx) => {
    config = loadConfig(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    releaseWidgetLock();
    stopPriceWidget(ctx);
  });
}
