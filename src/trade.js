/**
 * NanShield Trade — Security-gated DEX execution
 *
 * Integrates the nansen-trading ClawHub skill:
 * https://clawhub.ai/nansen-devops/nansen-trading
 *
 * Flow: scan → gate → quote → execute
 * Uses: nansen trade quote + nansen trade execute
 * Supports: --amount-unit token, --usd for auto-conversion
 */

import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner, printScoreBar, printScoreBreakdown, printVerdict, printApiCallProof } from './display.js';
import scoreToken from './score.js';
import { runNansen, parseData } from './nansen.js';
import { generate as generateHtml } from './htmlReport.js';
import { sendAlert } from './telegram.js';

const CONFIG_PATH  = path.join(os.homedir(), '.nanshield', 'config.json');
const TRADE_LOG    = path.join(os.homedir(), '.nanshield', 'logs', 'trades.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, env) {
  return execSync(command, { env, stdio: 'pipe', timeout: 60000 }).toString().trim();
}

export default async function runTrade(token, chain, options = {}) {
  // 1. Load config
  let config = {};
  try {
    if (await fs.pathExists(CONFIG_PATH)) config = await fs.readJson(CONFIG_PATH);
  } catch {}

  const finalChain  = chain || config.defaultChain || 'base';
  const threshold   = options.threshold  ?? config.riskThreshold ?? 60;
  const walletName  = options.wallet     || config.walletName    || 'default';
  const apiKey      = options.apiKey     || config.apiKey        || process.env.NANSEN_API_KEY;
  const fromToken   = options.from       || 'USDC';
  const { execute, force } = options;
  let { amount, amountUnit, usd } = options;

  // 2. Guards
  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }
  if (!amount && !usd) {
    console.log(chalk.red('Error: --amount or --usd is required for trade mode'));
    process.exit(1);
  }

  // 3. Wallet password
  let walletPassword = process.env.NANSEN_WALLET_PASSWORD;
  if (!walletPassword) {
    const envPath = path.join(os.homedir(), '.nansen', '.env');
    if (await fs.pathExists(envPath)) {
      const envContent = await fs.readFile(envPath, 'utf8');
      const match = envContent.match(/NANSEN_WALLET_PASSWORD=(.+)/);
      if (match) walletPassword = match[1].trim();
    }
  }
  if (!walletPassword) {
    console.log(chalk.red('✗ NANSEN_WALLET_PASSWORD not set.'));
    console.log(chalk.gray("Run: echo 'NANSEN_WALLET_PASSWORD=yourpassword' > ~/.nansen/.env"));
    process.exit(1);
  }

  const tradeEnv = { ...process.env, NANSEN_API_KEY: apiKey, NANSEN_WALLET_PASSWORD: walletPassword };

  // 4. Header
  printBanner();
  console.log(chalk.bold.cyan(`╔══════════════════════════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║  NanShield Security-Gated Trade                         ║`));
  console.log(chalk.bold.cyan(`╚══════════════════════════════════════════════════════════╝\n`));

  // ── Phase 1: USD conversion (if --usd provided) ─────────────────────────
  let usdValue = null;
  let tokenSymbol = token.slice(0, 8);

  if (usd) {
    console.log(chalk.bold('\nPhase 0: USD Conversion'));
    const convSpinner = ora(`Fetching token price for USD conversion...`).start();
    const infoCmd = `nansen research token info --token ${token} --chain ${finalChain} --fields name,symbol,price_usd,spot_metrics`;
    const infoResult = runNansen(infoCmd, apiKey);

    if (!infoResult.ok) {
      convSpinner.fail(chalk.red('Could not fetch token price for USD conversion'));
      process.exit(1);
    }

    let priceUsd = null;
    try {
      const json = JSON.parse(infoResult.data);
      const d = json?.data?.data;
      priceUsd = d?.price_usd ?? d?.spot_metrics?.price_usd ?? null;
      tokenSymbol = d?.symbol ?? tokenSymbol;
    } catch {}

    if (!priceUsd || priceUsd <= 0) {
      convSpinner.fail(chalk.red('Could not extract token price from response'));
      process.exit(1);
    }

    amount = usd / priceUsd;
    amountUnit = 'token';
    usdValue = usd;
    convSpinner.succeed(chalk.cyan(`💱 $${usd} = ${amount.toFixed(6)} ${tokenSymbol} @ $${priceUsd.toFixed(4)}/token`));
  }

  // ── Phase 1: Security Scan ───────────────────────────────────────────────
  console.log(chalk.bold('\nPhase 1: Security Scan'));

  let currentSpinner = null;
  let scanSuccess = 0;

  function onProgress(callNum, total, label, isComplete, res) {
    const numStr = String(callNum).padStart(2);
    if (!isComplete) {
      currentSpinner = ora(`  [${numStr}/${total}] ${label.padEnd(32)}...`).start();
    } else {
      const icon = res.ok ? chalk.green('✓') : chalk.yellow('⚠');
      const sum  = res.summary ? chalk.gray(` ${res.summary}`) : '';
      if (res.ok) scanSuccess++;
      currentSpinner?.succeed(`  [${numStr}/${total}] ${label.padEnd(32)} ${icon}${sum}`);
      currentSpinner = null;
    }
  }

  const scanStart = Date.now();
  let result;
  try {
    result = await scoreToken(token, finalChain, apiKey, false, onProgress);
  } catch (err) {
    currentSpinner?.fail('Scan failed');
    console.log(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }

  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  console.log(chalk.gray(`\n  Completed in ${elapsed}s — ${scanSuccess}/13 calls succeeded`));

  const { score, flags, factors } = result;
  printScoreBar(score, threshold);
  printScoreBreakdown(factors);
  printVerdict(score, threshold);

  // ── Gate check ───────────────────────────────────────────────────────────
  console.log('');
  if (score >= threshold && !force) {
    console.log(chalk.red('⛔ Trade blocked by NanShield.'));
    console.log(chalk.yellow('What you can do:'));
    console.log(chalk.gray('  • Review the flags above to understand the risks'));
    console.log(chalk.gray(`  • Lower your threshold: nanshield trade ${token} --threshold 75 --execute`));
    console.log(chalk.gray(`  • Override the gate:   nanshield trade ${token} --execute --force`));
    console.log(chalk.gray(`  • Research further:    nanshield check ${token} --deep --report`));
    process.exit(1);
  }

  if (score >= threshold && force) {
    console.log(chalk.bgRed.white(' ⚠ FORCE OVERRIDE ⚠ '));
    console.log(chalk.red('Proceeding despite high risk score. You were warned.'));
  } else {
    console.log(chalk.green('✅ Security gate passed. Proceeding to trade execution...'));
  }

  // ── Phase 2: Trade Execution ─────────────────────────────────────────────
  console.log(chalk.bold('\nPhase 2: Trade Execution (nansen-trading skill)'));

  // Dry run
  if (!execute) {
    console.log(chalk.yellow('\nDRY RUN — trade would execute with these parameters:'));
    console.log(chalk.gray(`  Chain:  ${finalChain}`));
    console.log(chalk.gray(`  From:   ${fromToken}`));
    console.log(chalk.gray(`  To:     ${token}`));
    console.log(chalk.gray(`  Amount: ${amount}${amountUnit ? ` (${amountUnit})` : ''}`));
    if (usdValue) console.log(chalk.gray(`  USD:    $${usdValue}`));
    console.log(chalk.gray(`  Wallet: ${walletName}`));
    console.log(chalk.cyan('Run with --execute to fire the real trade.'));
    return { score, passed: score < threshold, quoteId: null, txHash: null };
  }

  // Quote
  let quoteId = null;
  const unitFlag = amountUnit ? `--amount-unit ${amountUnit}` : '--amount-unit token';
  const quoteCmd = [
    'nansen trade quote',
    `--chain ${finalChain}`,
    `--from ${fromToken}`,
    `--to ${token}`,
    `--amount ${amount}`,
    unitFlag,
    `--wallet ${walletName}`,
  ].join(' ');

  const quoteSpinner = ora('  [14/16] Fetching quote ...').start();
  try {
    const raw = run(quoteCmd, tradeEnv);
    const quoteIdMatch = raw.match(/Quote ID:\s*([^\s\n]+)/i);
    if (!quoteIdMatch) throw new Error('Could not extract Quote ID from: ' + raw.slice(0, 200));
    quoteId = quoteIdMatch[1].trim();
    quoteSpinner.succeed(chalk.cyan(`  [14/16] Fetching quote ✓ Quote ID: ${quoteId}`));

    // Show route info
    const routeMatch = raw.match(/Route:\s*(.+)/i);
    const impactMatch = raw.match(/Price impact:\s*(.+)/i);
    if (routeMatch) console.log(chalk.gray(`          Route: ${routeMatch[1].trim()}`));
    if (impactMatch) console.log(chalk.gray(`          Price impact: ${impactMatch[1].trim()}`));
  } catch (err) {
    quoteSpinner.fail('  [14/16] Fetching quote ✗');
    const raw = err.stdout?.toString() || err.stderr?.toString() || err.message;
    console.log(chalk.red(`Quote error: ${raw}`));
    process.exit(1);
  }

  // Execute
  console.log(chalk.yellow('\nExecuting trade in 3 seconds... Ctrl+C to abort.'));
  await sleep(3000);

  const execCmd = ['nansen trade execute', `--quote ${quoteId}`, `--wallet ${walletName}`].join(' ');
  const execSpinner = ora('  [15/16] Executing trade ...').start();
  let txHash = null;

  // Re-read ~/.nansen/.env immediately before execute to ensure
  // NANSEN_WALLET_PASSWORD is explicitly present in the child env.
  let executeEnv = { ...tradeEnv };
  try {
    const envPath = path.join(os.homedir(), '.nansen', '.env');
    const envContent = await fs.readFile(envPath, 'utf8');
    const walletPass = envContent.match(/NANSEN_WALLET_PASSWORD=(.+)/)?.[1]?.trim();
    if (walletPass) {
      executeEnv = { ...process.env, NANSEN_API_KEY: apiKey, NANSEN_WALLET_PASSWORD: walletPass };
    }
  } catch { /* fall back to tradeEnv already set */ }

  try {
    const raw = execSync(execCmd, {
      env: executeEnv,
      stdio: 'pipe',
      timeout: 60000,
    }).toString().trim();
    const txMatch = raw.match(/(?:tx|transaction|hash)[:\s]+([0-9a-fA-Fx]{66})/i);
    txHash = txMatch ? txMatch[1] : null;

    execSpinner.succeed(chalk.green('  [15/16] Executing trade ✓ TX submitted'));
    console.log('');
    console.log(chalk.green('  ✅ Trade executed successfully'));
    if (txHash) {
      console.log(chalk.cyan(`  TX: ${txHash}`));
      console.log(chalk.cyan(`  Explorer: https://basescan.org/tx/${txHash}`));
    }
  } catch (err) {
    execSpinner.fail('  [15/16] Executing trade ✗');
    const raw = err.stdout?.toString() || err.stderr?.toString() || err.message;
    console.log(chalk.red(`Execution failed: ${raw}`));
    console.log(chalk.gray('Quote may have expired. Try again with a fresh quote.'));
    return { score, passed: score < threshold, quoteId, txHash: null };
  }

  // ── Phase 3: Post-Trade Log ──────────────────────────────────────────────
  console.log(chalk.bold('\nPhase 3: Post-Trade Log'));
  try {
    let tradeLog = [];
    if (await fs.pathExists(TRADE_LOG)) {
      try { tradeLog = await fs.readJson(TRADE_LOG); } catch {}
    }
    const entry = {
      timestamp: new Date().toISOString(),
      token,
      chain: finalChain,
      riskScore: score,
      verdict: score < threshold ? 'CLEARED' : 'FORCE_OVERRIDE',
      quoteId,
      txHash,
      amount: String(amount),
      amountUnit: amountUnit || 'token',
      from: fromToken,
      usdValue: usdValue ?? null,
    };
    tradeLog.push(entry);
    await fs.ensureDir(path.dirname(TRADE_LOG));
    await fs.writeJson(TRADE_LOG, tradeLog, { spaces: 2 });
    console.log(chalk.gray(`  📝 Logged to ${TRADE_LOG}`));
  } catch {}

  // Proof summary
  const tradeCalls = [
    { callNum: 'Q', command: quoteCmd, status: 'ok', summary: `Quote ID: ${quoteId}`, ms: 0 },
    { callNum: 'E', command: execCmd, status: txHash ? 'ok' : 'failed', summary: txHash ? `TX: ${txHash?.slice(0, 14)}...` : 'failed', ms: 0 },
  ];
  printApiCallProof([...result.callLog, ...tradeCalls], true);

  // ── Auto HTML report on every trade ────────────────────────────────────
  try {
    const tradeInfo = {
      spend:       `${amount} ${fromToken}`,
      receive:     `(see TX)`,
      priceImpact: '—',
      route:       '—',
      txHash,
    };
    await generateHtml({
      tokenInfo: result.tokenInfo || { symbol: token.slice(0, 8), address: token },
      chain: finalChain,
      score,
      factors: result.factors,
      callLog: result.callLog,
      agentAssessment: result.agentAssessment,
      tradeResult: tradeInfo,
    });
  } catch {}

  // ── TG warning if --force ────────────────────────────────────────────
  if (force) {
    console.log(chalk.bgRed.white('\n ⚠ FORCE TRADE WARNING: You overrode the security gate. '));
    try {
      await sendAlert('FORCE_TRADE_EXECUTED', {
        symbol: result.tokenInfo?.symbol || token.slice(0, 8),
        score,
        amount,
        fromToken,
        toToken: token,
        txHash,
        token,
      });
    } catch {}
  }

  // Next steps
  console.log(chalk.yellow('Next steps:'));
  if (txHash) console.log(chalk.gray(`  • Verify: https://basescan.org/tx/${txHash}`));
  console.log(chalk.gray(`  • Watch:  nanshield watch ${token} --chain ${finalChain} --interval 5`));

  return { score, passed: score < threshold, quoteId, txHash };
}
