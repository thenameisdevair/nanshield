import readline from 'readline';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { runNansen, parseArray } from './nansen.js';
import scoreToken from './score.js';
import { printHeader, printCallLine, printFactorsAnimated, printVerdictAnimated, printAgentSynthesis, isAnimated } from './display.js';
import { advise, advisePlain } from './advisor.js';
import { generate } from './htmlReport.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

function fmtUsd(n) {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

export default async function runDemo(argv = {}) {
  try {
    // ── Credit warning ───────────────────────────────────────────────────
    console.log(chalk.cyan.bold('\nNanShield Demo — Full Pipeline'));
    console.log(chalk.gray('This will use ~55 Nansen credits.'));
    const cont = await ask(chalk.yellow('Continue? [Y/n] '));
    if (cont.toLowerCase() === 'n') {
      console.log(chalk.gray('Demo cancelled.'));
      process.exit(0);
    }

    // 1. Load config
    let config = {};
    try {
      if (await fs.pathExists(CONFIG_PATH)) config = await fs.readJson(CONFIG_PATH);
    } catch {}

    const chain  = argv.chain || config.defaultChain || 'base';
    const apiKey = argv.apiKey || config.apiKey || process.env.NANSEN_API_KEY;

    if (!apiKey) {
      console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
      process.exit(1);
    }

    // ── Step 1: Discover ─────────────────────────────────────────────────
    console.log(chalk.cyan('\nDiscovering trending tokens on Base...'));
    const discoverCmd = `nansen research token screener --chain ${chain} --timeframe 1h --sort buy_volume:desc --limit 10`;
    const discoverResult = runNansen(discoverCmd, apiKey);

    if (!discoverResult.ok) {
      console.log(chalk.red(`✖ Discovery failed: ${discoverResult.error ?? 'unknown'}`));
      process.exit(1);
    }

    const tokens = parseArray(discoverResult.data);
    if (!tokens || tokens.length === 0) {
      console.log(chalk.yellow('No tokens returned from screener. Try again later.'));
      process.exit(1);
    }

    // Filter out stablecoins, wrapped assets, and mega-cap tokens — not interesting for demo
    const SKIP_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'CBBTC', 'CBBBTC']);
    const SKIP_NAME_PATTERNS = ['USD', 'Tether', 'Wrapped', 'Staked'];
    const MAX_DEMO_LIQUIDITY = 50_000_000;

    function isSkipped(t) {
      const sym = (t.token_symbol ?? t.symbol ?? '').toUpperCase();
      const name = t.name ?? t.token_name ?? '';
      const liq = t.liquidity_usd ?? 0;
      if (SKIP_SYMBOLS.has(sym)) return true;
      if (SKIP_NAME_PATTERNS.some(p => name.includes(p))) return true;
      if (liq > MAX_DEMO_LIQUIDITY) return true;
      return false;
    }

    const filtered = tokens.filter(t => !isSkipped(t));

    const FALLBACK_ADDR   = '0x532f27101965dd16442E59d40670FaF5eBB142E4';
    const FALLBACK_SYMBOL = 'BRETT';

    let selectedAddr, selectedSymbol;
    if (filtered.length > 0) {
      const selected = filtered[0];
      selectedAddr   = selected.token_address ?? selected.address ?? selected.contract_address;
      selectedSymbol = selected.token_symbol ?? selected.symbol ?? selected.name ?? '?';
    }

    if (!selectedAddr) {
      console.log(chalk.yellow('No suitable non-stablecoin token found. Using BRETT as demo target.'));
      selectedAddr   = FALLBACK_ADDR;
      selectedSymbol = FALLBACK_SYMBOL;
    }

    console.log(chalk.green(`Selected: $${selectedSymbol} (${selectedAddr})`));

    // ── Step 2: Security scan ────────────────────────────────────────────
    const animated = isAnimated(argv);
    await printHeader(selectedSymbol, chain, animated);

    console.log(chalk.bold(`\n  SCANNING 16 NANSEN CALLS\n`));

    let scanCallNum = 0;
    function onProgress(callNum, total, label, isComplete, res) {
      if (isComplete) {
        scanCallNum++;
        const summary = res?.summary || '';
        // Fire-and-forget the async print (demo accepts slight delay)
        printCallLine(callNum, total, label, res?.ok ?? false, summary, animated)
          .catch(() => {});
      }
    }

    let scanResult;
    try {
      scanResult = await scoreToken(selectedAddr, chain, apiKey, false, onProgress);
    } catch (err) {
      console.log(chalk.red(`Scan failed: ${err.message}`));
      process.exit(1);
    }

    const { score, factors, callLog, agentAssessment, tokenInfo } = scanResult;
    const threshold = config.riskThreshold ?? 60;

    await printFactorsAnimated(factors, animated);
    await printVerdictAnimated(score, animated);
    printAgentSynthesis(agentAssessment);

    // ── Step 3 / 4: Gate check ───────────────────────────────────────────
    let tradeResult = null;

    if (score < threshold) {
      console.log(chalk.green('Token cleared. Fetching trade quote...'));

      // 10 USDC = 10,000,000 base units (USDC has 6 decimals)
      const quoteCmd = [
        'nansen trade quote',
        `--chain ${chain}`,
        `--from USDC`,
        `--to ${selectedAddr}`,
        `--amount 10000000`,
      ].join(' ');

      const quoteRes = runNansen(quoteCmd, apiKey, 60000);
      if (quoteRes.ok) {
        const raw = quoteRes.data || '';
        const spendMatch   = raw.match(/(?:spend|from)[:\s]+([^\n]+)/i);
        const receiveMatch = raw.match(/(?:receive|to)[:\s]+([^\n]+)/i);
        const impactMatch  = raw.match(/price\s*impact[:\s]+([^\n]+)/i);
        const routeMatch   = raw.match(/route[:\s]+([^\n]+)/i);

        tradeResult = {
          spend:       spendMatch   ? spendMatch[1].trim()   : '10 USDC',
          receive:     receiveMatch ? receiveMatch[1].trim() : '—',
          priceImpact: impactMatch  ? impactMatch[1].trim()  : '—',
          route:       routeMatch   ? routeMatch[1].trim()   : '—',
        };

        console.log(chalk.cyan('\n  Trade Quote:'));
        console.log(chalk.gray(`  Spend:        ${tradeResult.spend}`));
        console.log(chalk.gray(`  Receive:      ${tradeResult.receive}`));
        console.log(chalk.gray(`  Price Impact: ${tradeResult.priceImpact}`));
        console.log(chalk.gray(`  Route:        ${tradeResult.route}`));
      } else {
        console.log(chalk.yellow('  (Could not fetch live quote — add --amount and --execute to trade)'));
      }

      console.log(chalk.cyan('\nDemo complete. To execute a real trade:'));
      console.log(chalk.gray(`  nanshield trade ${selectedAddr} --chain ${chain} --usd 10 --execute`));

    } else {
      console.log(chalk.red('Token blocked. Demo shows the gate working as intended.'));

      // Show advisor for borderline scores
      if (score >= 40 && score <= 79) {
        const advisorText = advise(score, factors, selectedAddr, chain);
        if (advisorText) console.log(advisorText);
      }

      console.log(chalk.gray('\nRun demo again for a different token, or specify one:'));
      console.log(chalk.gray(`  nanshield check <token>`));
    }

    // ── Step 5: Always generate HTML report ──────────────────────────────
    const advisorPlain = advisePlain(score, factors, selectedAddr, chain);
    const scanData = {
      tokenInfo: tokenInfo || { symbol: selectedSymbol, address: selectedAddr },
      chain,
      score,
      factors,
      callLog,
      agentAssessment,
      advisorText: advisorPlain,
      tradeResult,
    };

    const reportPath = await generate(scanData);
    if (reportPath) {
      console.log(chalk.cyan(`\nFull report saved: ${reportPath}`));
    }
    console.log(chalk.gray(`API calls made this demo: ${(callLog || []).length}`));

  } catch (err) {
    console.error(`Demo error: ${err.message}`);
    process.exit(1);
  }
}
