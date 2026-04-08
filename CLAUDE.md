# NanShield v2 — Claude Code Agent Instructions

## What This Project Is

NanShield is a security-gated DEX execution CLI built on nansen-cli.
It runs up to 16 Nansen API calls to score a token's risk before
allowing a trade to execute. Integrates the nansen-trading ClawHub skill.

## Stack

- Node.js (v18+), ESM ("type": "module" in package.json)
- nansen-cli (globally installed, v1.14.0+)
- chalk v5, ora v8, yargs v17, fs-extra v11
- Wallet: "default" (EVM: 0x2da2Cb1a5fC7F9DF4e6425144938ce5f82438312, Base chain)

## Commands

- nanshield setup    → first-run wizard
- nanshield discover → trending token discovery (token screener)
- nanshield check    → one-shot risk scan (13 API calls)
- nanshield trade    → scan + conditional execute (up to 16 API calls)
- nanshield watch    → continuous monitor with delta alerts

## File Structure

src/
  index.js      ← CLI entry, yargs routing (5 commands)
  setup.js      ← setup wizard
  discover.js   ← token screener discovery
  check.js      ← one-shot scan (13 research calls)
  score.js      ← risk scoring engine (8 factors, 13 nansen calls)
  watch.js      ← watch mode + delta alerts + logger
  trade.js      ← quote + execute (nansen-trading skill)
  display.js    ← chalk UI, score bar, report writer, API proof log
  nansen.js     ← shared nansen-cli call wrapper + call logger
SKILL.md        ← agent skill instructions
CLAUDE.md       ← this file
README.md       ← user documentation + challenge submission
package.json

## Nansen CLI Auth

- API key in NANSEN_API_KEY env var or ~/.nansen/config.json
- Wallet name: "default"
- Chain: base (primary), solana (secondary)

## Nansen CLI Command Syntax (v1.14.0)

All research commands use: nansen research <category> <subcommand> [options]
Categories: smart-money, token, profiler, portfolio
Trade commands use: nansen trade <subcommand> [options]
Agent: nansen agent "<question>" [--expert]
Search: nansen search "<query>" [--type token] [--chain <chain>]
Schema: nansen schema [command] --pretty

## Commit Rules

- Commit after every working unit
- Format: type(scope): message
  - feat(discover): add token screener command
  - feat(scanner): add token-pnl API call
  - feat(score): add PnL dump risk factor
  - feat(trade): add --usd auto-conversion
  - feat(watch): add delta alerts
  - feat(display): add API call proof log
  - feat(report): upgrade report with API call table
  - docs(readme): update for v2
  - docs(skill): update SKILL.md for v2
  - fix(scope): description

## Git Rules

After every commit, immediately run: git push origin main

## Critical Implementation Notes

1. ALL nansen-cli calls go through src/nansen.js wrapper
2. Every call is logged via logCall() for the API proof summary
3. Terminal output shows [N/13] numbered progress for each call
4. The --report flag generates a markdown file with exact commands
5. Score max is 100 across 8 factors
6. Token input can be address OR name/symbol (auto-resolved via nansen search)
7. Trade flow: scan → gate check → quote → execute (nansen-trading skill)
8. Watch mode tracks and displays deltas between scans
9. --usd flag auto-converts USD to token amount via token info price
