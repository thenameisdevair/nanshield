# NanGuard

> Security-gated DEX execution powered by Nansen onchain intelligence.
> Don't trade blind. Scan first. Execute only if safe.

NanGuard is a CLI security layer for DEX traders. Drop in a token address, and NanGuard fires 10 Nansen API calls — pulling liquidity depth, holder concentration, smart money flows, buyer profile, and top trader network quality — computes a 0-100 risk score across 7 factors, and either clears the trade for execution or blocks it with a full breakdown of what triggered the alert. If the scan passes, NanGuard hands off directly to `nansen trade` to execute the swap on-chain. Every decision is logged. Every trade is gated.

---

## The Problem

- Traders see a CA in Telegram and ape in blind
- No security layer between signal and execution
- Rug pulls and smart money dumps happen faster than manual research

---

## The Solution

NanGuard sits between you and the trade. Scans first across 10 Nansen API calls. Scores across 7 risk factors. Executes only if safe.

---

## Proven On-Chain

NanGuard has executed a real verified trade on Base mainnet.

**Tx Hash:** `0x3b3a0266f14dd14d1251a7eafc6802ebc01019a2a417e272c697746652095fcd`
**Explorer:** https://basescan.org/tx/0x3b3a0266f14dd14d1251a7eafc6802ebc01019a2a417e272c697746652095fcd

---

## Install

```bash
# 1. Install nansen-cli
npm install -g nansen-cli

# 2. Install NanGuard from GitHub
npm install -g github:thenameisdevair/nanshield

# 3. First-time setup
nanshield setup
```

Requires Node.js v18+  
Get your Nansen API key: https://app.nansen.ai/auth/agent-setup

---

## Quick Start — No Setup Required

You can pass credentials directly without running setup:

```bash
# One-shot scan with inline key
NANSEN_API_KEY=your_key nanshield check <token> --chain base

# Trade with inline key
NANSEN_API_KEY=your_key nanshield trade <token> \
  --chain base --amount 1 --execute
```

---

## Commands

### nanshield setup

First-run wizard. Saves config to `~/.nanshield/config.json`. Tests your API key live. Only needs to run once.

```bash
nanshield setup
```

---

### nanshield check \<token\>

One-shot security scan. Runs 10 Nansen API calls and returns a risk score with 7 scored factors.

```bash
# Basic scan
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

# Save full markdown report
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --report

# Include AI threat assessment (costs extra credits)
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --deep

# Custom risk threshold
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --threshold 75
```

| Flag | Default | Description |
|------|---------|-------------|
| `--chain` | `base` | `base` or `solana` |
| `--threshold` | `60` | Block trades at or above this score |
| `--report` | `false` | Write `NANSHIELD-REPORT.md` |
| `--deep` | `false` | Include nansen AI agent analysis |
| `--api-key` | — | Pass API key directly |

---

### nanshield trade \<token\>

Security scan + conditional DEX execution via Nansen trading.

```bash
# Dry run — shows scan + quote, does not execute
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --amount 1

# Full pipeline — scan, gate check, execute if safe
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --amount 1 --execute

# Override security gate (high risk — you were warned)
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --amount 1 --execute --force
```

**Requires:**
- A funded Nansen wallet (`nansen wallet create`)
- USDC on Base for trades
- ETH on Base for gas (~$0.50 minimum)
- `NANSEN_WALLET_PASSWORD` set in environment or `~/.nansen/.env`

| Flag | Default | Description |
|------|---------|-------------|
| `--amount` | required | Amount to trade |
| `--amount-unit` | `token` | `token` or `base` |
| `--execute` | `false` | Fire real trade if scan passes |
| `--force` | `false` | Override blocked gate |
| `--threshold` | `60` | Custom risk cutoff |
| `--wallet` | `default` | Nansen wallet name |
| `--api-key` | — | Pass API key directly |

---

### nanshield watch \<token\>

Continuous monitor. Re-scans every N minutes and alerts when risk threshold is crossed. Logs everything to disk.

```bash
nanshield watch 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --interval 5
```

Logs saved to: `~/.nanshield/logs/<token>_<chain>_<YYYY-MM-DD>.log`

| Flag | Default | Description |
|------|---------|-------------|
| `--chain` | `base` | Chain to monitor |
| `--interval` | `5` | Poll interval in minutes |
| `--threshold` | `60` | Score that triggers alert |
| `--api-key` | — | Pass API key directly |

---

## Understanding The Risk Score

NanGuard scores tokens from 0 to 100.  
**Score below 60 = CLEARED. Score 60 or above = BLOCKED.**

### Why 60?

The threshold of 60 is calibrated so that a token needs to trigger at least 3 significant red flags before being blocked. A single red flag (like moderate holder concentration) scores ~10-20pts and won't block a trade alone. It takes a combination of signals — smart money exiting AND holder concentration AND suspicious buyer profile — to cross 60.

Adjust the threshold per command with `--threshold`:
- `--threshold 40` = stricter (blocks more trades, safer)
- `--threshold 80` = looser (allows more trades, more risk)
- Default `60` = balanced for most traders

### The 7 Risk Factors

| Factor | Max Points | What Triggers It |
|--------|-----------|-----------------|
| Age & Liquidity | 10 | < $100k liquidity or very new token |
| Buyer Profile | 10 | > 80% unlabeled/retail wallets buying |
| Top Trader Network | 10 | Top trader's counterparties all unlabeled |
| Holder Concentration | 20 | Top wallet > 50% of tracked supply |
| SM DEX Activity | 15 | Smart money selling young tokens |
| SM Net Sentiment | 20 | Net SM outflow > $10k in 24h |
| SM Holdings Trend | 15 | SM holdings declining across tracked tokens |

### Score Guide

```
Score 0-20:   Very low risk. Strong liquidity, SM buying,
              labeled holders. Safe to trade.

Score 20-40:  Low risk. Minor yellow flags. Proceed with
              normal caution.

Score 40-59:  Moderate risk. Multiple yellow flags.
              Consider smaller position size.

Score 60-79:  HIGH RISK — Trade blocked. Significant red
              flags detected. Use --force only if you've
              done additional research.

Score 80-100: CRITICAL RISK — Strong rug/dump signals.
              Do not trade without extreme caution.
```

---

## The 13 Nansen API Calls

| # | Command | Purpose | Mode |
|---|---------|---------|------|
| 0 | `nansen agent` | AI threat assessment | `--deep` only |
| 1 | `token info` | Liquidity and metadata | Always |
| 2 | `who-bought-sold` | Buyer profile | Always |
| 3 | `profiler counterparties` | Top trader network quality | Always |
| 4 | `profiler pnl-summary` | Top trader track record | Always |
| 5 | `profiler transactions` | Top trader behavior | Always |
| 6 | `token holders` | Holder concentration | Always |
| 7 | `sm dex-trades` | SM recent trades | Always |
| 8 | `sm netflow` | SM sentiment | Always |
| 9 | `token flows` | Flow anomaly | Always |
| 10 | `sm holdings` | SM holdings trend | Always |
| 11 | `nansen trade quote` | Get swap quote | `--execute` only |
| 12 | `nansen trade execute` | Fire transaction | `--execute` only |

---

## Watch Mode Log Format

```
[10:32:01] Score: 45 ✅ SAFE  — SM netflow positive
[10:37:01] Score: 48 ✅ SAFE  — No significant change
[10:42:01] Score: 61 ⛔ ALERT — SM holdings dropped 12% in 5min
[10:42:01] >>> THRESHOLD CROSSED: was 48, now 61. Check your position.
```

Logs: `~/.nanshield/logs/<token8>_<chain>_<YYYY-MM-DD>.log`

---

## Credit Requirements

| Endpoint | Pro Credits | Free Credits |
|----------|-------------|--------------|
| token info | ~1 | ~10 |
| who-bought-sold | 1 | 10 |
| profiler pnl-summary | 1 | 10 |
| profiler transactions | 1 | 10 |
| profiler counterparties | 5 | 50 |
| token holders | 5 | 50 |
| sm dex-trades | 5 | 50 |
| sm netflow | 5 | 50 |
| sm holdings | 5 | 50 |
| nansen agent (`--deep`) | ~20 | ~200 |

**Per scan cost:**

| Plan | Basic scan | Deep scan (`--deep`) |
|------|-----------|---------------------|
| Pro | ~21 credits | ~41 credits |
| Free | ~210 credits | ~410 credits |

> Free tier (100 one-time credits) is not sufficient for a full scan. NanGuard requires a Nansen Pro API key.
>
> Alternative: x402 pay-per-call (~$0.26/scan on Base). Fund a wallet and nansen-cli handles payment automatically.

---

## Wallet Setup for Trading

```bash
# 1. Create a nansen wallet
nansen wallet create

# 2. Fund it with USDC on Base (for trades)
# Send USDC to your wallet's EVM address

# 3. Fund it with ETH on Base (for gas)
# Send ~$1 worth of ETH on Base to same address
# Minimum ~$0.50 ETH for gas fees

# 4. Set wallet password
echo "NANSEN_WALLET_PASSWORD=yourpassword" > ~/.nansen/.env

# 5. Test trade execution
nanshield trade <token> --chain base --amount 1 --execute
```

---

## Config Reference

```json
~/.nanshield/config.json
{
  "apiKey": "your_nansen_api_key",
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

---

## Real Trader Workflows

**1. Alpha group drops a CA — check before aping**
```bash
nanshield check <token> --chain base --report
```

**2. Scan and auto-execute in one command**
```bash
nanshield trade <token> --chain base --amount 1 --execute
```

**3. Already in a position — watch for smart money exits**
```bash
nanshield watch <token> --chain base --interval 5
```

**4. Quick alias for daily use**
```bash
alias ns="nanshield check"
ns <token> --chain base
```

**5. Updating NanGuard**
```bash
npm install -g github:thenameisdevair/nanshield
```

---

## Built For

Nansen CLI Challenge — Week 4  
Builder: thenameisdevair  
GitHub: https://github.com/thenameisdevair/nanshield
