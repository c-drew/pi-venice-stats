# Venice Stats — Slash Commands

All commands are prefixed with `/venice-stats-`.

## Preset

```text
/venice-stats-preset                   ← show current preset
/venice-stats-preset off               ← hide widget entirely
/venice-stats-preset usage             ← minimal right-aligned clock + balance (2 lines, no borders)
/venice-stats-preset wallet            ← prices + compact wallet summary
/venice-stats-preset max               ← full dashboard (default)
```

## Wallet

```text
/venice-stats-wallet                   ← show current wallet address
/venice-stats-wallet 0x<address>       ← set wallet address (persisted)
/venice-stats-wallet clear             ← remove wallet address
```

## Time

```text
/venice-stats-time                           ← show timezone + format
/venice-stats-time timezone America/New_York ← set IANA timezone
/venice-stats-time timezone reset            ← restore auto-detection
/venice-stats-time format 12h                ← 12-hour time
/venice-stats-time format 24h                ← 24-hour time (default)
/venice-stats-time format reset
```

## Sparkline periods

```text
/venice-stats-period                        ← show token + cooldown + exposure periods
/venice-stats-period reset                  ← reset all to defaults

/venice-stats-period token 1h               ← 1-hour token sparklines (VVV + DIEM)
/venice-stats-period token 24h              ← 24-hour (default)
/venice-stats-period token 7d
/venice-stats-period token 30d
/venice-stats-period token reset

/venice-stats-period cooldown 24h           ← cooldown wave chart period
/venice-stats-period cooldown 7d            ← 7-day (default)
/venice-stats-period cooldown 30d
/venice-stats-period cooldown reset

/venice-stats-period exposure 1h            ← protocol exposure sparkline period
/venice-stats-period exposure 24h
/venice-stats-period exposure 7d
/venice-stats-period exposure 30d           ← 30-day (default)
/venice-stats-period exposure reset
```

All settings are persisted across sessions via Pi's session log.
