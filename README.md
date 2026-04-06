# NanGuard

> Don't trade blind. Security-gated DEX execution powered by Nansen onchain intelligence.

NanGuard is a CLI security layer for DEX traders. Before any trade executes, it fires 13 Nansen API calls — pulling token holder data, smart money flows, wallet labels, and profiler signals — then computes a 0-100 risk score across 7 factors. Scores below the threshold clear the trade for execution. Scores at or above block it cold, with a full breakdown of what triggered the alert. Every decision is logged. Every trade is gated.

---

## The Problem

- Traders ape into tokens blind — a CA drops in an alpha group and capital moves before anyone checks the chain
- There is no security layer between signal and execution — the gap between "looks good" and "send it" is where rugs happen
- Rug pulls execute in seconds — by the time smart money data surfaces on a dashboard, the exit is already done

---

## The Solution

NanGuard sits between you and the trade. It scans first. It executes only if safe.

One command runs the full intelligence stack — holder concentration, smart money sentiment, flow anomalies, buyer profile, top wallet identity, token age, and liquidity depth — and either hands you a green light or blocks the transaction with a detailed threat report.

---

## Install

```bash
npm install -g nansen-cli
npm install -g nanshield
nanshield setup
```

Requires Node.js v18+. Get your Nansen API key at [app.nansen.ai/auth/agent-setup](https://app.nansen.ai/auth/agent-setup)

---

## Commands

### nanshield setup

First-run wizard. Prompts for your API key (masked input), default chain, risk threshold, watch interval, and wallet name. Tests the key against a live Nansen call before saving.

Config is saved to `~/.nanshield/config.json`. All commands read from it automatically — CLI flags override config values.

```bash
nanshield setup
```

---

### nanshield check \<token\>

One-shot risk scan. Runs all 10 research calls, scores the token, and prints the score bar, flag list, and verdict.

```bash
# Scan USDC on Base
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

# Save results to NANSHIELD-REPORT.md
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --report

# Include AI agent threat assessment (costs ~20 credits)
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --deep

# Custom threshold
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --threshold 45
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--chain` | string | `base` | Chain to scan (`base` or `solana`) |
| `--threshold` | number | `60` | Risk score that triggers a block |
| `--report` | boolean | `false` | Write `NANSHIELD-REPORT.md` with full scan results |
| `--deep` | boolean | `false` | Run `nansen agent` for AI threat assessment |
| `--api-key` | string | — | Override the configured API key |

---

### nanshield trade \<token\>

Security scan followed by conditional DEX execution. Dry run by default — pass `--execute` to fire the real transaction.

```bash
# Dry run (scan only, no trade)
nanshield trade 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --amount 1

# Scan + execute if safe
nanshield trade 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --amount 1 --execute

# Force trade even if risk score is high (use with caution)
nanshield trade 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --amount 1 --execute --force
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--amount` | number | required | Amount to trade |
| `--amount-unit` | string | `token` | Unit for amount (`token` or `base`) |
| `--execute` | boolean | `false` | Execute trade if scan passes (dry run if omitted) |
| `--force` | boolean | `false` | Override security gate and trade despite high score |
| `--threshold` | number | `60` | Risk score threshold |
| `--wallet` | string | `default` | Nansen wallet name to use |
| `--api-key` | string | — | Override the configured API key |

---

### nanshield watch \<token\>

Continuous monitor. Polls the token on an interval, prints a status line each scan, and writes every result to a persistent log file. Fires a visible alert when the score crosses the threshold.

```bash
nanshield watch 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --interval 5
```

Logs are saved to `~/.nanshield/logs/<token8>_<chain>_<YYYY-MM-DD>.log`. A new log file is created each day automatically.

Press `Ctrl+C` to stop. The log path is printed on exit.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--chain` | string | `base` | Chain to monitor |
| `--interval` | number | `5` | Poll interval in minutes |
| `--threshold` | number | `60` | Score that triggers an alert |
| `--api-key` | string | — | Override the configured API key |

---

## How The Risk Score Works

```
████████████░░░░░░░░  62/100  [HIGH RISK - TRADE BLOCKED]
```

Each scan runs 10 Nansen API calls and evaluates 7 risk factors:

| Factor | Max Points | Red Flag Trigger |
|--------|------------|-----------------|
| Holder Concentration | 20 | Top wallet holds > 30% of supply |
| SM Net Sentiment | 20 | Smart money net outflow > $500k in 24h |
| SM Exit Signal | 15 | SM holder count < 3 or declining |
| Flow Anomaly | 15 | Inflow spike > 200% above average |
| Buyer Profile | 10 | > 80% retail buyers, < 20% smart money |
| Top Holder Identity | 10 | Top wallet has no Nansen labels |
| Token Age & Liquidity | 10 | Token < 30 days old or liquidity < $100k |

**Score >= 60 → BLOCKED. Score < 60 → CLEARED.**

Example output:

```
🔴 Holder Concentration   Top wallet holds 41% of supply    +20pts
🔴 SM Net Sentiment       Outflow -$2.1M in 24h             +20pts
🟡 Flow Anomaly           Inflow spike +180% vs average     +8pts
🟢 Token Age & Liquidity  187 days old, $4.2M liquidity     +0pts
🟢 Top Holder Identity    Labeled: Binance Hot Wallet        +0pts
🟡 Buyer Profile          64% retail buyers                 +5pts
🟢 SM Exit Signal         14 SM holders active              +0pts

⛔ TRADE BLOCKED — Score exceeds threshold (60). Use --force to override.
```

---

## The 13 Nansen API Calls

| # | Call | Purpose | Mode |
|---|------|---------|------|
| 1 | `nansen research token info` | Name, symbol, liquidity, token age | Always |
| 2 | `nansen research token flows` | Inflow/outflow over 24h, spike detection | Always |
| 3 | `nansen research token who-bought-sold` | Retail vs smart money buyer split | Always |
| 4 | `nansen research token holders` | Top holder addresses and concentration % | Always |
| 5 | `nansen research smart-money netflow` | Aggregate SM net flow in USD over 24h | Always |
| 6 | `nansen research smart-money holdings` | SM holder count, exit signal detection | Always |
| 7 | `nansen research smart-money dex-trades` | Recent SM buys and sells | Always |
| 8 | `nansen research profiler labels` | Labels on top holder wallet | Always |
| 9 | `nansen research profiler pnl-summary` | Top holder PnL track record | Always |
| 10 | `nansen research profiler transactions` | Top holder recent transaction history | Always |
| 11 | `nansen agent` | AI threat assessment — rug pull signals | `--deep` only |
| 12 | `nansen trade quote` | Get DEX swap quote and quoteId | `--execute` only |
| 13 | `nansen trade execute` | Broadcast the transaction on-chain | `--execute` only |

---

## Watch Mode

```bash
nanshield watch 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --interval 5
```

Polls every 5 minutes. Each scan appends a timestamped line to the log file:

```
[10:32:01] Score: 45 ✅ SAFE   — 14 SM holders active
[10:37:01] Score: 48 ✅ SAFE   — SM netflow positive
[10:42:01] Score: 61 ⛔ ALERT  — SM holdings dropped 12% in 5min
[10:42:01] >>> THRESHOLD CROSSED: was 48, now 61
```

Logs are saved to:

```
~/.nanshield/logs/<token8>_<chain>_<YYYY-MM-DD>.log
```

A new file is created each day. Old logs are never deleted.

---

## x402 Pay-Per-Call

No subscription required. Fund a wallet with USDC on Base and `nansen-cli` handles x402 micropayments automatically for each API call.

Approximate costs per call:
- Research calls: $0.01–$0.05 each
- Full 10-call scan: ~$0.26
- AI agent call (`--deep`): ~$0.20 additional
- Trade quote + execute: ~$0.10 additional

You only pay for what you scan.

---

## Config Reference

Config file: `~/.nanshield/config.json`

```json
{
  "apiKey": "your-nansen-api-key",
  "defaultChain": "base",
  "riskThreshold": 60,
  "watchInterval": 5,
  "walletName": "default"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `apiKey` | Your Nansen API key | — |
| `defaultChain` | Chain used when `--chain` is not passed | `base` |
| `riskThreshold` | Score at or above which trades are blocked | `60` |
| `watchInterval` | Minutes between scans in watch mode | `5` |
| `walletName` | Nansen wallet name used for trade execution | `default` |

All fields can be overridden at runtime via CLI flags.

---

## Use Cases

**1. Alpha group drops a CA — check before aping**

A token address lands in your group chat. Before touching it, run a scan:

```bash
nanshield check <token> --chain base --report
```

Read the flag list. If the top wallet holds 40% and SM is net negative, you have your answer before the trade.

**2. Already in a position — catch SM exits early**

You're holding a token and want to know when smart money starts leaving:

```bash
nanshield watch <token> --chain base --interval 5
```

Watch mode runs every 5 minutes. The moment the score crosses your threshold, it fires a terminal alert and writes to the log. You see it before the chart moves.

**3. Automated trading — signal-to-execution pipeline**

Connect NanGuard to your signal workflow. Pass a token address and let NanGuard handle the risk gate:

```bash
nanshield trade <token> --chain base --amount 1 --execute
```

If the scan passes, the trade executes automatically via Nansen DEX. If it fails, the process exits with code 1 — clean for scripting and automation.

---

## Built For

**Nansen CLI Challenge — Week 4**

Builder: thenameisdevair  
Repo: https://github.com/thenameisdevair/nanshield
