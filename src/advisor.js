import chalk from 'chalk';

// ── advisor.js — fires only when score is 40-79 inclusive ────────────────────
// Returns formatted terminal string or null if out of range.

function conditionForFactor(factor) {
  const { name, score, max, detail } = factor;
  if (score === 0) return null;

  switch (name) {
    case 'Age & Liquidity': {
      const liquMatch = detail?.match(/\$([\d,.]+[kKmMbB]?)/i);
      const liq = liquMatch ? liquMatch[0] : 'unknown liquidity';
      if (/low liquidity/i.test(detail)) {
        return `Liquidity is ${liq}. Wait for it to reach $100k before reconsidering. ` +
               `Current trajectory: check 7d flow data to determine if increasing or decreasing.`;
      }
      const dayMatch = detail?.match(/(\d+)\s*d(?:ay)?/i);
      const days = dayMatch ? parseInt(dayMatch[1]) : '?';
      return `Token is ${days} days old. This flag clears automatically at 30 days if other factors remain clean.`;
    }

    case 'Buyer Profile': {
      const pctMatch = detail?.match(/(\d+)%/);
      const pct = pctMatch ? pctMatch[1] : '?';
      const hasSm = /labeled/i.test(detail) && !/mostly unlabeled/i.test(detail);
      return `${pct}% of buyers are unlabeled wallets. This flag clears if labeled wallet buy % ` +
             `exceeds 20%. Currently SM buy activity is ${hasSm ? 'present' : 'absent'}.`;
    }

    case 'Top Trader Network': {
      const pctMatch = detail?.match(/(\d+)%/);
      const pct = pctMatch ? pctMatch[1] : '?';
      const entMatch = detail?.match(/(\d+)\s+labeled/i);
      const ent = entMatch ? entMatch[1] : '?';
      return `Top trader counterparties are ${pct}% unlabeled. Flag clears if counterparty label ` +
             `rate exceeds 30%. Top trader has traded with ${ent} labeled entities historically.`;
    }

    case 'Holder Concentration': {
      const pctMatch = detail?.match(/(\d+)%/);
      const pct = pctMatch ? pctMatch[1] : '?';
      const isLabeled = /labeled/i.test(detail) && !/unlabeled/i.test(detail) ? 'labeled' : 'unknown';
      return `Top wallet holds ${pct}% of tracked supply. Flag clears below 50%. ` +
             `Current top holder is ${isLabeled}. Watch for distribution events.`;
    }

    case 'SM DEX Activity': {
      const isSelling = /selling/i.test(detail);
      const ratioMatch = detail?.match(/([\d.]+)\s*ratio/i) || detail?.match(/(\d+)\s*trades/i);
      const ratio = ratioMatch ? ratioMatch[1] : '?';
      return `Smart money is ${isSelling ? 'selling' : 'inactive'} on this young token. ` +
             `Flag clears if SM buy/sell ratio exceeds 1.0 in next scan. Current ratio: ${ratio}.`;
    }

    case 'SM Net Sentiment': {
      const amtMatch = detail?.match(/\$([\d,.]+[kKmMbB]?)/i);
      const amt = amtMatch ? amtMatch[0] : '?';
      return `SM net outflow is ${amt} in 24h. Flag clears if outflow drops below $10k. ` +
             `Run nanshield watch to track trend across scans.`;
    }

    case 'SM Holdings Trend': {
      return `SM holdings declining. Flag clears if trend reverses across 2 consecutive scans. ` +
             `Watch mode will catch this automatically.`;
    }

    case 'PnL Dump Risk': {
      const pnlMatch = detail?.match(/avg\s*\+?([\$\d,.kKmMbB]+)/i) || detail?.match(/\+([\$\d,.kKmMbB]+)/i);
      const pnl = pnlMatch ? pnlMatch[1] : '?';
      return `Top traders avg PnL is ${pnl} with high win rate. Dump risk clears if top traders ` +
             `reduce position or new buyers dilute PnL concentration. ` +
             `This is a timing factor — not a structural flaw.`;
    }

    default:
      return `Factor "${name}" scored ${score}/${max}. Flag clears when underlying condition improves.`;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export function advise(score, factors, token, chain) {
  try {
    if (score < 40 || score > 79) return null;

    const clearThreshold = 60;
    const blockingFactors = factors
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);

    if (blockingFactors.length === 0) return null;

    const lines = [];
    const SEP = '─'.repeat(48);
    const circledNums = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

    lines.push(chalk.yellow(`\n── PATH TO CLEARANCE ──${SEP.slice(22)}`));
    lines.push(chalk.white(`Current score: ${score}/100  Need: below ${clearThreshold} to clear\n`));
    lines.push(chalk.gray('Factors blocking clearance and what changes them:\n'));

    blockingFactors.forEach((f, i) => {
      const cond = conditionForFactor(f);
      if (!cond) return;
      const num = circledNums[i] || `${i + 1}.`;
      lines.push(chalk.bold(`${num} ${f.name}  (+${f.score} pts)`));
      lines.push(chalk.gray(`   ${cond}\n`));
    });

    lines.push(chalk.cyan(`Run: nanshield watch ${token} --chain ${chain} --tg`));
    lines.push(chalk.gray('to get alerted the moment this token clears.'));
    lines.push(chalk.yellow(SEP + '──────────────────────\n'));

    return lines.join('\n');
  } catch (err) {
    return null;
  }
}

// ── Plain text version for markdown/HTML reports ──────────────────────────────
export function advisePlain(score, factors, token, chain) {
  try {
    if (score < 40 || score > 79) return null;

    const clearThreshold = 60;
    const blockingFactors = factors
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);

    if (blockingFactors.length === 0) return null;

    const lines = [];
    lines.push(`PATH TO CLEARANCE`);
    lines.push(`Current score: ${score}/100  Need: below ${clearThreshold} to clear\n`);
    lines.push('Factors blocking clearance and what changes them:\n');

    blockingFactors.forEach((f, i) => {
      const cond = conditionForFactor(f);
      if (!cond) return;
      lines.push(`${i + 1}. ${f.name}  (+${f.score} pts)`);
      lines.push(`   ${cond}\n`);
    });

    lines.push(`Run: nanshield watch ${token} --chain ${chain} --tg`);
    lines.push('to get alerted the moment this token clears.');

    return lines.join('\n');
  } catch {
    return null;
  }
}
