# NanGuard SKILL.md

## What NanGuard Does
Security-gated DEX execution CLI. Runs 13 Nansen API calls to score a 
token's risk before allowing a trade to execute on Base or Solana.

## Install
npm install -g nanshield
nanshield setup

## Commands

### One-shot scan
nanshield check <token> --chain base
nanshield check <token> --chain base --report
nanshield check <token> --chain base --deep

### Security-gated trade
nanshield trade <token> --chain base --amount 1 --execute
nanshield trade <token> --chain base --amount 1 --execute --force
nanshield trade <token> --chain base --amount 1  (dry run, default)

### Continuous monitor
nanshield watch <token> --chain base --interval 5

### First-run setup
nanshield setup

## API Calls Made Per Scan (10 research + up to 3 trade)
1.  nansen research token info
2.  nansen research token flows
3.  nansen research token who-bought-sold
4.  nansen research token holders
5.  nansen research smart-money netflow
6.  nansen research smart-money holdings
7.  nansen research smart-money dex-trades
8.  nansen research profiler labels (top holder)
9.  nansen research profiler pnl-summary (top holder)
10. nansen research profiler transactions (top holder)
11. nansen agent (--deep flag only)
12. nansen trade quote (--execute mode)
13. nansen trade execute (--execute mode)

## Risk Score Factors
| Factor                  | Max Points | Red Flag Trigger          |
|-------------------------|------------|---------------------------|
| Holder concentration    | 20         | Top wallet > 30% supply   |
| SM net sentiment        | 20         | Outflow > $500k in 24h    |
| SM exit signal          | 15         | SM holders declining      |
| Flow anomaly            | 15         | Inflow spike > 200%       |
| Buyer profile           | 10         | > 80% retail buyers       |
| Top holder identity     | 10         | Unlabeled anonymous wallet|
| Token age/liquidity     | 10         | < 30 days or < $100k liq  |

Score >= 60 = BLOCKED. Score < 60 = CLEARED for trade.

## Config (~/.nanshield/config.json)
{
  "apiKey": "...",
  "defaultChain": "base",
  "riskThreshold": 60,
  "watchInterval": 5,
  "walletName": "default"
}

## Watch Mode Logs
Saved to ~/.nanshield/logs/<token8>_<chain>_<YYYY-MM-DD>.log
