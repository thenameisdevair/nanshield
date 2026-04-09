# NanShield SKILL.md — v2

## What NanShield Does

Security-gated DEX execution CLI. Runs up to 17 Nansen API calls to score
a token's risk before allowing a trade to execute on Base or Solana.
Integrates the nansen-trading ClawHub skill for DEX swaps.

v2 adds: Telegram alerts, detached pm2 watch mode, animated scan reveal,
HTML intelligence reports, path-to-clearance advisor, and AI synthesis
on every scan (not just --deep).

## Install

npm install -g github:thenameisdevair/nanshield
nanshield setup

## Commands

### Discover trending tokens
nanshield discover --chain base --timeframe 24h
nanshield discover --chain solana --timeframe 7d --limit 20

### One-shot scan (token address or name/symbol)
nanshield check <token> --chain base
nanshield check <token> --chain base --report          # MD + HTML report
nanshield check <token> --chain base --deep            # Expert AI analysis
nanshield check <token> --chain base --no-animation    # Piped/scripted use

### Security-gated trade (HTML report auto-generated)
nanshield trade <token> --chain base --amount 1 --execute
nanshield trade <token> --chain base --usd 20 --execute
nanshield trade <token> --chain base --amount 1 --execute --force

### Continuous monitor with Telegram alerts
nanshield watch <token> --chain base --interval 5
nanshield watch <token> --chain base --tg              # Send TG alerts on threshold cross
nanshield watch <token> --chain base --tg --detach     # Run as background pm2 process

### First-run setup (API key + chain + TG + pm2)
nanshield setup
nanshield setup --tg-only                              # Re-configure Telegram only

### End-to-end demo pipeline (~55 credits)
nanshield demo --chain base

## Flags Reference

| Flag            | Command     | Description |
|-----------------|-------------|-------------|
| --tg            | watch       | Enable Telegram alerts |
| --detach        | watch       | Spawn as pm2 background process |
| --tg-only       | setup       | Re-run only the Telegram credential wizard |
| --deep          | check       | Use nansen agent --expert instead of standard |
| --no-animation  | check/demo  | Disable animated output (auto-set when not TTY) |
| --report        | check       | Write .md + HTML report |
| --report        | trade       | Default true — HTML report always generated |
| --force         | trade       | Override security gate (sends TG warning) |
| --usd           | trade       | Auto-convert USD to token amount |

## API Calls Per Scan (14 research + 1 agent + up to 2 trade = 17 max)

1.  nansen search "<input>" (only if input is name/symbol, not address)
2.  nansen research token info --token <addr> --chain <chain>
3.  nansen research token who-bought-sold --token <addr> --chain <chain>
4.  nansen research token holders --token <addr> --chain <chain>
5.  nansen research token flows --token <addr> --chain <chain>
6.  nansen research token pnl --token <addr> --chain <chain> --days 30
7.  nansen research smart-money dex-trades --chain <chain>
8.  nansen research smart-money netflow --chain <chain>
9.  nansen research smart-money holdings --chain <chain>
10. nansen research profiler pnl-summary --address <top_trader>
11. nansen research profiler transactions --address <top_trader>
12. nansen research profiler counterparties --address <top_trader>
13. nansen research profiler labels --address <top_trader> --chain <chain>
14. nansen research profiler labels --address <top_holder> --chain <chain>
15. nansen research smart-money historical-holdings --chain <chain>  ← NEW v2 (always-on)
16. nansen agent "<synthesis>" [--expert on --deep]                  ← fires on all scans now
17. nansen trade quote (--execute mode, nansen-trading skill)
18. nansen trade execute (--execute mode, nansen-trading skill)

Discover command uses:
- nansen research token screener --chain <chain> --timeframe <tf>

Retry policy: 3 attempts with exponential backoff (1s/2s/4s) on any failed call.
Failed calls are marked UNSCORED and never crash the scan.

## Risk Score Factors (8 factors, max 100)

| Factor              | Max | Red Flag Trigger                        |
|---------------------|-----|-----------------------------------------|
| Holder concentration| 20  | Top wallet > 50% supply                 |
| SM Net Sentiment    | 15  | Outflow > $10k in 24h                   |
| SM DEX Activity     | 15  | SM selling young tokens                 |
| SM Holdings Trend   | 10  | SM holdings declining (uses historical) |
| PnL Dump Risk       | 10  | All top traders in profit, high avg PnL |
| Buyer Profile       | 10  | > 80% retail/unlabeled buyers           |
| Top Trader Network  | 10  | Counterparties all unlabeled            |
| Age & Liquidity     | 10  | < 30 days or < $100k liquidity          |

Score < 40   = CLEARED (green)
Score 40-59  = CLEARED WITH CAUTION (yellow) — advisor fires
Score 60-79  = BLOCKED (red) — advisor fires
Score 80-100 = CRITICAL — DO NOT TRADE

## Advisor (scores 40-79)

When score is between 40 and 79 inclusive, the advisor prints:
- Which factors are blocking clearance (+N pts each)
- Specific conditions that would reduce each factor to 0
- The nanshield watch command to get alerted when it clears

## Telegram Alert Types

THRESHOLD_CROSSED — fires when score crosses the threshold during watch:
  🛡 NANSHIELD ALERT
  Token: $SYMBOL (CHAIN)   Scan #N — HH:MM:SS
  Score: OLD → NEW ⛔ THRESHOLD CROSSED
  Changes: [factor deltas]
  Run deep scan: nanshield check <token> --chain <chain> --deep

FACTOR_CHANGED — fires when factors change but score stays safe:
  🟡 NANSHIELD WATCH UPDATE
  Token: $SYMBOL  Score: N/100 ✅
  [factor delta lines]

MONITORING_STOPPED — fires when API auth fails or token delisted:
  ⚠️ NANSHIELD MONITORING STOPPED
  Token: $SYMBOL (CHAIN)
  Reason: [API key invalid / Token no longer indexed]
  Restart: nanshield watch <token> --chain <chain> --tg

FORCE_TRADE_EXECUTED — fires when --force is used:
  ⚠️ FORCE TRADE EXECUTED
  Token: $SYMBOL — Score was N/100 (BLOCKED)
  Amount: X USDC → Y TOKEN
  Tx: 0x...

## pm2 Process Naming

Process name: nanshield-<first 8 chars of token>-<chain>
Example: nanshield-0x833589-base

Commands:
  pm2 list                               # view all processes
  pm2 logs nanshield-0x833589-base      # stream logs
  pm2 stop nanshield-0x833589-base      # stop monitoring
  pm2 save && pm2 startup               # survive reboots

## HTML Report

Location: ~/.nanshield/reports/NANSHIELD-SYMBOL-chain-HH-MM-SS.html
Auto-opens in browser if process.stdout.isTTY (interactive terminal).
VPS/headless: prints file path only.
Self-contained: no CDN dependencies, renders offline.

Sections: header bar, risk gauge, factor bars, SM netflow chart (7D),
holder composition chart, trade proof (if executed), AI synthesis,
API call proof grid, advisor (if borderline), footer.

## Config (~/.nanshield/config.json)

{
  "apiKey": "...",
  "defaultChain": "base",
  "riskThreshold": 60,
  "watchInterval": 5,
  "walletName": "default",
  "tgBotToken": "...",       // set by nanshield setup or --tg-only
  "tgChatId": "..."          // set by nanshield setup or --tg-only
}

## Bonus Skill Integration

nansen-trading: https://clawhub.ai/nansen-devops/nansen-trading
Two-step flow: quote then execute.
NanShield adds: security gating, --usd auto-conversion, --amount-unit token,
auto HTML report with tx hash proof, TG force-trade warning.
