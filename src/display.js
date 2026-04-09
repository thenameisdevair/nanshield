#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// ── Animation control ─────────────────────────────────────────────────────────
// Disable animation if: --no-animation flag, or not a TTY (piped/VPS)
export function isAnimated(argv) {
  if (!process.stdout.isTTY) return false;
  if (argv && argv.noAnimation) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Backward-compat banner (used by watch.js, setup.js) ─────────────────────
export function printBanner() {
  console.log(chalk.cyan(`
███╗   ██╗ █████╗ ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗
████╗  ██║██╔══██╗████╗  ██║██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗
██╔██╗ ██║███████║██╔██╗ ██║██║  ███╗██║   ██║███████║██████╔╝██║  ██║
██║╚██╗██║██╔══██║██║╚██╗██║██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║
██║ ╚████║██║  ██║██║ ╚████║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
`));
}

// ── Animated header block ─────────────────────────────────────────────────────
export async function printHeader(symbol, chain, animated = true) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const header = `🛡 NANSHIELD v2  ◆  $${symbol}  ◆  ${chain.toUpperCase()}  ◆  ${ts}`;
  const sep = '━'.repeat(Math.min(header.length, 72));

  if (animated) {
    process.stdout.write('\n');
    await sleep(80);
    console.log(chalk.cyan.bold(header));
    await sleep(80);
    console.log(chalk.gray(sep));
    await sleep(80);
  } else {
    console.log('\n' + chalk.cyan.bold(header));
    console.log(chalk.gray(sep));
  }
}

// ── Per-call progress line ────────────────────────────────────────────────────
// Called externally after each API call completes.
export async function printCallLine(callNum, total, label, ok, summary = '', animated = true) {
  const numStr = String(callNum).padStart(2, '0');
  const totalStr = String(total);
  const icon = ok ? chalk.green('✓') : chalk.red('✗');
  const paddedLabel = label.padEnd(20);
  const summaryStr = summary ? chalk.gray(`  ${summary}`) : '';
  const notOkStr = !ok ? chalk.red('  UNSCORED — API error') : '';
  const line = ` [${numStr}/${totalStr}] ${paddedLabel} ${icon}${summaryStr}${notOkStr}`;

  if (animated) await sleep(120);
  console.log(line);
}

// ── Animated factor progress bar ──────────────────────────────────────────────
async function printFactorBar(factor, animated = true) {
  const BAR_WIDTH = 20;
  const { name, score, max, label } = factor;
  const ratio = max > 0 ? score / max : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);

  const barColor = score === 0 ? chalk.green : ratio > 0.5 ? chalk.red : chalk.yellow;
  const labelStr = score === 0 ? chalk.green('CLEAR') : ratio > 0.5 ? chalk.red('HIGH') : chalk.yellow('moderate');

  const nameStr = name.padEnd(22);
  const scoreStr = `${score}/${max}`.padStart(6);

  if (animated) {
    // Animate bar filling left-to-right over 200ms
    const steps = 5;
    const stepMs = 200 / steps;
    for (let s = 1; s <= steps; s++) {
      const f = Math.round((filled * s) / steps);
      const partialBar = '█'.repeat(f) + '░'.repeat(BAR_WIDTH - f);
      process.stdout.write(`\r  ${nameStr} ${barColor(partialBar)} ${scoreStr}  ${labelStr}  `);
      await sleep(stepMs);
    }
    process.stdout.write('\n');
  } else {
    console.log(`  ${nameStr} ${barColor(bar)} ${scoreStr}  ${labelStr}`);
  }
}

// ── Score section: 8 factors ──────────────────────────────────────────────────
export async function printFactorsAnimated(factors, animated = true) {
  const sep = '━'.repeat(72);
  if (animated) await sleep(100);
  console.log(chalk.gray(sep));
  console.log(chalk.bold('\n  SCORING 8 RISK FACTORS\n'));

  for (const factor of factors) {
    await printFactorBar(factor, animated);
  }
  console.log('');
}

// ── Final score verdict ───────────────────────────────────────────────────────
export async function printVerdictAnimated(score, animated = true) {
  const sep = '━'.repeat(72);
  if (animated) await sleep(120);
  console.log(chalk.gray(sep));
  if (animated) await sleep(200);

  if (score < 40) {
    console.log(chalk.green.bold(`
  ██████╗██╗     ███████╗ █████╗ ██████╗ ███████╗██████╗
 ██╔════╝██║     ██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗
 ██║     ██║     █████╗  ███████║██████╔╝█████╗  ██║  ██║
 ██║     ██║     ██╔══╝  ██╔══██║██╔══██╗██╔══╝  ██║  ██║
 ╚██████╗███████╗███████╗██║  ██║██║  ██║███████╗██████╔╝
  ╚═════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
  Score: ${score}/100 — Trade is cleared.`));
  } else if (score < 60) {
    console.log(chalk.yellow.bold(`
  CLEARED WITH CAUTION — Score: ${score}/100
  Risk factors present but below threshold. Proceed carefully.`));
  } else if (score < 80) {
    console.log(chalk.red.bold(`
  BLOCKED — Score: ${score}/100
  Risk threshold exceeded. Use --force to override at your own risk.`));
  } else {
    console.log(chalk.red.bold(`
  ╔═══════════════════════════════════════════╗
  ║  CRITICAL — DO NOT TRADE — Score: ${String(score).padEnd(3)}/100  ║
  ║  Severe risk signals detected.            ║
  ╚═══════════════════════════════════════════╝`));
  }
  console.log('');
}

// ── AI agent synthesis ────────────────────────────────────────────────────────
export function printAgentSynthesis(agentText) {
  if (!agentText) return;
  console.log(chalk.yellow.bold('🤖 AI Risk Assessment:'));
  console.log(chalk.yellow(agentText));
  console.log('');
}

// ── Trade quote block ─────────────────────────────────────────────────────────
export function printQuoteBlock(quote) {
  if (!quote) return;
  console.log(chalk.bold.cyan('\n  Trade Quote'));
  console.log(chalk.gray('  ' + '─'.repeat(48)));
  if (quote.spend)       console.log(`  Spend:        ${chalk.white(quote.spend)}`);
  if (quote.receive)     console.log(`  Receive:      ${chalk.white(quote.receive)}`);
  if (quote.priceImpact) console.log(`  Price Impact: ${chalk.white(quote.priceImpact)}`);
  if (quote.route)       console.log(`  Route:        ${chalk.white(quote.route)}`);
  console.log('');
  console.log(chalk.yellow('  Execute? [Y/n]'));
}

// ── Advisor block (borderline 40-79) ─────────────────────────────────────────
export function printAdvisorBlock(advisorText) {
  if (!advisorText) return;
  console.log(advisorText);
}

// ── Backward-compat: printScoreBar ────────────────────────────────────────────
export function printScoreBar(score, threshold) {
  const BAR_WIDTH = 20;
  const filled = Math.round((score / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const isBlocked = score >= threshold;
  const label = isBlocked ? 'HIGH RISK - TRADE BLOCKED' : 'LOW RISK - TRADE CLEARED';
  const color = isBlocked ? chalk.red : chalk.green;

  console.log(chalk.bold('\nNANSHIELD RISK SCORE'));
  console.log(color(`${bar}  ${score}/100  [${label}]`));
}

// ── Backward-compat: printScoreBreakdown ─────────────────────────────────────
export function printScoreBreakdown(factors) {
  if (!factors || factors.length === 0) return;

  const INNER = 45;
  const border = '─'.repeat(INNER + 2);

  console.log('');
  console.log(`┌${border}┐`);

  for (const f of factors) {
    const scoreStr = `${f.score}/${f.max}`;
    const name = f.name.padEnd(24);
    const scored = scoreStr.padStart(5);
    const lbl = f.label ? `  ${f.label}` : '';
    const line = `  ${name} ${scored}${lbl}`;
    const padded = line.padEnd(INNER);
    const color = f.score === 0 ? chalk.green : f.score >= f.max * 0.75 ? chalk.red : chalk.yellow;
    console.log(`│${color(padded)} │`);
  }

  const total = factors.reduce((s, f) => s + f.score, 0);
  const totalStr = `  ${'TOTAL'.padEnd(24)} ${String(total).padStart(3)}/100`;
  console.log(`├${'─'.repeat(INNER + 2)}┤`);
  console.log(`│${chalk.bold(totalStr.padEnd(INNER))} │`);
  console.log(`└${border}┘`);
}

// ── Backward-compat: printFlags ───────────────────────────────────────────────
export function printFlags(flags) {
  if (!flags || flags.length === 0) return;
  console.log(chalk.bold('\nRISK FLAGS'));
  for (const { emoji, label, detail, points, max } of flags) {
    const paddedLabel = label.padEnd(24);
    const pts = points > 0 ? chalk.red(`+${points}${max ? `/${max}` : ''}pts`) : chalk.green(`${points}pts`);
    console.log(`${emoji} ${chalk.bold(paddedLabel)} ${detail.padEnd(44)} ${pts}`);
  }
}

// ── Backward-compat: printVerdict ─────────────────────────────────────────────
export function printVerdict(score, threshold) {
  const isBlocked = score >= threshold;
  console.log('');
  if (isBlocked) {
    console.log(chalk.red(`⛔ TRADE BLOCKED — Score exceeds threshold (${threshold}). Use --force to override.`));
  } else {
    console.log(chalk.green(`✅ TRADE CLEARED — Risk score within safe threshold.`));
  }
}

// ── Backward-compat: printWatchAlert ─────────────────────────────────────────
export function printWatchAlert(timestamp, score, threshold, change) {
  const isBlocked = score >= threshold;
  const timeStr = new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
  const icon = isBlocked ? '⛔' : '✅';
  const direction = change >= 0 ? '+' : '';
  const msg = `[${timeStr}] Score: ${score} ${icon} ALERT — SM holdings dropped ${direction}${change}% in 5min`;
  console.log(isBlocked ? chalk.red(msg) : chalk.yellow(msg));
}

// ── API call proof summary ────────────────────────────────────────────────────
export function printApiCallProof(callLog, tradeMode = false) {
  if (!callLog || callLog.length === 0) return;

  const researchCalls = callLog.filter(c => typeof c.callNum === 'number' && c.callNum >= 1 && c.callNum <= 14);
  const tradeCalls    = callLog.filter(c => c.callNum === 'Q' || c.callNum === 'E' || c.command?.includes('nansen trade'));
  const agentCalls    = callLog.filter(c => c.callNum === 0 || c.command?.includes('nansen agent'));

  const totalR = researchCalls.length;
  const totalT = tradeCalls.length;
  const totalA = agentCalls.length;
  const total  = totalR + totalT + totalA;

  const parts = [`${totalR} research`];
  if (totalA) parts.push(`${totalA} agent`);
  if (totalT) parts.push(`${totalT} trade`);

  const endpointNames = researchCalls
    .map(c => {
      const m = c.command?.match(/nansen research (\S+) (\S+)/);
      return m ? `${m[1]}-${m[2]}` : null;
    })
    .filter(Boolean);

  if (tradeMode) {
    tradeCalls.forEach(c => {
      const m = c.command?.match(/nansen trade (\S+)/);
      if (m) endpointNames.push(`trade-${m[1]}`);
    });
  }

  const DIVIDER = '─'.repeat(58);
  console.log('');
  console.log(chalk.gray(DIVIDER));
  console.log(chalk.bold(`  Nansen API Calls: ${parts.join(' + ')} = ${total} total`));

  const MAX_LINE = 56;
  let line = '  Unique endpoints: ';
  const epLines = [];
  for (const ep of endpointNames) {
    if ((line + ep + ', ').length > MAX_LINE) {
      epLines.push(line.replace(/,\s*$/, ''));
      line = '    ' + ep + ', ';
    } else {
      line += ep + ', ';
    }
  }
  if (line.trim().length > 0) epLines.push(line.replace(/,\s*$/, ''));
  epLines.forEach(l => console.log(chalk.gray(l)));

  if (tradeMode) {
    console.log(chalk.cyan('  Bonus skill: nansen-trading (clawhub.ai/nansen-devops/nansen-trading)'));
  }
  console.log(chalk.gray(DIVIDER));
  console.log('');
}

// ── Markdown report writer (with optional HTML report + advisor section) ──────
export async function writeReportFull(token, chain, score, factors, verdict, callLog = [], outputPath = './NANSHIELD-REPORT.md', agentText = null, scanData = null) {
  // Generate HTML report alongside markdown when scanData is provided
  if (scanData) {
    try {
      const { generate } = await import('./htmlReport.js');
      await generate(scanData);
    } catch (e) {
      console.error(`HTML report generation failed: ${e.message}`);
    }
  }

  // Advisor section if score is 40-79
  let advisorSection = '';
  if (score >= 40 && score <= 79) {
    try {
      const { advisePlain } = await import('./advisor.js');
      const advisorText = advisePlain(score, factors, token, chain);
      if (advisorText) {
        advisorSection = `\n---\n\n## Path To Clearance\n\n\`\`\`\n${advisorText}\n\`\`\`\n`;
      }
    } catch {}
  }

  writeReport(token, chain, score, factors, verdict, callLog, outputPath, agentText, advisorSection);
}

export function writeReport(token, chain, score, factors, verdict, callLog = [], outputPath = './NANSHIELD-REPORT.md', agentText = null, advisorSection = '') {
  const timestamp = new Date().toISOString();
  const isBlocked = verdict === 'BLOCKED';

  const verdictLine = isBlocked
    ? `⛔ **TRADE BLOCKED** — Score exceeds threshold. Use \`--force\` to override.`
    : `✅ **TRADE CLEARED** — Risk score within safe threshold.`;

  const callRows = (callLog || []).map(({ callNum, command, status, summary, ms }) => {
    const numStr = callNum === 'S' ? 'S' : String(callNum).padStart(2);
    const cmdShort = (command || '').length > 70 ? command.slice(0, 67) + '...' : command;
    const icon = status === 'ok' ? '✓' : '✗';
    return `| ${numStr} | \`${cmdShort}\` | ${icon} | ${summary || ''} |`;
  }).join('\n');

  const factorRows = (factors || []).map(f =>
    `| ${f.name} | ${f.score} | ${f.max} | ${f.detail} |`
  ).join('\n');
  const total = (factors || []).reduce((s, f) => s + f.score, 0);

  const deepSection = agentText ? `
---

## Deep Analysis (nansen agent)

${agentText}
` : '';

  const report = `# NanShield Security Report

**Token**: \`${token}\`
**Chain**: ${chain}
**Scanned**: ${timestamp}
**NanShield Version**: 2.0.0
**Risk Score**: ${score}/100 — ${verdict}

---

## API Call Log

| # | Nansen CLI Command | Status | Key Finding |
|---|-------------------|--------|-------------|
${callRows}

**Total API calls**: ${callLog.length} (${callLog.filter(c => c.status === 'ok').length} succeeded)

---

## Risk Score Breakdown

| Factor | Score | Max | Assessment |
|--------|-------|-----|-----------|
${factorRows}
| **TOTAL** | **${total}** | **100** | **${verdict}** |

---

## Verdict

${verdictLine}
${deepSection}${advisorSection}---

*Generated by NanShield v2.0.0 — Security-gated DEX execution powered by Nansen onchain intelligence.*
*nansen-trading skill: https://clawhub.ai/nansen-devops/nansen-trading*
*GitHub: https://github.com/thenameisdevair/nanshield*
`;

  const resolvedPath = path.resolve(outputPath);
  fs.outputFileSync(resolvedPath, report);
  console.log(chalk.cyan(`\nReport written to ${resolvedPath}`));
}
