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

```
VVV $7.9238  +5.2% 24h  ·  DIEM $1030.95  +9.1% 24h  ·  ETH $2214.67      EDT 22:07:31  ·  $0.14 USD  ·  DIEM Balance 0.00 / 4.96 used  ·  reset 21h 52m 28s
MCap $364.9M  ·  Staked 67.8% @ 18.2% APR  ·  Locked 25.9%
0x4486…80bc  Patrician Octopus 🐙  ·  Portfolio $26.2K  ·  Rank #466/14.4k
 - sVVV 3,302  ·  DIEM staked 4.96  ·  Pending 0.20 VVV
```

VVV and DIEM prices flash **green** on uptick and **red** on downtick.

## Clock overlay

Always right-aligned on the first row. When `VENICE_ADMIN_API_KEY` is set, also shows your Venice billing balance:

- **`$X.XX USD`** — USD balance (omitted when < $0.01)
- **`DIEM Balance X / Y used`** — consumed vs. epoch allocation. Turns **red** below 10% remaining.
- **`reset Xh YYm ZZs`** — countdown to midnight-UTC DIEM epoch reset.

```bash
export VENICE_ADMIN_API_KEY="your-venice-admin-key"
```

**Time / timezone commands:**

```text
/venice-tz                       ← show current (auto-detected)
/venice-tz America/New_York      ← set IANA timezone
/venice-tz reset                 ← restore auto-detection
/venice-time-format 12h          ← 12-hour time (default is 24h)
/venice-time-format 24h
/venice-time-format reset
/venice-billing-interval         ← show current (default 30s, range 5–600s)
/venice-billing-interval 60      ← set new interval (takes effect on next tick)
/venice-billing-interval reset
```

## Tracking your wallet

```bash
export VENICE_WALLET=0x<your-address>
```

Or set from inside the TUI (persisted across sessions):

```text
/venice-wallet 0x<your-address>
/venice-wallet          ← show current
/venice-wallet clear    ← remove
```

## Dashboard panels

Most panels are a single row; the wallet panel spans two rows.

**List all panels:**
```text
/venice-panels
```

**Add / remove / reorder:**
```text
/venice-panel add <id>
/venice-panel add all      ← enable every available panel
/venice-panel remove <id>
/venice-panel move <id> up
/venice-panel move <id> down
/venice-panel reset        ← restore defaults: prices, protocol, wallet
```

**Available panels:**

| id | Label | What it shows | Data source |
|----|-------|---------------|-------------|
| `prices` | Prices | VVV + DIEM + ETH spot prices with 24h % change. Prices flash on tick. | `/api/metrics` every 5s |
| `protocol` | Protocol | Market cap, staking ratio, APR, sVVV lock ratio | `/api/metrics` every 5s |
| `wallet` | Wallet | Row 1: identity (name, role, tier emoji), portfolio USD, rank. Row 2: sVVV, DIEM staked, pending rewards | `/api/venetians` every 60s |
| `diem` | DIEM | DIEM supply, mint rate (sVVV), remaining mintable supply, stake ratio | `/api/metrics` every 5s |
| `social` | Social | Erik Voorhees followers, CoinGecko sentiment %, VVV + DIEM market cap ranks | `/api/social` every 5m |
| `burns` | Burns | Total VVV burned, organic burn volume, annual deflation rate | `/api/metrics` every 5s |
| `staking` | Staking | New stakers (7d), 7-day staking growth, VVV in cooldown | `/api/metrics` every 5s |
| `markets` | Markets | VVV DEX 24h volume, buy %, unique trader count | `/api/markets` every 30s |
| `revenue` | Revenue | Venice protocol revenue to date, annualized burn revenue, emission rate | `/api/metrics` every 5s |

**Dynamic rate allocation** — targets a configurable budget (default **30 req/min**, range **1–59**), shared automatically across active data sources.

```text
/venice-budget          ← show current budget
/venice-budget 10       ← low-bandwidth mode
/venice-budget 30       ← default
/venice-budget 59       ← near-maximum
/venice-budget reset    ← restore default (30)
```

> **Multi-session warning** — only the first `pi` session to start renders the widget. Others display an info notice and make no requests. If the owning session exited without releasing the lock, run `/venice-widget claim` to take over.

## License

Apache-2.0
