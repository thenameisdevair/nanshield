import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { printBanner, printScoreBar, printFlags, printVerdict, writeReport } from './display.js';
import scoreToken from './score.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

const CALL_LABELS = [
  'token info',
  'token flows',
  'who-bought-sold',
  'token holders',
  'sm netflow',
  'sm holdings',
  'sm dex-trades',
  'profiler labels',
  'profiler pnl',
  'profiler txns',
];

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
  console.log(chalk.cyan(`Scanning ${token} on ${finalChain}...`));
  const spinner = ora('Running 10 Nansen API calls...').start();
  const scanStart = Date.now();

  // 5. Score
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

  // 6. Score bar, flags, verdict
  printScoreBar(result.score, threshold);
  printFlags(result.flags);
  printVerdict(result.score, threshold);

  // 7. Call log table
  console.log(chalk.bold('\nAPI CALL LOG'));
  result.callLog.forEach(({ callNum, status, ms }, i) => {
    const label = (CALL_LABELS[i] ?? `call ${callNum}`).padEnd(20);
    const icon  = status === 'ok' ? chalk.green('✓') : chalk.red('✗');
    console.log(`  [${String(callNum).padStart(2)}] ${label} ${icon}  ${ms}ms`);
  });

  // 8. Write report
  const verdict = result.score >= threshold ? 'BLOCKED' : 'CLEARED';
  if (options.report) {
    const outputPath = './NANSHIELD-REPORT.md';
    writeReport(token, finalChain, result.score, result.flags, verdict, result.callLog, outputPath);
  }

  // 9. Deep AI assessment
  if (options.deep) {
    console.log(chalk.bold('\nAI ASSESSMENT'));
    const deepSpinner = ora('Querying Nansen agent...').start();
    try {
      const question = `Does token ${token} on ${finalChain} show rug pull or dump warning signs based on recent smart money activity?`;
      const response = execSync(
        `nansen agent "${question.replace(/"/g, '\\"')}"`,
        { env: { ...process.env, NANSEN_API_KEY: apiKey }, stdio: 'pipe', timeout: 60000 }
      ).toString().trim();
      deepSpinner.stop();
      console.log(chalk.yellow(`AI Assessment: ${response}`));
    } catch {
      deepSpinner.fail('Agent query failed');
    }
  }

  return { score: result.score, flags: result.flags, passed: result.score < threshold };
}
