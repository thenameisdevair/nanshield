import os from 'os';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { printBanner, printScoreBar, printFactorsAnimated, printApiCallProof, printVerdict, writeReportFull } from './display.js';
import scoreToken from './score.js';
import { isAddress, runNansen, parseArray, parseData } from './nansen.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');
const TOTAL_CALLS = 13;

// ── Consistent dot-padding for call progress lines ───────────────────────────
function callLine(num, total, label, icon, summary) {
  const numStr = String(num).padStart(2);
  const totalStr = String(total);
  const MAX_LABEL = 32;
  const padLabel = label.padEnd(MAX_LABEL);
  const dots = '.'.repeat(Math.max(2, 42 - label.length));
  const summaryStr = summary ? chalk.gray(` ${summary}`) : '';
  return ` [${numStr}/${totalStr}] ${padLabel}${dots} ${icon}${summaryStr}`;
}

export default async function runCheck(token, chain, options = {}) {
  // 1. Load config
  let config = {};
  try {
    if (await fs.pathExists(CONFIG_PATH)) config = await fs.readJson(CONFIG_PATH);
  } catch {}

  const finalChain = chain || config.defaultChain || 'base';
  const threshold  = options.threshold ?? config.riskThreshold ?? 60;
  const apiKey     = options.apiKey || config.apiKey || process.env.NANSEN_API_KEY;

  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // 2. Token search / address resolution
  let resolvedToken = token;
  let searchCallEntry = null;

  if (!isAddress(token)) {
    const searchSpinner = ora(chalk.cyan(`🔍 Resolving "${token}" via nansen search...`)).start();
    const searchCmd = `nansen search "${token.replace(/"/g, '\\"')}" --type token`;
    const searchResult = runNansen(searchCmd, apiKey);

    if (!searchResult.ok) {
      searchSpinner.fail(chalk.red(`✖ Search failed: ${searchResult.error ?? 'unknown error'}`));
      process.exit(1);
    }

    let tokens = [];
    try {
      const json = JSON.parse(searchResult.data);
      tokens = json?.data?.tokens ?? [];
    } catch {}

    if (tokens.length === 0) {
      searchSpinner.fail('');
      console.log(chalk.red(`Could not resolve "${token}". Try using the contract address.`));
      process.exit(1);
    }

    const chainMatches = tokens.filter(t => t.chain === finalChain);

    if (chainMatches.length === 0) {
      const availableChains = [...new Set(tokens.map(t => t.chain).filter(Boolean))].join(', ');
      searchSpinner.fail('');
      console.log(chalk.yellow(`${token} not found on ${finalChain}. Available on: ${availableChains}`));
      console.log(chalk.gray(`Try: nanshield check ${token} --chain ${tokens[0].chain}`));
      process.exit(1);
    }

    const first = chainMatches[0];
    const addr = first.address;
    if (!addr) {
      searchSpinner.fail('');
      console.log(chalk.red(`Could not resolve "${token}" to a token address. Use a contract address instead.`));
      process.exit(1);
    }

    resolvedToken = addr;
    const name = first.symbol ?? first.name ?? '';
    const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    searchSpinner.stop();
    console.log(chalk.green(`✓ Resolved ${token} → ${shortAddr} on ${finalChain}`));
    searchCallEntry = { callNum: 'S', command: searchCmd, status: 'ok', summary: `Resolved to ${resolvedToken}`, ms: searchResult.ms };
  }

  // 3. Banner + scan header
  printBanner();
  const tokenShort = resolvedToken.length > 14 ? `${resolvedToken.slice(0, 8)}...${resolvedToken.slice(-6)}` : resolvedToken;
  console.log(chalk.bold.cyan(`╔══════════════════════════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║  NanShield Security Scan — ${tokenShort.padEnd(30)} ║`));
  console.log(chalk.bold.cyan(`║  Chain: ${finalChain.padEnd(48)} ║`));
  console.log(chalk.bold.cyan(`╚══════════════════════════════════════════════════════════╝\n`));

  // 4. Per-call progress
  let currentSpinner = null;
  let successCount = 0;
  let failCount = 0;
  const scanStart = Date.now();

  function onProgress(callNum, total, label, isComplete, res) {
    if (!isComplete) {
      const numStr = String(callNum).padStart(2);
      currentSpinner = ora(` [${numStr}/${total}] ${label.padEnd(32)}...`).start();
    } else {
      if (res.ok) {
        successCount++;
        currentSpinner?.succeed(callLine(callNum, total, label, chalk.green('✓'), res.summary));
      } else {
        failCount++;
        const errLabel = `unavailable (${res.errorType || 'endpoint error'})`;
        currentSpinner?.warn(callLine(callNum, total, label, chalk.yellow('⚠'), errLabel));
      }
      currentSpinner = null;
    }
  }

  // 5. Run scan
  let result;
  try {
    result = await scoreToken(resolvedToken, finalChain, apiKey, options.deep ?? false, onProgress, {}, threshold);
  } catch (err) {
    currentSpinner?.fail('Scan failed');
    console.log(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }

  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  console.log('');
  console.log(chalk.gray(`Scan complete — ${successCount}/${TOTAL_CALLS} calls succeeded (${failCount} failed) — ${elapsed}s`));
  console.log('');

  // 6. AI assessment (deep mode)
  if (result.agentAssessment) {
    console.log(chalk.yellow.bold('🤖 AI Risk Assessment:'));
    console.log(chalk.yellow(result.agentAssessment));
    console.log('');
  }

  // 7. Score bar, animated factor breakdown, verdict
  // BUG 3 FIX: call printFactorsAnimated (not the static printScoreBreakdown)
  // so bars fill left-to-right over 200ms each in interactive TTY.
  printScoreBar(result.score, threshold);
  await printFactorsAnimated(result.factors, process.stdout.isTTY && !(options.noAnimation));
  printVerdict(result.score, threshold);

  // 8. API call proof summary
  printApiCallProof(result.callLog, false);

  // 9. Write report
  const verdict = result.score >= threshold ? 'BLOCKED' : 'CLEARED';
  if (options.report) {
    const fullCallLog = searchCallEntry ? [searchCallEntry, ...result.callLog] : result.callLog;
    const scanData = {
      tokenInfo: result.tokenInfo || { symbol: resolvedToken.slice(0, 8), address: resolvedToken },
      chain: finalChain,
      score: result.score,
      factors: result.factors,
      callLog: fullCallLog,
      agentAssessment: result.agentAssessment || null,
      smNetflow7d: result.smNetflow7d || [],
      holderComposition: result.holderComposition || null,
    };
    await writeReportFull(resolvedToken, finalChain, result.score, result.factors, verdict, fullCallLog, './NANSHIELD-REPORT.md', result.agentAssessment, scanData);
  }

  // 10. Next steps
  console.log(chalk.yellow('\nWhat you can do:'));
  if (verdict === 'CLEARED') {
    console.log(chalk.gray(`  • Execute a trade:  nanshield trade ${token} --chain ${finalChain} --amount <n> --execute`));
    console.log(chalk.gray(`  • Watch this token: nanshield watch ${token} --chain ${finalChain} --interval 5`));
    console.log(chalk.gray(`  • Deep AI analysis: nanshield check ${token} --chain ${finalChain} --deep`));
    console.log(chalk.gray(`  • Save full report: nanshield check ${token} --chain ${finalChain} --report`));
  } else {
    console.log(chalk.gray(`  • Save risk report:   nanshield check ${token} --chain ${finalChain} --report`));
    console.log(chalk.gray(`  • Deep AI analysis:   nanshield check ${token} --chain ${finalChain} --deep`));
    console.log(chalk.gray(`  • Force trade anyway: nanshield trade ${token} --chain ${finalChain} --amount <n> --execute --force`));
    console.log(chalk.gray(`  • Adjust threshold:   nanshield check ${token} --chain ${finalChain} --threshold 75`));
  }

  return { score: result.score, flags: result.flags, passed: result.score < threshold };
}
