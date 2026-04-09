import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner } from './display.js';
import scoreToken from './score.js';
import { sendAlert } from './telegram.js';

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
  const useTg      = options.tg ?? false;
  const useDetach  = options.detach ?? false;

  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // ── --tg flag: validate TG configured before starting loop ───────────────
  if (useTg) {
    let cfg = {};
    try { cfg = await fs.readJson(CONFIG_PATH); } catch {}
    if (!cfg.tgBotToken || !cfg.tgChatId) {
      console.log(chalk.red('✗ Telegram not configured. Run: nanshield setup'));
      console.log(chalk.gray('  Then re-run with --tg once credentials are saved.'));
      process.exit(1);
    }
  }

  // ── --detach flag: spawn via pm2 ─────────────────────────────────────────
  if (useDetach) {
    // Check pm2 is installed
    try {
      execSync('pm2 --version', { stdio: 'pipe' });
    } catch {
      console.log(chalk.red('pm2 required for detached mode. Install: npm install -g pm2'));
      process.exit(1);
    }

    const tokenShortDetach = token.slice(0, 8);
    const pm2Name = `nanshield-${tokenShortDetach}-${finalChain}`;

    // Check for existing pm2 process
    try {
      const listOut = execSync(`pm2 jlist`, { stdio: 'pipe' }).toString();
      const procs = JSON.parse(listOut);
      const existing = procs.find(p => p.name === pm2Name);
      if (existing) {
        console.log(chalk.yellow(`Already monitoring this token. Run: pm2 list`));
        process.exit(0);
      }
    } catch { /* pm2 jlist may fail if no processes; that's OK */ }

    // Build the command minus --detach
    const args = process.argv.slice(2).filter(a => a !== '--detach');
    const nodeExe = process.execPath;
    const scriptPath = new URL(import.meta.url).pathname;
    const pm2Cmd = [
      'pm2', 'start', nodeExe,
      `--name "${pm2Name}"`,
      '--',
      scriptPath,
      ...args,
    ].join(' ');

    try {
      execSync(pm2Cmd, { stdio: 'inherit' });
      console.log(chalk.green('NanShield monitoring started (detached)'));
      console.log(chalk.cyan(`Process: ${pm2Name}`));
      console.log(chalk.gray(`View logs: pm2 logs ${pm2Name}`));
      console.log(chalk.gray(`Stop:     pm2 stop ${pm2Name}`));
    } catch (err) {
      console.log(chalk.red(`pm2 spawn failed: ${err.message}`));
      process.exit(1);
    }
    process.exit(0);
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
  let scanInProgress = false;    // concurrent scan lock
  let consecutiveNullCount = 0;  // health check counter

  // Extract token symbol for TG alerts
  let tokenSymbol = token.slice(0, 8);

  async function runScan() {
    // Concurrent scan lock
    if (scanInProgress) {
      const ts = timestamp();
      const skipLine = `[${ts}] Scan skipped — previous scan still running`;
      console.log(chalk.gray(skipLine));
      try { await fs.appendFile(logPath, skipLine + '\n'); } catch {}
      return;
    }

    scanInProgress = true;
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
      try { await fs.appendFile(logPath, errLine + '\n'); } catch {}
      scanInProgress = false;
      return;
    }
    spinner.stop();

    // ── Health check: auth error ─────────────────────────────────────────
    if (result.callLog) {
      const authFailed = result.callLog.some(c =>
        c.status === 'failed' && /unauthorized|401|invalid.*key|api.*key/i.test(c.error || '')
      );
      if (authFailed) {
        console.log(chalk.red('✗ Nansen API auth error. Stopping watch.'));
        if (useTg) {
          await sendAlert('MONITORING_STOPPED', { symbol: tokenSymbol, chain: finalChain, reason: 'API key invalid', token });
        }
        process.exit(1);
      }
    }

    // ── Health check: token no longer indexed ────────────────────────────
    const tokenInfoEmpty = !result.tokenInfo?.name || result.tokenInfo.name === 'Unknown';
    if (tokenInfoEmpty) {
      consecutiveNullCount++;
      if (consecutiveNullCount >= 3) {
        console.log(chalk.red('✗ Token no longer indexed. Stopping watch.'));
        if (useTg) {
          await sendAlert('MONITORING_STOPPED', { symbol: tokenSymbol, chain: finalChain, reason: 'Token no longer indexed', token });
        }
        process.exit(1);
      }
    } else {
      consecutiveNullCount = 0;
      tokenSymbol = result.tokenInfo?.symbol || tokenSymbol;
    }

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
      console.log(chalk.bgRed.white(` ⚠ ALERT ⚠ `) + chalk.red(' Risk threshold crossed. Check your position.'));
      console.log(chalk.red(`           >>> Score crossed ${threshold}. Review your position immediately.`));
    }

    // ── Telegram alerts ──────────────────────────────────────────────────
    if (useTg && thresholdCrossed) {
      await sendAlert('THRESHOLD_CROSSED', {
        symbol: tokenSymbol, chain: finalChain, scanNum,
        oldScore: previousScore, newScore: score, threshold,
        deltas: deltas || [], token,
      });
    } else if (useTg && hasChanges && !isBlocked) {
      await sendAlert('FACTOR_CHANGED', {
        symbol: tokenSymbol, chain: finalChain, score, deltas, token,
      });
    }

    // Log file entry
    let logLine = `[${ts}] score=${score} verdict=${statusLabel}`;
    if (deltaLogParts.length) logLine += ` deltas=[${deltaLogParts.join(',')}]`;
    if (thresholdCrossed) logLine += ` THRESHOLD_CROSSED`;
    try { await fs.appendFile(logPath, logLine + '\n'); } catch {}

    previousScore   = score;
    previousFactors = factors;
    scanInProgress  = false;
  }

  // Run immediately, then on interval
  await runScan();
  setInterval(runScan, interval * 60 * 1000);

  process.on('SIGINT', () => {
    console.log(chalk.yellow(`\nWatch stopped. Log saved to ${logPath}`));
    process.exit(0);
  });
}
