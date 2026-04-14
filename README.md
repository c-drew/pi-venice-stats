# pi-venice-stats

> Live [Venice Protocol](https://venice.ai) stats dashboard for [Pi Coding Agent](https://pi.dev).

A Pi extension that renders a real-time stats widget below the editor, polling protocol KPIs, DEX data, social signals, and your wallet from [venicestats.com](https://venicestats.com).

## Quick start

```bash
pi install npm:pi-venice-stats
```

Or load directly:

```bash
pi -e npm:pi-venice-stats
```

Set your API keys before starting Pi:

```bash
export VENICE_ADMIN_API_KEY="your-venice-admin-key"  # Admin key required — Inference keys won't work
export VENICE_WALLET="0x<your-address>"               # wallet stats (or set via /venice-stats-wallet)
```

## Presets

Switch layouts with `/venice-stats-preset [off|usage|wallet|max]`. Default is `max`.

**`max`** — full two-column box-drawing grid:

```
┌──────────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│ VVV $8.07 ▁▃▅▇▅▃ ↓4.2% 24h         DIEM $1060.79 ▂▄▆▄ ↑1.2%  │ SYSTEM                               │
│ MCap $371.8M · Ranked #117 · FDV $399M   MCap $40.1M          │ EDT 17:25:14 · next epoch 2h 34m 45s │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ VVV STAKING                                                  │ BALANCE                              │
│ Staked 67.7% @ 18.2% APR   Locked 12.1%   Cooldown 1,234     │ $0.14 USD · DIEM 0.806/4.962 used    │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ DIEM ANALYTICS                                               │ WALLET                               │
│ DIEM Supply 37.8k   Mint Rate 665 sVVV   Staked 42.1%        │ 0x4486...80bc  Patrician Octopus     │
├──────────────────────────────────────────────────────────────┤ Portfolio $26.7K   Rank #465/14.5k   │
│ 24H MARKET                                                   │ ⎿ sVVV 3,303   Pending 0.12 VVV      │
│ Vol $5.0M ↓19.6%   Traders 1,683 ↑42%   Swaps 10.2k          │ PROTOCOL EXPOSURE                    │
│ Buy/Sell 48/52%   Net Flow +228k VVV (7d)   Top: VVV/WETH    │ ▁▂▃▄▅▆▇█ $31.9K ↑14% 30d             │
└──────────────────────────────────────────────────────────────┴──────────────────────────────────────┘
```

**`wallet`** — prices + compact wallet, 5-row grid:

```
┌──────────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│ VVV $8.07 ▁▃▅▇▅▃ ↓4.2% 24h         DIEM $1060.79 ▂▄▆▄ ↑1.2%  │ SYSTEM                               │
│ MCap $371.8M · Ranked #117 · FDV $399M   MCap $40.1M          │ EDT 17:25:14 · next epoch 2h 34m 45s │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ WALLET  0x4486...80bc  Patrician Octopus  Rank #465/14.5k    │ BALANCE                              │
│ ⎿ Portfolio $26.7K  sVVV 3,303  Pending 0.12 VVV             │ $0.14 USD · DIEM 0.806/4.962 used    │
└──────────────────────────────────────────────────────────────┴──────────────────────────────────────┘
```

**`usage`** — right-aligned clock + balance, no borders:

```
                                    EDT 17:25:14 · next epoch 2h 34m 45s
                                              $0.14 USD · DIEM 0.806/4.962 used
```

**`off`** — widget hidden entirely.

## Clock overlay

Shown in the SYSTEM and BALANCE sections. When `VENICE_ADMIN_API_KEY` is set:

- **SYSTEM** — `TZAbbrev HH:MM:SS · next epoch Xh YYm ZZs`
- **BALANCE** — `$X.XX USD · DIEM X/Y used` (turns **red** when exhausted)

DIEM precision scales dynamically:

| State | Decimal places | Example |
|---|---|---|
| Exhausted (balance = 0) | 2, all red | `DIEM 4.96/4.96 used` |
| allocation or remaining ≥ 1000 | 0 | `DIEM 1200/5000 used` |
| allocation or remaining ≥ 100 | 1 | `DIEM 123.4/500.0 used` |
| allocation or remaining ≥ 10 | 2 | `DIEM 8.12/10.00 used` |
| allocation or remaining < 10 (≥ 1) | 3 | `DIEM 0.812/4.961 used` |
| allocation or remaining < 1 | 4 | `DIEM 0.4375/0.9615 used` |

USD always shows 2 decimal places. When USD or DIEM balance rounds to zero, that value turns red.

## Tracking your wallet

```bash
export VENICE_WALLET=0x<your-address>
```

Or set from inside the TUI — persisted across sessions and package updates:

```text
/venice-stats-wallet 0x<your-address>
```

## Dashboard panels

| id | Label | What it shows | Data source |
|----|-------|---------------|-------------|
| `prices` | Prices | VVV + DIEM prices with sparklines, change %, MCap, CoinGecko rank, FDV | `/api/metrics`, `/api/charts`, `/api/social` |
| `staking` | VVV Staking | Staking ratio, APR, locked %, cooldown sparkline + count | `/api/metrics`, `/api/charts` |
| `diem` | DIEM Analytics | Supply, mint rate, remaining mintable, staked gauge | `/api/metrics` |
| `markets` | 24H Market | Volume, traders, swaps (with arrow change indicators), buy/sell, net flow, top pool | `/api/markets` |
| `wallet` | Wallet | Address, venetian name, portfolio (sVVV+VVV+rewards+cooldown), rank, protocol exposure sparkline | `/api/venetians`, `/api/wallet-history` |

**Health-driven polling** — polls `/api/health` every ~90 s and fetches a data source only when its pipeline has actually updated. Rate is naturally throttled by upstream update frequency.

> **Multi-session warning** — only the first `pi` session to start renders the widget. Others display an info notice and make no requests. If the widget isn't showing because a previous session didn't release the lock, restart Pi.

## Slash commands

See **[VENICE_STATS_COMMANDS.md](VENICE_STATS_COMMANDS.md)** for the full command reference (preset, wallet, time, sparkline periods).

## MCP integration

Pair this with the [`@venicestats/mcp-server`](https://www.npmjs.com/package/@venicestats/mcp-server) to give the Pi agent 18+ callable tools for deep protocol analytics — price history, staking, wallet intelligence, insider flow, tokenomics, and more.

**1. Install the MCP adapter:**

```bash
pi install npm:pi-mcp-adapter
```

**2. Add the venicestats server to your Pi config (`~/.pi/agent/mcp.json` or `$XDG_CONFIG_HOME/.pi/agent/mcp.json`):**

```json
{
  "mcpServers": {
    "venicestats": {
      "command": "npx",
      "args": ["-y", "@venicestats/mcp-server@latest"],
      "lifecycle": "eager"
    }
  }
}
```

Restart Pi. The agent can now answer questions like:

```
What's the current VVV price?
Who are the top 10 stakers?
Show me insider trading activity this week.
How has the staking ratio trended over 90 days?
```

## API endpoint reference

Detailed documentation for all 17+ venicestats.com API endpoints (field names, params, response shapes) is in [`src/VENICE_STATS_ENDPOINTS.md`](src/VENICE_STATS_ENDPOINTS.md).

## License

Apache-2.0
