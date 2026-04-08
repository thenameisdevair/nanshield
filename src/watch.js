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

// ── Delta computation ─────────────────────────────────────────────────────────
function computeDeltas(currentFactors, previousFactors) {
  if (!previousFactors) return null;
  const deltas = [];
  for (const current of currentFactors) {
    const prev = previousFactors.find(f => f.name === current.name);
    if (prev && current.score !== prev.score) {
      deltas.push({
        name: current.name,
        previous: prev.score,
        current: current.score,
        delta: current.score - prev.score,
        detail: current.detail,
      });
    }
  }
  return deltas;
}

export default async function runWatch(token, chain, options = {}) {
  // 1. Load config
  let config = {};
  try {
    if (await fs.pathExists(CONFIG_PATH)) config = await fs.readJson(CONFIG_PATH);
  } catch {}

  const finalChain = chain || config.defaultChain || 'base';
  const threshold  = options.threshold ?? config.riskThreshold ?? 60;
  const interval   = options.interval  ?? config.watchInterval  ?? 5;
  const apiKey     = options.apiKey || config.apiKey || process.env.NANSEN_API_KEY;

  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // 2. Log file setup
  const tokenShort = token.slice(0, 8);
  const logDir  = path.join(os.homedir(), '.nanshield', 'logs');
  const logFile = `${tokenShort}_${finalChain}_${logDate()}.log`;
  const logPath = path.join(logDir, logFile);
  await fs.ensureDir(logDir);

  console.log(chalk.cyan(`Watch mode started. Logging to ${logPath}`));
  console.log(chalk.gray(`Polling every ${interval} minutes. Ctrl+C to stop.`));
  printBanner();

  let previousScore    = null;
  let previousFactors  = null;
  let lastKnownScores  = {};
  let scanNum = 0;

  async function runScan() {
    scanNum++;
    const ts = timestamp();
    const spinner = ora({ text: 'Scanning...', isSilent: false }).start();

    let result;
    try {
      result = await scoreToken(token, finalChain, apiKey, false, null, lastKnownScores);
    } catch (err) {
      spinner.stop();
      const errLine = `[${ts}] ERROR — ${err.message}`;
      console.log(chalk.red(errLine));
      await fs.appendFile(logPath, errLine + '\n');
      return;
    }
    spinner.stop();

    lastKnownScores = result.lastKnownScores ?? lastKnownScores;
    const { score, factors } = result;
    const isBlocked = score >= threshold;
    const statusIcon  = isBlocked ? '⛔' : '✅';
    const statusLabel = isBlocked ? 'ALERT' : 'SAFE';

    // Delta computation
    const deltas = computeDeltas(factors, previousFactors);
    const hasChanges = deltas && deltas.length > 0;
    const thresholdCrossed = previousScore !== null && previousScore < threshold && score >= threshold;

    // Build terminal output
    let termLine = `[${ts}] Scan #${scanNum} — Score: ${score}/100 ${statusIcon} ${statusLabel}`;
    if (!hasChanges && previousScore !== null) {
      termLine += ' — No change';
    } else if (hasChanges) {
      termLine += ` — ⚠ ${deltas.length} factor${deltas.length > 1 ? 's' : ''} changed:`;
    }

    console.log(isBlocked ? chalk.red(termLine) : chalk.green(termLine));

    // Print deltas
    const deltaLogParts = [];
    if (hasChanges) {
      for (const d of deltas) {
        const arrow = d.delta > 0 ? '↑' : '↓';
        const sign = d.delta > 0 ? '+' : '';
        const deltaLine = `           ${arrow} ${d.name}: ${d.previous} → ${d.current} (${sign}${d.delta}) — ${d.detail}`;
        console.log(d.delta > 0 ? chalk.yellow(deltaLine) : chalk.green(deltaLine));
        deltaLogParts.push(`${d.name.replace(/ /g, '_')}:${d.previous}→${d.current}`);
      }
    }

    if (thresholdCrossed) {
      const crossLine = `           >>> Score crossed ${threshold}. Review your position immediately.`;
      console.log(chalk.bgRed.white(` ⚠ ALERT ⚠ `) + chalk.red(' Risk threshold crossed. Check your position.'));
      console.log(chalk.red(crossLine));
    }

    // Log file entry
    let logLine = `[${ts}] score=${score} verdict=${statusLabel}`;
    if (deltaLogParts.length) logLine += ` deltas=[${deltaLogParts.join(',')}]`;
    if (thresholdCrossed) logLine += ` THRESHOLD_CROSSED`;
    await fs.appendFile(logPath, logLine + '\n');

    previousScore   = score;
    previousFactors = factors;
  }

  // Run immediately, then on interval
  await runScan();
  setInterval(runScan, interval * 60 * 1000);

  process.on('SIGINT', () => {
    console.log(chalk.yellow(`\nWatch stopped. Log saved to ${logPath}`));
    process.exit(0);
  });
}
