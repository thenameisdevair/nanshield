import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner, printScoreBar, printFlags, printVerdict } from './display.js';
import scoreToken from './score.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, env) {
  return execSync(command, {
    env,
    stdio: 'pipe',
    timeout: 60000,
  }).toString().trim();
}

export default async function runTrade(token, chain, options = {}) {
  // 1. Load config and merge
  let config = {};
  try {
    if (await fs.pathExists(CONFIG_PATH)) {
      config = await fs.readJson(CONFIG_PATH);
    }
  } catch {
    // proceed with defaults
  }

  const finalChain    = chain || config.defaultChain || 'base';
  const threshold     = options.threshold  ?? config.riskThreshold ?? 60;
  const walletName    = options.walletName || config.walletName    || 'default';
  const apiKey        = options.apiKey     || config.apiKey        || process.env.NANSEN_API_KEY;
  const { amount, amountUnit, execute, force } = options;

  // 2. Guards
  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }
  if (!amount) {
    console.log(chalk.red('Error: --amount is required for trade mode'));
    process.exit(1);
  }

  // 3. Source wallet password
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
  console.log(chalk.cyan(`NanGuard Trade Pipeline — ${token} on ${finalChain}`));
  console.log(chalk.gray(`Amount: ${amount} ${amountUnit || 'base units'}`));

  // 5. Scan
  const spinner = ora('Running 10 Nansen API calls...').start();
  const scanStart = Date.now();
  let result;
  try {
    result = await scoreToken(token, finalChain, apiKey);
  } catch (err) {
    spinner.fail('Scan failed');
    console.log(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  const succeeded = result.callLog.filter((c) => c.status === 'ok').length;
  spinner.succeed(chalk.gray(`Completed in ${elapsed}s — ${succeeded}/10 calls succeeded`));

  const { score, flags } = result;
  printScoreBar(score, threshold);
  printFlags(flags);
  printVerdict(score, threshold);

  // 6. Gate logic
  console.log('');
  if (score >= threshold && !force) {
    console.log(chalk.red('⛔ Trade blocked by NanGuard.'));
    console.log(chalk.yellow('What you can do:'));
    console.log(chalk.gray('  • Review the flags above to understand the risks'));
    console.log(chalk.gray(`  • Lower your threshold: nanshield trade ${token} --threshold 75 --execute`));
    console.log(chalk.gray(`  • Override the gate:   nanshield trade ${token} --execute --force`));
    console.log(chalk.gray(`  • Just get a quote:    nanshield trade ${token} --amount ${amount ?? '<n>'}`));
    console.log(chalk.gray(`  • Research further:    nanshield check ${token} --deep --report`));
    process.exit(1);
  }

  if (score >= threshold && force) {
    console.log(chalk.bgRed.white(' ⚠ FORCE OVERRIDE ⚠ '));
    console.log(chalk.red('Proceeding despite high risk score. You were warned.'));
  } else {
    console.log(chalk.green('✅ Security gate passed. Proceeding to trade execution...'));
  }

  // 7. Dry run
  if (!execute) {
    console.log(chalk.yellow('\nDRY RUN — trade would execute with these parameters:'));
    console.log(chalk.gray(`  Chain:  ${finalChain}`));
    console.log(chalk.gray(`  From:   USDC`));
    console.log(chalk.gray(`  To:     ${token}`));
    console.log(chalk.gray(`  Amount: ${amount}`));
    console.log(chalk.gray(`  Wallet: ${walletName}`));
    console.log(chalk.cyan('Run with --execute to fire the real trade.'));
    return { score, passed: score < threshold, quoteId: null, txHash: null };
  }

  // 8. Quote
  const quoteSpinner = ora('Getting quote from Nansen DEX...').start();
  let quoteId = null;

  try {
    const unitFlag = amountUnit ? `--amount-unit ${amountUnit}` : `--amount-unit token`;
    const quoteCmd = [
      'nansen trade quote',
      `--chain ${finalChain}`,
      `--from USDC`,
      `--to ${token}`,
      `--amount ${amount}`,
      unitFlag,
      `--wallet ${walletName}`,
    ].join(' ');

    const raw = run(quoteCmd, tradeEnv);
    const quoteIdMatch = raw.match(/Quote ID:\s*([^\s\n]+)/);
    if (!quoteIdMatch) throw new Error('Could not extract Quote ID from: ' + raw);
    quoteId = quoteIdMatch[1].trim();

    quoteSpinner.succeed(chalk.cyan(`Quote received: ${quoteId}`));
    console.log(chalk.cyan(raw));
  } catch (err) {
    quoteSpinner.fail('Quote failed');
    const raw = err.stdout?.toString() || err.stderr?.toString() || err.message;
    console.log(chalk.red(`✗ Quote error: ${raw}`));
    process.exit(1);
  }

  // 9. Execute
  console.log(chalk.yellow('\nExecuting trade in 3 seconds... Ctrl+C to abort.'));
  await sleep(3000);

  const execSpinner = ora('Broadcasting transaction...').start();
  let txHash = null;

  try {
    const execCmd = [
      'nansen trade execute',
      `--quote ${quoteId}`,
      `--wallet ${walletName}`,
    ].join(' ');

    const raw = run(execCmd, tradeEnv);
    const txMatch = raw.match(/[Tt]x(?:Hash)?[:\s]+([0x][a-fA-F0-9]{64})/);
    txHash = txMatch ? txMatch[1] : null;

    execSpinner.succeed(chalk.green('✅ Trade executed successfully'));
    console.log(chalk.green(raw));

    console.log(chalk.green('✅ Transaction successful!'));
    if (txHash) {
      console.log(chalk.cyan(`  Tx Hash:  ${txHash}`));
      console.log(chalk.cyan(`  Explorer: https://basescan.org/tx/${txHash}`));
    }
    console.log('');
    console.log(chalk.yellow('Next steps:'));
    if (txHash) {
      console.log(chalk.gray(`  • Verify on Basescan: https://basescan.org/tx/${txHash}`));
    }
    console.log(chalk.gray(`  • Check your wallet: nansen research profiler balance --address <walletAddress> --chain base`));
    console.log(chalk.gray(`  • Watch this token:  nanshield watch ${token} --chain ${finalChain} --interval 5`));
  } catch (err) {
    execSpinner.fail('Execution failed');
    const raw = err.stdout?.toString() || err.stderr?.toString() || err.message;
    console.log(chalk.red(`✗ Execution failed: ${raw}`));
    console.log(chalk.gray('Quote may have expired. Try again with a fresh quote.'));
  }

  // 10. Return
  return { score, passed: score < threshold, quoteId, txHash };
}
