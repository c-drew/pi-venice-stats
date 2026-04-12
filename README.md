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

## Default view

Two-column layout — protocol data on the left, system/balance/wallet on the right rail (40 chars):

```
 PRICES ──────────────────────────────────── │ SYSTEM ─────────────────────────────
 VVV $8.05 ▆█▅▃▂▃▃▁▂▂▃▃ ↓4.6% 24h           │ EDT 22:07:31  ·  next epoch 21h 52m
 MCap $368.6M Ranked #117  ·  DIEM …          │ BALANCE ────────────────────────────
 STAKING ─────────────────────────────────── │ $0.14 USD  ·  DIEM 0.00 / 4.96 used
 67.8% @ 18.2% APR  ·  +95 stakers 7d  …     │ WALLET ─────────────────────────────
 DIEM ────────────────────────────────────── │ 0x4486…80bc  Patrician Octopus 🐙
 Supply 10.5M  ·  Mint 1 sVVV  ·  …  78% ██░ │ Portfolio $26.2K  ·  Rank #466/14.4k
 24H MARKET ──────────────────────────────── │ sVVV 3,302  ·  Pending 0.20 VVV
 Vol $6.42M (+28.6%)  Traders 2,007 (+95%)    │ ▁▂▂▂▁▁▂▂▂▂▂▄▃▄▃▃▅▆▆█ $33.2K ↑78% 7d
 Buy/Sell 47/53%  Net Flow +286k  Top: …      │
```

- VVV and DIEM prices flash **green** on uptick and **red** on downtick
- 24h sparklines rendered with unicode block elements (`▁▂▃▄▅▆▇█`)
- MCap CoinGecko ranks shown next to market cap values
- 7-day wallet exposure sparkline with USD total and change %
- Width-adaptive: gracefully degrades on narrow terminals (< 80 cols stacks vertically)

## Clock overlay

Always right-aligned. When `VENICE_ADMIN_API_KEY` is set, billing info appears on two rows:

- **Row 1** — `TZAbbrev HH:MM:SS  ·  next epoch Xh YYm ZZs`
- **Row 2** — `$X.XX USD  ·  DIEM Balance X / Y used` (USD omitted when < $0.01; DIEM turns **red** below 10% remaining)

DIEM precision scales dynamically based on your epoch allocation and remaining balance — so small allocations and low balances always show meaningful digits:

| Allocation | Remaining | Decimal places |
|---|---|---|
| ≥ 10 DIEM | ≥ 10 DIEM | 2 — `0.44 / 100.00 used` |
| ≥ 10 DIEM | < 10 DIEM | 4 — `91.2345 / 100.0000 used` |
| < 10 DIEM | any | 4 — `0.4375 / 4.9615 used` |
| any | < 1 DIEM | 6 — `4.960500 / 4.961500 used` |
| < 1 DIEM | any | 6 |

USD shows 4 decimal places when below $1 (`$0.1426 USD`).

```bash
export VENICE_ADMIN_API_KEY="your-venice-admin-key"
```

**Time / timezone commands:**

```text
/venice-stats-tz                       ← show current (auto-detected)
/venice-stats-tz America/New_York      ← set IANA timezone
/venice-stats-tz reset                 ← restore auto-detection
/venice-stats-time-format 12h          ← 12-hour time (default is 24h)
/venice-stats-time-format 24h
/venice-stats-time-format reset
/venice-stats-billing-interval         ← show current (default 30s, range 5–600s)
/venice-stats-billing-interval 60      ← set new interval (takes effect on next tick)
/venice-stats-billing-interval reset
```

## Tracking your wallet

```bash
export VENICE_WALLET=0x<your-address>
```

Or set from inside the TUI (persisted across sessions):

```text
/venice-stats-wallet 0x<your-address>
/venice-stats-wallet          ← show current
/venice-stats-wallet clear    ← remove
```

## Dashboard panels

The layout is organized into left-column sections and a right rail. Panels can be toggled individually.

**List all panels:**
```text
/venice-stats-panels
```

**Add / remove / reorder:**
```text
/venice-stats-panel add <id>
/venice-stats-panel add all      ← enable every available panel
/venice-stats-panel remove <id>
/venice-stats-panel move <id> up
/venice-stats-panel move <id> down
/venice-stats-panel reset        ← restore defaults: prices, staking, diem, markets, wallet
```

**Available panels:**

| id | Label | What it shows | Data source |
|----|-------|---------------|-------------|
| `prices` | Prices | VVV + DIEM + ETH prices with sparklines, 24h % change, MCap with CoinGecko rank | `/api/metrics`, `/api/charts`, `/api/social` |
| `staking` | Staking | Staking ratio, APR, new stakers (7d), growth %, cooldown count | `/api/metrics` |
| `diem` | DIEM | Supply, mint rate, remaining mintable, staked gauge (all on one line) | `/api/metrics` |
| `markets` | 24H Market | Volume (+%), traders (+%), swaps (+%), buy/sell ratio, net flow, top pool | `/api/markets` |
| `wallet` | Wallet | Identity, portfolio USD, rank, sVVV, pending rewards, 7d exposure sparkline | `/api/venetians`, `/api/wallet-history` |

**Dynamic rate allocation** — targets a configurable budget (default **30 req/min**, range **1–59**), shared automatically across active data sources.

```text
/venice-stats-budget          ← show current budget
/venice-stats-budget 10       ← low-bandwidth mode
/venice-stats-budget 30       ← default
/venice-stats-budget 59       ← near-maximum
/venice-stats-budget reset    ← restore default (30)
```

> **Multi-session warning** — only the first `pi` session to start renders the widget. Others display an info notice and make no requests. If the owning session exited without releasing the lock, run `/venice-stats-widget claim` to take over.

## MCP integration

Pair this with the [`@venicestats/mcp-server`](https://www.npmjs.com/package/@venicestats/mcp-server) to give the Pi agent 18+ callable tools for deep protocol analytics — price history, staking, wallet intelligence, insider flow, tokenomics, and more.

**1. Install the MCP adapter:**

```bash
pi install npm:pi-mcp-adapter
```

**2. Add the venicestats server to `~/.pi/agent/mcp.json`:**

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

The `mcp` proxy tool handles discovery and routing — no extra setup needed.

## API endpoint reference

Detailed documentation for all 17+ venicestats.com API endpoints (field names, params, response shapes) is in [`src/VENICE_STATS_ENDPOINTS.md`](src/VENICE_STATS_ENDPOINTS.md).

## License

Apache-2.0
