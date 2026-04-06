import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner } from './display.js';
import scoreToken from './score.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function logDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function runWatch(token, chain, options = {}) {
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
  const threshold     = options.threshold ?? config.riskThreshold ?? 60;
  const interval      = options.interval  ?? config.watchInterval  ?? 5;
  const apiKey        = options.apiKey || config.apiKey || process.env.NANSEN_API_KEY;

  // 2. No API key
  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // 3. Set up log file
  const tokenShort = token.slice(0, 8);
  const logDir     = path.join(os.homedir(), '.nanshield', 'logs');
  const logFile    = `${tokenShort}_${finalChain}_${logDate()}.log`;
  const logPath    = path.join(logDir, logFile);

  await fs.ensureDir(logDir);

  console.log(chalk.cyan(`Watch mode started. Logging to ${logPath}`));
  console.log(chalk.gray(`Polling every ${interval} minutes. Ctrl+C to stop.`));

  // 4. Banner
  printBanner();

  let previousScore = null;

  // 5. runScan
  async function runScan() {
    const ts = timestamp();

    const spinner = ora({ text: 'Scanning...', isSilent: false }).start();
    let result;
    try {
      result = await scoreToken(token, finalChain, apiKey);
    } catch (err) {
      spinner.stop();
      const errLine = `[${ts}] ERROR — ${err.message}`;
      console.log(chalk.red(errLine));
      await fs.appendFile(logPath, errLine + '\n');
      return;
    }
    spinner.stop();

    const { score, flags } = result;
    const isBlocked = score >= threshold;
    const topDetail = flags?.[0]?.detail ?? 'No flags';
    const statusIcon  = isBlocked ? '⛔' : '✅';
    const statusLabel = isBlocked ? 'ALERT  ' : 'SAFE   ';

    const logLine = `[${ts}] Score: ${score} ${statusIcon} ${statusLabel} — ${topDetail}`;

    // Print to terminal with colour
    console.log(isBlocked ? chalk.red(logLine) : chalk.green(logLine));

    // Threshold crossing
    if (previousScore !== null && previousScore < threshold && score >= threshold) {
      const crossLine = `[${ts}] >>> THRESHOLD CROSSED: was ${previousScore}, now ${score}`;
      console.log(chalk.bgRed.white(` ⚠ ALERT ⚠ `) + chalk.red(' Risk threshold crossed. Check your position.'));
      console.log(chalk.red(crossLine));
      await fs.appendFile(logPath, crossLine + '\n');
      await fs.appendFile(logPath, `[${ts}] ⚠ ALERT — Risk threshold crossed\n`);
    }

    // Append plain log line (no chalk escape codes)
    await fs.appendFile(logPath, logLine + '\n');

    previousScore = score;
  }

  // 6. Run immediately, then on interval
  await runScan();
  setInterval(runScan, interval * 60 * 1000);

  // 7. Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow(`\nWatch stopped. Log saved to ${logPath}`));
    process.exit(0);
  });
}
