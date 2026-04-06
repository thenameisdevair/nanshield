cat > CLAUDE.md << 'EOF'
# NanGuard — Claude Code Agent Instructions

## What This Project Is
NanGuard is a security-gated DEX execution CLI tool built on nansen-cli.
It runs 13 Nansen API calls to score a token's risk before allowing a trade to execute.

## Stack
- Node.js (v18+)
- nansen-cli (already globally installed)
- chalk, ora, yargs, fs-extra
- Wallet: "default" (EVM: 0x2da2Cb1a5fC7F9DF4e6425144938ce5f82438312, Base chain)

## Commands We Are Building
- nanshield setup      → first-run wizard
- nanshield check      → one-shot risk scan
- nanshield trade      → scan + conditional execute
- nanshield watch      → continuous monitor with log file

## Nansen CLI Auth
- API key in NANSEN_API_KEY env var or ~/.nansen/config.json
- Wallet name: "default"
- Chain: base (primary)

## Commit Rules
- Commit after every working unit (command added, module completed, bug fixed)
- Format: type(scope): message
  - feat(check): add token info API call
  - feat(score): implement risk scoring engine
  - fix(watch): correct log file path
  - docs(readme): add installation instructions

## File Structure
src/
  index.js      ← CLI entry, yargs routing
  setup.js      ← setup wizard
  check.js      ← one-shot scan
  score.js      ← risk scoring
  watch.js      ← watch mode + logger
  trade.js      ← quote + execute
  display.js    ← chalk UI, score bar, report writer
SKILL.md        ← agent instructions for nansen-cli usage
README.md
package.json
EOF