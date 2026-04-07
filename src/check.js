import os from 'os';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { printBanner, printScoreBar, printFlags, printVerdict, writeReport } from './display.js';
import scoreToken from './score.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

const CALL_LABELS = {
  0:  'nansen agent',
  1:  'token info',
  2:  'who-bought-sold',
  3:  'profiler counterparties',
  4:  'profiler pnl',
  5:  'profiler txns',
  6:  'token holders',
  7:  'sm dex-trades',
  8:  'sm netflow',
  9:  'token flows',
  10: 'sm holdings',
};

export default async function runCheck(token, chain, options = {}) {
  // 1. Load config and merge with CLI options
  let config = {};
  try {
    if (await fs.pathExists(CONFIG_PATH)) {
      config = await fs.readJson(CONFIG_PATH);
    }
  } catch {
    // config unreadable — proceed with defaults
  }

  const finalChain     = chain || config.defaultChain || 'base';
  const threshold      = options.threshold ?? config.riskThreshold ?? 60;
  const apiKey         = options.apiKey || config.apiKey || process.env.NANSEN_API_KEY;

  // 2. No API key
  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // 3. Banner
  printBanner();

  // 4. Status line + spinner
  const callCount = options.deep ? '11' : '10';
  console.log(chalk.cyan(`Scanning ${token} on ${finalChain}...`));
  const spinner = ora(`Running ${callCount} Nansen API calls...`).start();
  const scanStart = Date.now();

  // 5. Score (pass deep flag — agent call runs inside scoreToken if deep)
  let result;
  try {
    result = await scoreToken(token, finalChain, apiKey, options.deep ?? false);
  } catch (err) {
    spinner.fail('Scan failed');
    console.log(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }

  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  const succeeded = result.callLog.filter((c) => c.status === 'ok').length;
  spinner.succeed(chalk.gray(`Completed in ${elapsed}s — ${succeeded}/${callCount} calls succeeded`));

  // 6. Agent assessment (deep mode) — shown before score bar
  if (result.agentAssessment) {
    console.log(chalk.yellow.bold('\n🤖 AI Risk Assessment:'));
    console.log(chalk.yellow(result.agentAssessment));
    console.log('');
  }

  // 7. Score bar, flags, verdict
  printScoreBar(result.score, threshold);
  printFlags(result.flags);
  printVerdict(result.score, threshold);

  // 8. Call log table
  console.log(chalk.bold('\nAPI CALL LOG'));
  result.callLog.forEach(({ callNum, status, ms }) => {
    const label = (CALL_LABELS[callNum] ?? `call ${callNum}`).padEnd(24);
    const icon  = status === 'ok' ? chalk.green('✓') : chalk.red('✗');
    console.log(`  [${String(callNum).padStart(2)}] ${label} ${icon}  ${ms}ms`);
  });

  // 9. Write report
  const verdict = result.score >= threshold ? 'BLOCKED' : 'CLEARED';
  if (options.report) {
    const outputPath = './NANSHIELD-REPORT.md';
    writeReport(token, finalChain, result.score, result.flags, verdict, result.callLog, outputPath);
  }

  // 10. What next?
  console.log(chalk.yellow('\nWhat you can do:'));
  if (verdict === 'CLEARED') {
    console.log(chalk.gray(`  • Execute a trade:    nanshield trade ${token} --chain ${finalChain} --amount <n> --execute`));
    console.log(chalk.gray(`  • Watch this token:   nanshield watch ${token} --chain ${finalChain} --interval 5`));
    console.log(chalk.gray(`  • Deep AI analysis:   nanshield check ${token} --chain ${finalChain} --deep`));
    console.log(chalk.gray(`  • Save full report:   nanshield check ${token} --chain ${finalChain} --report`));
  } else {
    console.log(chalk.gray(`  • Save risk report:   nanshield check ${token} --chain ${finalChain} --report`));
    console.log(chalk.gray(`  • Deep AI analysis:   nanshield check ${token} --chain ${finalChain} --deep`));
    console.log(chalk.gray(`  • Force trade anyway: nanshield trade ${token} --chain ${finalChain} --amount <n> --execute --force`));
    console.log(chalk.gray(`  • Adjust threshold:   nanshield check ${token} --chain ${finalChain} --threshold 75`));
  }

  return { score: result.score, flags: result.flags, passed: result.score < threshold };
}
