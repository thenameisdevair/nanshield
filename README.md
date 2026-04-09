# NanShield v2

> Security-gated DEX execution powered by Nansen onchain intelligence.
> 17 Nansen API calls. 8 risk factors. Scan → Gate → Execute.
> Integrates the nansen-trading ClawHub skill for DEX swaps on Solana and Base.

NanShield is a CLI security layer for DEX traders. Drop in a token address (or name/symbol — NanShield resolves it), and NanShield fires 14 Nansen research calls — pulling liquidity depth, holder concentration, smart money flows, SM historical positioning, buyer profile, top trader network quality, PnL leaderboard, and profiler labels — computes a 0-100 risk score across 8 factors, and either clears the trade for execution or blocks it with a full breakdown. AI synthesis fires on every scan. If the scan passes, NanShield hands off directly to `nansen trade` (via the nansen-trading ClawHub skill) to execute the swap on-chain. Every decision is logged. Every trade is gated.

---

## What's New in v2

- **Animated terminal scan reveal** — each API call lands sequentially with a 120ms delay for screen-recording clarity
- **HTML intelligence report** — self-contained dark-theme report with risk gauge, SM netflow chart, holder composition, trade proof, and API call grid. Auto-opens in browser.
- **Telegram watch alerts** — threshold crossed, factor delta, monitoring stopped, and force-trade alert types
- **Detached watch mode via pm2** — `--detach` flag spawns a background process. VPS-ready, survives reboots.
- **AI synthesis on every scan** — nansen agent now fires on standard scans (not just `--deep`). `--deep` uses `--expert`.
- **Path-to-clearance advisor** — borderline scores (40-79) show per-factor conditions that would reduce each flag to 0
- **SM historical-holdings added to standard scan** — call #14, always-on, improves SM Holdings Trend factor accuracy
- **Auto-report on every trade execution** — HTML report with tx hash proof generated automatically, no `--report` needed
- **`nanshield demo` command** — full pipeline in one run: discover → scan → quote with credit warning

---

## VPS Quick Start — 24/7 Monitoring

```bash
# Deploy NanShield on a VPS for 24/7 monitoring
npm install -g pm2 nansen-cli
npm install -g github:thenameisdevair/nanshield
nanshield setup           # enter API key + TG credentials
nanshield watch <token> --chain base --tg --detach
pm2 save && pm2 startup
# Now monitoring survives reboots
# Alerts fire to Telegram while you sleep
```

---

## The Problem

- Traders see a CA in Telegram and ape in blind
- No security layer between signal and execution
- Rug pulls and smart money dumps happen faster than manual research

---

## The Solution

NanShield sits between you and the trade. Scans first across 13 Nansen API calls. Scores across 8 risk factors. Executes only if safe.

---

## Proven On-Chain

NanShield has executed a real verified trade on Base mainnet.

**Tx Hash:** `0x3b3a0266f14dd14d1251a7eafc6802ebc01019a2a417e272c697746652095fcd`
**Explorer:** https://basescan.org/tx/0x3b3a0266f14dd14d1251a7eafc6802ebc01019a2a417e272c697746652095fcd

---

## Install

```bash
# 1. Install nansen-cli
npm install -g nansen-cli

# 2. Install NanShield from GitHub
npm install -g github:thenameisdevair/nanshield

# 3. First-time setup
nanshield setup
```

Requires Node.js v18+  
Get your Nansen API key: https://app.nansen.ai/auth/agent-setup

---

## Quick Start — No Setup Required

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

### nanshield discover

Discover trending tokens via Nansen token screener before scanning. Useful for finding new opportunities before aping in.

```bash
nanshield discover --chain base --timeframe 24h
nanshield discover --chain solana --timeframe 7d --limit 20
nanshield discover --chain base --timeframe 1h --sort buy_volume:desc
```

| Flag | Default | Description |
|------|---------|-------------|
| `--chain` | `base` | `base`, `solana`, `ethereum` |
| `--timeframe` | `24h` | `5m`, `1h`, `6h`, `24h`, `7d`, `30d` |
| `--limit` | `10` | Number of results (1-50) |
| `--sort` | `buy_volume:desc` | Sort field |

---

### nanshield check \<token\>

One-shot security scan. Accepts a token address OR a name/symbol (e.g., `USDC` or `BRETT`). Runs 13 Nansen API calls and returns a risk score with 8 scored factors.

```bash
# Scan by address
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base

# Scan by name/symbol (auto-resolved via nansen search)
nanshield check USDC --chain base

# Save full markdown report with API call proof
nanshield check 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --report

# Include AI threat assessment
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

Security scan + conditional DEX execution via the nansen-trading ClawHub skill.

```bash
# Dry run — shows scan + quote, does not execute
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --amount 1

# Full pipeline — scan, gate check, execute if safe
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --amount 1 --execute

# Trade by USD amount (auto-converts via token price)
nanshield trade 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --usd 20 --execute

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
| `--amount` | — | Token amount to trade |
| `--usd` | — | USD amount (auto-converts to token amount) |
| `--amount-unit` | `token` | `token` or `base` |
| `--from` | `USDC` | Token to spend |
| `--execute` | `false` | Fire real trade if scan passes |
| `--force` | `false` | Override blocked gate |
| `--threshold` | `60` | Custom risk cutoff |
| `--wallet` | `default` | Nansen wallet name |
| `--api-key` | — | Pass API key directly |

---

### nanshield watch \<token\>

Continuous monitor. Re-scans every N minutes and alerts when risk threshold is crossed or individual factors change. Shows delta between scans.

```bash
nanshield watch 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb \
  --chain base --interval 5

# With Telegram alerts
nanshield watch <token> --chain base --tg

# Detached background process (VPS / 24/7)
nanshield watch <token> --chain base --tg --detach
```

Logs saved to: `~/.nanshield/logs/<token>_<chain>_<YYYY-MM-DD>.log`

| Flag | Default | Description |
|------|---------|-------------|
| `--chain` | `base` | Chain to monitor |
| `--interval` | `5` | Poll interval in minutes |
| `--threshold` | `60` | Score that triggers alert |
| `--tg` | `false` | Send Telegram alerts on threshold cross / factor change |
| `--detach` | `false` | Spawn as detached pm2 background process |
| `--api-key` | — | Pass API key directly |

---

### nanshield demo

Full end-to-end pipeline in one command: discover a trending token → scan it → fetch a trade quote. Shows the complete NanShield flow with credit usage warning.

```bash
nanshield demo --chain base
```

Uses approximately 55 Nansen credits. Prompts for confirmation before starting.

---

## Understanding The Risk Score

NanShield scores tokens from 0 to 100.  
**Score below 60 = CLEARED. Score 60 or above = BLOCKED.**

### The 8 Risk Factors

| Factor | Max Points | What Triggers It |
|--------|-----------|-----------------|
| Age & Liquidity | 10 | < $100k liquidity or very new token |
| Buyer Profile | 10 | > 80% unlabeled/retail wallets buying |
| Top Trader Network | 10 | Top trader's counterparties all unlabeled |
| Holder Concentration | 20 | Top wallet > 50% of tracked supply |
| SM DEX Activity | 15 | Smart money selling young tokens |
| SM Net Sentiment | 15 | Net SM outflow > $10k in 24h |
| SM Holdings Trend | 10 | SM holdings declining across tracked tokens |
| PnL Dump Risk | 10 | All top traders in profit with high avg PnL |

**Total max: 100**

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

## The 17 Standard Nansen API Calls

| # | Command | Purpose | Mode |
|---|---------|---------|------|
| S | `nansen search "<input>"` | Resolve name/symbol to address | Name input only |
| 1 | `nansen research token info` | Liquidity and metadata | Always |
| 2 | `nansen research token who-bought-sold` | Buyer profile | Always |
| 3 | `nansen research token holders` | Holder concentration | Always |
| 4 | `nansen research token flows` | Flow anomaly | Always |
| 5 | `nansen research token pnl` | PnL dump risk leaderboard | Always |
| 6 | `nansen research smart-money dex-trades` | SM recent trades | Always |
| 7 | `nansen research smart-money netflow` | SM sentiment | Always |
| 8 | `nansen research smart-money holdings` | SM holdings trend | Always |
| 9 | `nansen research profiler pnl-summary` | Top trader track record | Always |
| 10 | `nansen research profiler transactions` | Top trader behavior | Always |
| 11 | `nansen research profiler counterparties` | Top trader network quality | Always |
| 12 | `nansen research profiler labels` (top trader) | Top trader identity | Always |
| 13 | `nansen research profiler labels` (top holder) | Top holder identity | Always |
| 14 | `nansen research smart-money historical-holdings` | SM positioning over time | Always (v2 NEW) |
| 15 | `nansen agent "<synthesis>"` | AI risk synthesis | Standard; `--expert` on `--deep` |
| 16 | `nansen research token screener` | Trending token discovery | `discover` / `demo` cmd |
| 17 | `nansen trade quote` | Get swap quote | `--execute` only |
| 18 | `nansen trade execute` | Fire transaction | `--execute` only |

---

## API Call Proof

Every NanShield scan prints a numbered log of each nansen-cli command as it executes. The `--report` flag generates a full markdown report (`NANSHIELD-REPORT.md`) with:

- Exact nansen-cli commands run (with all flags)
- Status of each call (success/failure)
- Key findings from each response
- Risk score breakdown with all 8 factors
- Trade execution details and tx hash (if applicable)

---

## Bonus Skill: nansen-trading

NanShield integrates the [nansen-trading ClawHub skill](https://clawhub.ai/nansen-devops/nansen-trading) for DEX execution. The trade command implements the skill's two-step flow:

1. `nansen trade quote` — Get a swap quote with route and price impact
2. `nansen trade execute` — Fire the on-chain transaction

NanShield extends this with:
- USD-denominated trades (`--usd 20`) with auto-conversion via `nansen research token info`
- `--amount-unit token` support for human-readable amounts
- `--from` flag to specify the spending token (default: USDC)
- Security gating — trades only execute if the risk score is below threshold
- Trade logging to `~/.nanshield/logs/trades.json`

---

## Watch Mode Delta Alerts

Watch mode shows what CHANGED between scans, not just the current score:

```
[14:32:01] Scan #1 — Score: 38/100 ✅ SAFE
[14:37:01] Scan #2 — Score: 38/100 ✅ SAFE — No change
[14:42:01] Scan #3 — Score: 52/100 ✅ SAFE — ⚠ 2 factors changed:
           ↑ SM Net Sentiment: 5 → 12 (+7) — Outflow increased to -$45k
           ↑ SM Holdings Trend: 3 → 8 (+5) — SM holdings dropped 8%
[14:47:01] Scan #4 — Score: 64/100 ⛔ ALERT — THRESHOLD CROSSED (was 52)
           ↑ PnL Dump Risk: 0 → 7 (+7) — Top traders taking profit
```

Logs: `~/.nanshield/logs/<token8>_<chain>_<YYYY-MM-DD>.log`

---

## Credit Requirements

| Endpoint | Pro Credits | Free Credits |
|----------|-------------|--------------|
| token info | ~1 | ~10 |
| who-bought-sold | 1 | 10 |
| token holders | 5 | 50 |
| token flows | 1 | 10 |
| token pnl | 1 | 10 |
| sm dex-trades | 5 | 50 |
| sm netflow | 5 | 50 |
| sm holdings | 5 | 50 |
| profiler pnl-summary | 1 | 10 |
| profiler transactions | 1 | 10 |
| profiler counterparties | 5 | 50 |
| profiler labels (×2) | 2 | 20 |
| nansen agent (`--deep`) | ~20 | ~200 |

**Per scan cost:**

| Plan | Basic scan (13 calls) | Deep scan (`--deep`) |
|------|-----------------------|---------------------|
| Pro | ~33 credits | ~53 credits |
| Free | ~330 credits | ~530 credits |

> Free tier (100 one-time credits) is not sufficient for a full scan. NanShield requires a Nansen Pro API key.
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

**1. Discover trending tokens first, then scan the top one**
```bash
nanshield discover --chain base --timeframe 24h
nanshield check <address-from-above> --chain base --report
```

**2. Alpha group drops a CA — check before aping**
```bash
nanshield check <token> --chain base --report
```

**3. Scan and auto-execute in one command**
```bash
nanshield trade <token> --chain base --amount 1 --execute
```

**4. Trade $20 worth without calculating token amounts**
```bash
nanshield trade <token> --chain base --usd 20 --execute
```

**5. Already in a position — watch for smart money exits**
```bash
nanshield watch <token> --chain base --interval 5
```

**6. Quick alias for daily use**
```bash
alias ns="nanshield check"
ns <token> --chain base
```

---

## Built For

Nansen CLI Challenge — Week 4
Bonus Skill: [nansen-trading](https://clawhub.ai/nansen-devops/nansen-trading)
Builder: thenameisdevair
GitHub: https://github.com/thenameisdevair/nanshield
