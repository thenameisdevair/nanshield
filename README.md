# NanGuard

> Don't trade blind. Security-gated DEX execution powered by Nansen onchain intelligence.

NanGuard runs 13 Nansen API calls to build a risk score on any token before 
allowing a trade to execute. It detects holder concentration, smart money exits, 
flow anomalies, and unlabeled whale wallets — then either clears or blocks the trade.

## Install

```bash
npm install -g nansen-cli
npm install -g nanshield
nanshield setup
```

Requires Node.js v18+.

## Quick Start

```bash
# Scan a token
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

# Scan + execute trade if safe
nanshield trade 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --chain base --amount 1 --execute

# Watch a token continuously (logs to ~/.nanshield/logs/)
nanshield watch 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --chain base --interval 5
```

## How It Works

1. Runs 10 Nansen API calls across token data, smart money signals, and wallet profiling
2. Scores the token across 7 risk factors (0-100)
3. Scores below 60 → trade executes via nansen trade quote + execute
4. Scores 60+ → trade is blocked with a detailed threat report
5. Use --force to override. Use --report to save findings to markdown.

## Risk Score

```
████████████░░░░░░░░  62/100  [HIGH RISK - TRADE BLOCKED]

🔴 Holder Concentration   Top wallet holds 41% of supply    +20pts
🔴 SM Net Sentiment       Outflow -$2.1M in 24h             +20pts
🟡 Flow Activity          Inflow spike +180% vs 7d avg      +8pts
🟢 Token Age              187 days, $4.2M liquidity         +0pts
🟢 Top Holder Identity    Labeled: Binance Hot Wallet       +0pts
🟡 Buyer Profile          64% retail, 36% SM                +5pts
🟢 Liquidity Sanity       Passes minimum threshold          +0pts

⛔ TRADE BLOCKED — Score exceeds threshold (60). Use --force to override.
```

## Watch Mode

```bash
nanshield watch <token> --chain base --interval 5
```

Polls every 5 minutes. Logs to `~/.nanshield/logs/`:
```
[10:32:01] Score: 45 ✅ SAFE  — SM netflow positive
[10:42:01] Score: 61 ⛔ ALERT — SM holdings dropped 12% in 5min
>>> THRESHOLD CROSSED: was 45, now 61
```

## Payment

NanGuard uses your Nansen API key for research calls.
Trade execution uses your Nansen wallet funded with USDC on Base or Solana.
x402 pay-per-call support is built into nansen-cli for keyless usage.

## Nansen API Calls

| # | Call | Purpose |
|---|------|---------|
| 1 | token info | Metadata, liquidity, age |
| 2 | token flows | Flow anomaly detection |
| 3 | who-bought-sold | Buyer profile |
| 4 | token holders | Concentration risk |
| 5 | sm netflow | Aggregate SM sentiment |
| 6 | sm holdings | Exit signal |
| 7 | sm dex-trades | Recent SM activity |
| 8 | profiler labels | Top holder identity |
| 9 | profiler pnl-summary | Top holder track record |
| 10 | profiler transactions | Behavior pattern |
| 11 | nansen agent | AI threat assessment (--deep) |
| 12 | trade quote | Get swap terms |
| 13 | trade execute | Fire transaction |

## Built for the Nansen CLI Challenge — Week 4

Built by thenameisdevair  
GitHub: https://github.com/thenameisdevair/nanshield
