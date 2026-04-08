#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

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

// ── 8-factor score breakdown table ───────────────────────────────────────────
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

// Kept for backward compatibility (used by watch.js)
export function printFlags(flags) {
  if (!flags || flags.length === 0) return;
  console.log(chalk.bold('\nRISK FLAGS'));
  for (const { emoji, label, detail, points, max } of flags) {
    const paddedLabel = label.padEnd(24);
    const pts = points > 0 ? chalk.red(`+${points}${max ? `/${max}` : ''}pts`) : chalk.green(`${points}pts`);
    console.log(`${emoji} ${chalk.bold(paddedLabel)} ${detail.padEnd(44)} ${pts}`);
  }
}

export function printVerdict(score, threshold) {
  const isBlocked = score >= threshold;
  console.log('');
  if (isBlocked) {
    console.log(chalk.red(`⛔ TRADE BLOCKED — Score exceeds threshold (${threshold}). Use --force to override.`));
  } else {
    console.log(chalk.green(`✅ TRADE CLEARED — Risk score within safe threshold.`));
  }
}

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

  const researchCalls = callLog.filter(c => typeof c.callNum === 'number' && c.callNum >= 1 && c.callNum <= 13);
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

  // Chunk endpoint names for wrapping
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

// ── Markdown report writer ────────────────────────────────────────────────────
export function writeReport(token, chain, score, factors, verdict, callLog = [], outputPath = './NANSHIELD-REPORT.md', agentText = null) {
  const timestamp = new Date().toISOString();
  const isBlocked = verdict === 'BLOCKED';

  const verdictLine = isBlocked
    ? `⛔ **TRADE BLOCKED** — Score exceeds threshold. Use \`--force\` to override.`
    : `✅ **TRADE CLEARED** — Risk score within safe threshold.`;

  // ── API call log table ──────────────────────────────────────────────────
  const callRows = (callLog || []).map(({ callNum, command, status, summary, ms }) => {
    const numStr = callNum === 'S' ? 'S' : String(callNum).padStart(2);
    const cmdShort = (command || '').length > 70 ? command.slice(0, 67) + '...' : command;
    const icon = status === 'ok' ? '✓' : '✗';
    return `| ${numStr} | \`${cmdShort}\` | ${icon} | ${summary || ''} |`;
  }).join('\n');

  // ── Factor table ────────────────────────────────────────────────────────
  const factorRows = (factors || []).map(f =>
    `| ${f.name} | ${f.score} | ${f.max} | ${f.detail} |`
  ).join('\n');
  const total = (factors || []).reduce((s, f) => s + f.score, 0);

  // ── Deep analysis section ───────────────────────────────────────────────
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
${deepSection}
---

*Generated by NanShield v2.0.0 — Security-gated DEX execution powered by Nansen onchain intelligence.*
*nansen-trading skill: https://clawhub.ai/nansen-devops/nansen-trading*
*GitHub: https://github.com/thenameisdevair/nanshield*
`;

  const resolvedPath = path.resolve(outputPath);
  fs.outputFileSync(resolvedPath, report);
  console.log(chalk.cyan(`\nReport written to ${resolvedPath}`));
}
