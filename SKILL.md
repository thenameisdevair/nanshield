# NanShield SKILL.md

## What NanShield Does

Security-gated DEX execution CLI. Runs up to 16 Nansen API calls to score
a token's risk before allowing a trade to execute on Base or Solana.
Integrates the nansen-trading ClawHub skill for DEX swaps.

## Install

npm install -g github:thenameisdevair/nanshield
nanshield setup

## Commands

### Discover trending tokens
nanshield discover --chain base --timeframe 24h
nanshield discover --chain solana --timeframe 7d --limit 20

### One-shot scan (token address or name/symbol)
nanshield check <token> --chain base
nanshield check <token> --chain base --report
nanshield check <token> --chain base --deep

### Security-gated trade
nanshield trade <token> --chain base --amount 1 --execute
nanshield trade <token> --chain base --usd 20 --execute
nanshield trade <token> --chain base --amount 1 --execute --force

### Continuous monitor
nanshield watch <token> --chain base --interval 5

### First-run setup
nanshield setup

## API Calls Made Per Scan (13 research + up to 3 trade/agent)

1.  nansen search "<input>" (only if input is name/symbol, not address)
2.  nansen research token info --token <addr> --chain <chain>
3.  nansen research token who-bought-sold --token <addr> --chain <chain>
4.  nansen research token holders --token <addr> --chain <chain>
5.  nansen research token flows --token <addr> --chain <chain>
6.  nansen research token pnl --token <addr> --chain <chain> --days 30
7.  nansen research smart-money dex-trades --chain <chain>
8.  nansen research smart-money netflow --chain <chain>
9.  nansen research smart-money holdings --chain <chain>
10. nansen research profiler pnl-summary --address <top_trader> --chain <chain>
11. nansen research profiler transactions --address <top_trader> --chain <chain>
12. nansen research profiler counterparties --address <top_trader> --chain <chain>
13. nansen research profiler labels --address <top_trader> --chain <chain>
14. nansen research profiler labels --address <top_holder> --chain <chain>
15. nansen agent "<question>" (--deep flag only)
16. nansen trade quote (--execute mode, nansen-trading skill)
17. nansen trade execute (--execute mode, nansen-trading skill)

Discover command uses:
- nansen research token screener --chain <chain> --timeframe <tf>

## Risk Score Factors (8 factors, max 100)

| Factor              | Max | Red Flag Trigger                        |
|---------------------|-----|-----------------------------------------|
| Holder concentration| 20  | Top wallet > 50% supply                 |
| SM Net Sentiment    | 15  | Outflow > $10k in 24h                   |
| SM DEX Activity     | 15  | SM selling young tokens                 |
| SM Holdings Trend   | 10  | SM holdings declining                   |
| PnL Dump Risk       | 10  | All top traders in profit, high avg PnL |
| Buyer Profile       | 10  | > 80% retail/unlabeled buyers           |
| Top Trader Network  | 10  | Counterparties all unlabeled            |
| Age & Liquidity     | 10  | < 30 days or < $100k liquidity          |

Score >= 60 = BLOCKED. Score < 60 = CLEARED for trade.

## Bonus Skill Integration

nansen-trading: https://clawhub.ai/nansen-devops/nansen-trading
Two-step flow: quote then execute.
NanShield adds: security gating, --usd auto-conversion, --amount-unit token.

## Config (~/.nanshield/config.json)

{
  "apiKey": "...",
  "defaultChain": "base",
  "riskThreshold": 60,
  "watchInterval": 5,
  "walletName": "default"
}
