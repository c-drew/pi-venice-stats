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

Two-column box-drawing grid — protocol data on the left, system/balance/wallet on the right rail:

```
┌──────────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│ VVV $8.07 ▇█▃▂▃▄▁▁▃▂▃▃ ↓4.2% 24h      DIEM $1060.79 …    │ SYSTEM                               │
│ MCap $371.8M · Ranked #117 · FDV $399M  MCap $40.1M …      │ EDT 17:25:14 · next epoch 2h 34m 45s │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ VVV STAKING                                                  │ BALANCE                              │
│ Staked ███████░░░ 67.7% @ 18.2% APR   Locked …   Cooldown … │ $0.1426 · DIEM 0.8061/4.9615 used    │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ DIEM ANALYTICS                                               │ WALLET                               │
│ DIEM Supply 37.8k   Mint Rate 665 sVVV   Rem …   Staked ██░ │ 0x4486…80bc Patrician Octopus 🐙      │
├──────────────────────────────────────────────────────────────┤ Portfolio $26.7K   Rank #465/14.5k   │
│ 24H MARKET                                                   │ ⎿ sVVV 3,303   Pending 0.12 VVV      │
│ Vol $5.0M ↓19.6%   Traders 1,683 ↑42%   Swaps 10.2k         │ PROTOCOL EXPOSURE                    │
│ Buy/Sell 48/52%   Net Flow +228k VVV (7d)   Top: VVV/WETH    │ ▁▂▂▂▁▁▂▂▂▂▂▄▃▄▃▃▅▆▆█  $31.9K ↑14% 30d │
└──────────────────────────────────────────────────────────────┴──────────────────────────────────────┘
```

- VVV and DIEM prices flash **green** on uptick and **red** on downtick
- Configurable sparkline periods: `1h`, `24h`, `7d`, `30d` for both prices and exposure
- MCap with CoinGecko rank and FDV (fully diluted valuation)
- **Portfolio** = `(sVVV + VVV + pending rewards + cooldown) × VVV price` — VVV-denominated holdings
- **Protocol Exposure** = portfolio + DIEM staked value — total protocol position, computed live
- Section headers in blue (`syntaxKeyword`), wallet address colored by venetian role
- Width-adaptive: gracefully degrades on narrow terminals (< 80 cols stacks vertically)

## Clock overlay

Shown in the SYSTEM and BALANCE sections of the right rail. When `VENICE_ADMIN_API_KEY` is set:

- **SYSTEM** — `TZAbbrev HH:MM:SS · next epoch Xh YYm ZZs`
- **BALANCE** — `$X.XX · DIEM X/Y used` (USD omitted when < $0.01; DIEM turns **red** below 10% remaining)

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

**Time settings:**

```text
/venice-stats-time                           ← show timezone + format
/venice-stats-time timezone America/New_York ← set IANA timezone
/venice-stats-time timezone reset            ← restore auto-detection
/venice-stats-time format 12h               ← 12-hour time (default is 24h)
/venice-stats-time format 24h
/venice-stats-time format reset
```

**Polling rates:**

```text
/venice-stats-polling                  ← show budget + billing interval
/venice-stats-polling budget 10        ← venicestats.com request budget (1–59 req/min, default 30)
/venice-stats-polling budget reset
/venice-stats-polling billing 60       ← venice.ai billing poll interval (5–600s, default 60)
/venice-stats-polling billing reset
```

**Sparkline periods:**

```text
/venice-stats-period                   ← show chart + exposure periods
/venice-stats-period chart 1h          ← 1-hour sparklines
/venice-stats-period chart 24h         ← 24-hour (default)
/venice-stats-period chart 7d          ← 7-day
/venice-stats-period chart 30d         ← 30-day
/venice-stats-period chart reset
/venice-stats-period exposure 1h       ← 1-hour
/venice-stats-period exposure 24h      ← 24-hour
/venice-stats-period exposure 7d       ← 7-day
/venice-stats-period exposure 30d      ← 30-day (default)
/venice-stats-period exposure reset
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

The layout is organized into left-column sections and a right rail. All panels are always active.

**Panels:**

| id | Label | What it shows | Data source |
|----|-------|---------------|-------------|
| `prices` | Prices | VVV + DIEM prices with sparklines, change %, MCap, CoinGecko rank, FDV | `/api/metrics`, `/api/charts`, `/api/social` |
| `staking` | VVV Staking | Staking ratio, APR, locked %, cooldown sparkline + count | `/api/metrics`, `/api/charts` |
| `diem` | DIEM Analytics | Supply, mint rate, remaining mintable, staked gauge | `/api/metrics` |
| `markets` | 24H Market | Volume, traders, swaps (with arrow change indicators), buy/sell, net flow, top pool | `/api/markets` |
| `wallet` | Wallet | Address, venetian name, portfolio (sVVV+VVV+rewards+cooldown), rank, protocol exposure sparkline | `/api/venetians`, `/api/wallet-history` |

**Dynamic rate allocation** — targets a configurable budget (default **30 req/min**, range **1–59**), shared automatically across active data sources. Configure via `/venice-stats-polling budget`.

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
