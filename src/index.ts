import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_PANELS, detectTimezone } from "./panels.ts";
import { startPriceWidget, stopPriceWidget, tryAcquireWidgetLock, releaseWidgetLock } from "./widget.ts";
import { loadConfig, persistConfig, defaultConfig } from "./state.ts";
import { registerVeniceStatsCommands } from "./commands.ts";
import type { VeniceStatsConfig } from "./state.ts";

export default function (pi: ExtensionAPI) {
  let config: VeniceStatsConfig = defaultConfig();

  const getConfig = () => config;
  const setConfig = (next: VeniceStatsConfig) => { config = next; };

  const startWidget = (ctx: any) => {
    startPriceWidget(
      ctx,
      () => config.walletAddress ?? process.env["VENICE_WALLET"],
      () => config.widgetPanels ?? DEFAULT_PANELS,
      () => config.widgetBudget ?? 30,
      () => config.widgetTimezone ?? detectTimezone(),
      () => config.widgetTimeFormat ?? "24h",
      () => config.billingInterval ?? 30,
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

  pi.on("session_tree", async (_event, ctx) => {
    config = loadConfig(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    releaseWidgetLock();
    stopPriceWidget(ctx);
  });
}
