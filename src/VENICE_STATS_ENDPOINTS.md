# venicestats.com API Reference

> **Base URL** `https://venicestats.com/api/`
> **Auth** None required
> **Format** JSON
> **Rate Limit** 60 requests/min per IP

---

## Core Metrics

### GET `/api/metrics`

60+ protocol KPIs updated every ~60s. Single flat object.

#### VVV Price & Market

| Field | Type | Description |
|-------|------|-------------|
| `vvvPrice` | number | Current VVV spot price (USD) |
| `vvvPriceChange1h` | number | % change over 1 hour |
| `vvvPriceChange4h` | number | % change over 4 hours |
| `priceChange24h` | number | % change over 24 hours |
| `vvvPriceChange7d` | number | % change over 7 days |
| `ethPrice` | number | Current ETH price (USD) |
| `marketCap` | number | VVV market cap (USD, circulating) |
| `fdv` | number | Fully diluted valuation (USD) |
| `totalSupply` | number | Total VVV supply |
| `circulatingSupply` | number | Circulating VVV supply |
| `peRatio` | number | Price-to-earnings ratio |
| `priceStale` | boolean | Whether the price feed is stale |
| `priceLastUpdated` | string | ISO timestamp of last price update |
| `lastUpdated` | string | ISO timestamp of last metrics update |

#### DIEM Price & Market

| Field | Type | Description |
|-------|------|-------------|
| `diemPrice` | number | Current DIEM spot price (USD) |
| `diemPriceChange1h` | number | % change over 1 hour |
| `diemPriceChange4h` | number | % change over 4 hours |
| `diemPriceChange24h` | number | % change over 24 hours |
| `diemPriceChange7d` | number | % change over 7 days |
| `diemMarketCap` | number | DIEM market cap (USD) |
| `diemFdv` | number | DIEM fully diluted valuation |

#### Staking

| Field | Type | Description |
|-------|------|-------------|
| `stakingRatio` | number | Ratio of VVV staked (0–1, multiply by 100 for %) |
| `stakingRatioChange24h` | number | 24h change in staking ratio |
| `stakerApr` | number | Current staker APR (%) |
| `totalStaked` | number | Total VVV staked (= sVVV supply) |
| `svvvSupply` | number | Total sVVV supply |
| `svvvLocked` | number | sVVV in locked positions |
| `svvvUnlocked` | number | sVVV in unlocked positions |
| `lockRatio` | number | Ratio of sVVV locked (0–1) |
| `stakingGrowth7d` | number | % staking growth over 7 days |
| `stakingGrowth30d` | number | % staking growth over 30 days |
| `newStakers7dCount` | number | New stakers in last 7 days |
| `netFlow7d` | number | Net VVV flow into staking (7d) |
| `activeWallets7dCount` | number | Active wallets in last 7 days |
| `ecosystemTvl` | number | Total value locked in ecosystem (USD) |

#### Cooldown

| Field | Type | Description |
|-------|------|-------------|
| `cooldownVvv` | number | VVV currently in cooldown queue |
| `cooldownWallets` | number | Wallets with active cooldowns |
| `cooldownCount` | number | Total active cooldown positions |

#### DIEM Tokenomics

| Field | Type | Description |
|-------|------|-------------|
| `diemSupply` | number | Current DIEM supply |
| `diemSupplyChange24h` | number | 24h change in DIEM supply |
| `diemStaked` | number | Total DIEM staked |
| `diemStakedChange24h` | number | 24h change in DIEM staked |
| `diemStakeRatio` | number | Ratio of DIEM staked (0–1) |
| `diemTotalMinted` | number | All-time DIEM minted |
| `diemMintCount` | number | Total mint events |
| `diemTotalBurned` | number | All-time DIEM burned |
| `diemBurnCount` | number | Total burn events |
| `diemVelocityPerDay` | number | DIEM velocity (turnover per day) |
| `diemNetworkValue` | number | DIEM network value (USD) |
| `diemBreakEvenDays` | number | Days to break even on DIEM minting |
| `daysUntilDiemCap` | number | Estimated days until DIEM supply cap |
| `mintRate` | number | Current sVVV required to mint 1 DIEM |
| `mintCostUsd` | number | USD cost to mint 1 DIEM |
| `mintParity` | number | Mint parity ratio |
| `marketDiscount` | number | Market discount vs mint cost |
| `mintBreakevenYears` | number | Years to break even on minting |
| `remainingMintable` | number | Remaining DIEM mintable at current rate |
| `mintDifficulty` | number | Mint difficulty index |
| `effectiveAnnualCost` | number | Effective annual cost of minting |
| `impliedConfidence` | number | Market implied confidence ratio |

#### Burns

| Field | Type | Description |
|-------|------|-------------|
| `burnedSupply` | number | Total VVV burned |
| `totalBurnedFromEvents` | number | VVV burned from tracked events |
| `organicBurned` | number | Organic (non-airdrop) VVV burned |
| `burnDeflationRate` | number | Annual deflation rate from burns (%) |
| `burnsByCategory` | object | Burns broken down by category |
| `burnsByCategory.organic` | `{total, count}` | Organic burns |
| `burnsByCategory.airdrop` | `{total, count}` | Airdrop-related burns |
| `burnsByCategory.team` | `{total, count}` | Team burns |
| `burnsByCategory.micro` | `{total, count}` | Micro burns |
| `burnsByCategory.unknown` | `{total, count}` | Uncategorized burns |

#### Revenue & Emissions

| Field | Type | Description |
|-------|------|-------------|
| `veniceRevenue` | number | Total Venice protocol revenue (USD) |
| `estimatedRevenue` | number | Estimated revenue (USD) |
| `burnRevenueTotal` | number | Total burn revenue (USD) |
| `burnRevenueMonthlyAvg` | number | Monthly average burn revenue |
| `burnRevenueAnnualized` | number | Annualized burn revenue |
| `burnRevenueSampleMonths` | number | Months of data in sample |
| `emissionRate` | number | VVV emission rate (0–1, annual) |
| `emissionPerYear` | number | VVV emitted per year |
| `venicePct` | number | Venice protocol fee percentage |

#### Vesting

| Field | Type | Description |
|-------|------|-------------|
| `vestingTotalLocked` | number | VVV locked in vesting |
| `vestingDailyDrip` | number | Daily vesting drip (VVV) |
| `vestingActiveStreams` | number | Active vesting streams |

---

### GET `/api/charts`

Time-series data with up to 200 points per series (LTTB downsampled).

**Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | string | `7d` | `7d`, `30d`, `90d`, `1y`, `all` |
| `metric` | string | *(all)* | Single series name (omit for all 17) |

**Available series:** `vvvPrice`, `diemPrice`, `ethPrice`, `stakingRatio`, `totalStaked`, `lockRatio`, `svvvLocked`, `diemSupply`, `diemStaked`, `diemStakeRatio`, `mintRate`, `mintParity`, `burns`, `diemEvents`, `diemDistribution`, `diemStakerGrowth`, `cooldownWave`

**Response (single metric):**
```json
{
  "metric": "vvvPrice",
  "period": "7d",
  "data": [{ "t": 1775421900000, "v": 7.42 }, ...]
}
```

**Response (all metrics):** Object keyed by series name, each an array of `{t, v}` points, plus a `period` field.

---

### GET `/api/health`

System health dashboard.

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"healthy"` or error state |
| `timestamp` | string | Current server time |
| `workers` | object | `{env, pid, uptimeSec, workers}` |
| `pipelines[]` | array | `{name, status, lastUpdate, ageSec}` per pipeline |
| `stats` | object | `{events, prices, snapshots, wallets, trackingSince}` |
| `rpc` | object | RPC usage: `{last24h, prev24h, today, thisHour, hourly, hourlyDate, month, limit, availableDays, byMethod}` |
| `portraits` | object | Portrait generation: `{done, pending, failed}` |

---

## Markets

### GET `/api/markets`

DEX volume aggregates by pool.

**Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | string | `VVV` | Token to query |
| `period` | string | `24h` | Time period |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | Queried token |
| `period` | string | Queried period |
| `kpis.price` | number | Current price |
| `kpis.priceChange` | number | % price change |
| `kpis.volume` | number | Total volume (USD) |
| `kpis.volumePrev` | number | Previous period volume (USD) |
| `kpis.buyPct` | number | Buy percentage (0–100) |
| `kpis.traders` | number | Unique traders |
| `kpis.tradersPrev` | number | Previous period traders |
| `kpis.swaps` | number | Total swap count |
| `kpis.swapsPrev` | number | Previous period swaps |
| `pools[]` | array | Per-pool breakdown (see below) |
| `largeSwaps[]` | array | Large swaps in period |

**Pool object:**

| Field | Type | Description |
|-------|------|-------------|
| `pool` | string | Pool contract address (or `"rfq"`) |
| `name` | string | Pool name (e.g. `"VVV/WETH"`) |
| `dex` | string | DEX name (e.g. `"Aerodrome"`, `"Uniswap"`) |
| `volume` | number | Pool volume (USD) |
| `volumePct` | number | % of total volume |
| `swaps` | number | Swap count |
| `buyPct` | number | Buy percentage |

---

### GET `/api/markets/large-swaps`

Paginated large individual trades with trader identity.

**Params:** `token`, `period`, `page`, `limit`

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `period` | string | Queried period |
| `pagination` | object | `{page, limit, total, pages}` |
| `swaps[]` | array | Large swap events (see below) |

**Swap object:**

| Field | Type | Description |
|-------|------|-------------|
| `txHash` | string | Transaction hash |
| `timestamp` | string | ISO timestamp |
| `trader` | string | Trader address |
| `traderName` | string | ENS or label |
| `direction` | string | `"buy"` or `"sell"` |
| `tokenAmount` | number | Token amount |
| `tokenLabel` | string | Token symbol |
| `volumeUsd` | number | Trade volume (USD) |
| `effectivePrice` | number | Effective price |
| `pool` | string | Pool address |
| `poolName` | string | Pool name |
| `dex` | string | DEX name |
| `isVesting` | boolean | Whether trader is a vesting recipient |
| `routerLogo` | string | Router/aggregator logo URL |

---

### GET `/api/live`

Real-time unified event feed (swaps, staking, DIEM, vesting).

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `viewers` | number | Current live viewers |
| `prices` | object | `{vvv, vvvChange24h, vvvVolume24h, diem, diemChange24h, diemVolume24h}` |
| `events[]` | array | Live events (see below) |

**Event object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event ID |
| `type` | string | Event type (e.g. `"swap"`, `"stake"`, `"mint"`) |
| `timestamp` | string | ISO timestamp |
| `txHash` | string | Transaction hash |
| `address` | string | Wallet address |
| `ensName` | string | ENS name (if resolved) |
| `username` | string | Venetian username |
| `amount` | number | Amount |
| `source` | string | Source identifier |
| `pool` | string | Pool (for swaps) |
| `aggregator` | string | Aggregator used |
| `botLabel` | string | Bot label (if applicable) |

---

## Wallets

### GET `/api/venetians`

Full Venetian identity for a single wallet.

**Params:**
| Param | Type | Description |
|-------|------|-------------|
| `address` | string | Wallet address (required) |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `address` | string | Wallet address |
| `ensName` | string | ENS name |
| `ensAvatar` | string | ENS avatar URL |
| `username` | string | Venetian username |
| `role` | string | Role ID |
| `roleLabel` | string | Display name (e.g. `"Patrician"`) |
| `roleColor` | string | Role color hex |
| `roleEmoji` | string | Role emoji |
| `sizeTier` | number | Size tier (numeric) |
| `sizeLabel` | string | Size label (e.g. `"Octopus"`) |
| `sizeEmoji` | string | Size emoji |
| `era` | string | Era ID |
| `eraLabel` | string | Era display name |
| `eraColor` | string | Era color hex |
| `svvvBalance` | number | sVVV balance |
| `svvvLocked` | number | sVVV in locked positions |
| `svvvUnlocked` | number | sVVV unlocked |
| `vvvBalance` | number | Liquid VVV balance |
| `diemBalance` | number | DIEM balance |
| `diemStaked` | number | DIEM staked |
| `pendingRewards` | number | Pending VVV rewards |
| `exposureUsd` | number | Total USD exposure |
| `personalBurnRate` | number | Personal DIEM burn rate |
| `score` | number | Venetian score |
| `rank` | number | Leaderboard rank |
| `totalVenetians` | number | Total Venetians in system |
| `firstSeenAt` | string | First seen timestamp |
| `radar[]` | array | `{label, value}` pairs for radar chart |
| `chronicle` | string | AI-generated wallet narrative |
| `badges[]` | array | Badge name strings |
| `badgeCounts` | object | Per-badge counts (keys: `alpha_minter`, `inference_whale`, `ironclad`, `full_stack`, `voyager`, `nuovo_ricco`, `magnate`, `il_milione`, `diamond_hands`, `centurion`, `accumulator`, `airdrop_og`, `locked_loaded`, `airdrop_loyalist`, `patron`) |
| `nextGoals[]` | array | `{icon, text, category}` — next achievements |

---

### GET `/api/holders`

Holder leaderboard, sortable and paginated.

**Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Results per page |
| `sort` | string | | Sort field |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `totalHolders` | number | Total holder count |
| `lastUpdated` | string | ISO timestamp |
| `pagination` | object | `{page, limit, total, pages}` |
| `holders[]` | array | Holder objects (see below) |

**Holder object:**

| Field | Type | Description |
|-------|------|-------------|
| `rank` | number | Leaderboard rank |
| `address` | string | Wallet address |
| `username` | string | Venetian username |
| `ensName` | string | ENS name |
| `ensAvatar` | string | ENS avatar URL |
| `svvvBalance` | number | sVVV balance |
| `svvvLocked` | number | sVVV locked |
| `svvvUnlocked` | number | sVVV unlocked |
| `pendingRewards` | number | Pending VVV rewards |
| `diemBalance` | number | DIEM balance |
| `diemStaked` | number | DIEM staked |
| `outstandingDiem` | number | Outstanding DIEM |
| `claimedRewards` | number | Total claimed rewards |
| `vvvBalance` | number | Liquid VVV balance |
| `personalBurnRate` | number | Personal DIEM burn rate |
| `convictionScore` | number | Conviction score |
| `mintAlpha` | number | Minting alpha |
| `firstSeenAt` | string | First seen timestamp |
| `updatedAt` | string | Last updated timestamp |

---

### GET `/api/wallet-swaps`

Wallet trading history with cost basis and PnL.

**Params:**
| Param | Type | Description |
|-------|------|-------------|
| `address` | string | Wallet address (required) |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total swap count |
| `disclaimer` | string | Data disclaimer |
| `insights[]` | array | Human-readable insight strings |
| `swaps[]` | array | Swap events (see below) |
| `costBasis` | object | Per-token cost basis (see below) |

**Swap object:**

| Field | Type | Description |
|-------|------|-------------|
| `direction` | string | `"buy"` or `"sell"` |
| `token` | string | Token symbol |
| `amount` | number | Token amount |
| `effectivePrice` | number | Effective price (USD) |
| `volumeUsd` | number | Trade volume (USD) |
| `via` | string | Router/aggregator |
| `legs` | number | Number of swap legs |
| `corrected` | boolean | Whether price was corrected |
| `timestamp` | string | ISO timestamp |
| `txHash` | string | Transaction hash |

**Cost basis (per token, e.g. `costBasis.VVV`):**

| Field | Type | Description |
|-------|------|-------------|
| `avgBuyPrice` | number | Average buy price |
| `avgSellPrice` | number | Average sell price |
| `totalBought` | number | Total tokens bought |
| `totalSold` | number | Total tokens sold |
| `netPosition` | number | Net position |
| `invested` | number | Total invested (USD) |
| `extracted` | number | Total extracted (USD) |

---

### GET `/api/wallet-history`

Balance time-series per wallet.

**Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `address` | string | | Wallet address (required) |
| `granularity` | string | `1d` | `1h`, `4h`, or `1d` |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `points[]` | array | Time-series points (see below) |

**Point object:**

| Field | Type | Description |
|-------|------|-------------|
| `t` | number | Unix timestamp (ms) |
| `svvv` | number | sVVV balance |
| `diem` | number | DIEM balance |
| `vvv` | number | Liquid VVV balance |
| `cooldown` | number | VVV in cooldown |
| `svvvUsd` | number | sVVV value (USD) |
| `diemUsd` | number | DIEM value (USD) |
| `vvvUsd` | number | VVV value (USD) |
| `cooldownUsd` | number | Cooldown value (USD) |

---

## Burns & Staking Events

### GET `/api/burns`

Paginated VVV burn events with ENS enrichment.

**Params:** `page`, `limit`

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total burn events |
| `burns[]` | array | Burn events (see below) |

**Burn object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event ID |
| `txHash` | string | Transaction hash |
| `timestamp` | string | ISO timestamp |
| `from` | string | Burner address |
| `username` | string | Venetian username |
| `ensName` | string | ENS name |
| `amount` | number | VVV burned |
| `category` | string | `"organic"`, `"airdrop"`, `"team"`, `"micro"`, `"unknown"` |

---

### GET `/api/insider-flow`

Vesting recipient trading activity.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `kpis` | object | Aggregate KPIs (see below) |
| `chart[]` | array | Time-series (see below) |

**KPIs:**

| Field | Type | Description |
|-------|------|-------------|
| `netFlow30d` | number | Net VVV flow (30d) |
| `prevNetFlow30d` | number | Previous 30d net flow |
| `sellVolume30d` | number | Sell volume (30d, USD) |
| `buyVolume30d` | number | Buy volume (30d, USD) |
| `sellPressure` | number | Sell pressure ratio |
| `sellTrendPct` | number | Sell trend % change |
| `retentionRate` | number | Retention rate |
| `totalClaimed` | number | Total VVV claimed from vesting |
| `totalHeld` | number | Total VVV still held |
| `activeTraders30d` | number | Active insider traders (30d) |
| `activeTraders7d` | number | Active insider traders (7d) |
| `totalTrades30d` | number | Total insider trades (30d) |

**Chart point:** `{t, buyVol, sellVol, netFlow, trades, price}`

---

## Tokenomics

### GET `/api/treasury`

Treasury balances by category with allocation breakdown.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `totalVvv` | number | Total VVV in treasury |
| `totalSvvv` | number | Total sVVV in treasury |
| `totalDiem` | number | Total DIEM in treasury |
| `totalValueUsd` | number | Total treasury value (USD) |
| `vvvPriceUsd` | number | VVV price used |
| `diemPriceUsd` | number | DIEM price used |
| `walletsTracked` | number | Number of treasury wallets |
| `lastUpdated` | string | ISO timestamp |
| `categoryBreakdown[]` | array | `{category, vvv, svvv, diem, valueUsd}` |
| `allocation[]` | array | `{category, amount, pct}` |

---

### GET `/api/airdrop`

Airdrop distribution, retention, and loyalist analysis.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `kpis` | object | `{totalDistributed, recipients, avgClaim, medianClaim, largestClaim, firstClaim, lastClaim}` |
| `retention` | object | `{activeStakers, diemOnly, inactive, retainedPct, loyalists}` |
| `comparison` | object | `{claimerAvgSvvv, claimerAvgConviction, allAvgSvvv, allAvgConviction, allActiveCount}` |
| `distribution[]` | array | `{bucket, count, total, pctClaims, pctVvv}` — claim size buckets |
| `timeline[]` | array | `{day, daily, cumulative}` — claim timeline |
| `topLoyalists[]` | array | `{address, airdropAmount, currentSvvv, diemStaked, conviction, growth, ensName, portraitUrl}` |

---

### GET `/api/diem-analytics`

DIEM minting cohorts, top minters, burn rates, revenue.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `currentMintRate` | number | Current sVVV per DIEM mint rate |
| `totalLockedSvvv` | number | Total sVVV locked for DIEM |
| `veniceRevenue20Pct` | number | Venice's 20% revenue share (USD) |
| `cohorts[]` | array | Minting cohorts (see below) |
| `topMinters[]` | array | Top 50 minters (see below) |

**Cohort:** `{name, supplyRange, rateRange, walletCount, totalDiemMinted, avgBurnRate, stillLockedPct}`

**Top minter:** `{address, ensName, svvvLocked, outstandingDiem, burnRate, badge, inferencePerDay}`

---

### GET `/api/diem-events`

Paginated DIEM mint, burn, stake, unstake event log.

**Params:** `page`, `limit`, `type`

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total events |
| `events[]` | array | Event objects (see below) |

**Event:** `{id, type, txHash, timestamp, user, username, ensName, amount}`

- `type` values: `"mint"`, `"burn"`, `"stake"`, `"unstake"`

---

### GET `/api/vesting`

Vesting schedules and stream summary.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `totalLocked` | number | VVV still locked |
| `totalDeposited` | number | Total VVV deposited into vesting |
| `totalWithdrawn` | number | Total VVV withdrawn |
| `dailyDripRate` | number | Daily VVV drip |
| `activeStreams` | number | Active vesting streams |
| `totalStreams` | number | Total streams (including finished) |
| `uniqueRecipients` | number | Unique recipient addresses |
| `pctLocked` | number | % still locked |
| `pctClaimed` | number | % claimed |
| `fullyVestedBy` | string | Date when all vesting completes |
| `dripCliff` | object | `{date, dropPct, streamCount}` — next cliff event |
| `lastUpdated` | string | ISO timestamp |

---

## Community & Social

### GET `/api/buzz`

Curated news feed: articles, tweets, videos about Venice.ai.

**Params:** `page`, `limit`

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total items |
| `items[]` | array | Feed items (see below) |

**Item object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Item ID |
| `sourceId` | string | Source-specific ID |
| `type` | string | Content type (e.g. `"tweet"`, `"article"`, `"video"`) |
| `title` | string | Title / headline |
| `url` | string | Source URL |
| `summary` | string | Summary text |
| `thumbnailUrl` | string | Thumbnail image URL |
| `authorName` | string | Author display name |
| `authorHandle` | string | Author handle |
| `sourceName` | string | Source platform |
| `videoId` | string | YouTube video ID (if video) |
| `tweetId` | string | Tweet ID (if tweet) |
| `likeCount` | number | Likes / favorites |
| `retweetCount` | number | Retweets / shares |
| `publishedAt` | string | Publication timestamp |
| `discoveredAt` | string | Discovery timestamp |
| `tier` | string | Content tier / priority |

---

### GET `/api/social`

Twitter followers, CoinGecko sentiment, Santiment social volume.

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `twitterFollowers` | number | Venice.ai Twitter followers |
| `erikFollowers` | number | Erik Voorhees Twitter followers |
| `watchlistUsers` | number | CoinGecko VVV watchlist users |
| `diemWatchlistUsers` | number | CoinGecko DIEM watchlist users |
| `sentimentUpPct` | number | VVV bullish sentiment (0–100) |
| `diemSentimentUpPct` | number | DIEM bullish sentiment (0–100) |
| `sentimentBalance` | number | Net sentiment balance |
| `marketCapRank` | number | VVV CoinGecko market cap rank |
| `diemMarketCapRank` | number | DIEM CoinGecko market cap rank |
| `socialVolume` | number | Total social volume (mentions) |
| `socialVolumeTwitter` | number | Twitter mention volume |
| `socialVolumeReddit` | number | Reddit mention volume |
| `socialVolumeTelegram` | number | Telegram mention volume |
| `socialDominance` | number | Social dominance ratio |
| `lastUpdated` | string | ISO timestamp |
