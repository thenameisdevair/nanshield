import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const DEBUG_PATH = path.join(os.homedir(), '.nanshield', 'debug-last-run.json');

const CREDIT_COST = { basic: 1, premium: 5 };
const CALL_TYPES = {
  1: 'basic', 2: 'basic', 3: 'basic', 4: 'basic', 5: 'basic',
  6: 'premium', 7: 'premium', 8: 'premium', 9: 'basic', 10: 'premium',
};

function run(callNum, command, apiKey, debugLog) {
  const start = Date.now();
  try {
    const stdout = execSync(command, {
      env: { ...process.env, NANSEN_API_KEY: apiKey },
      stdio: 'pipe',
      timeout: 30000,
    }).toString();
    const ms = Date.now() - start;
    debugLog[`call_${callNum}`] = { command, status: 'ok', ms, raw: stdout.slice(0, 2000) };
    return { ok: true, data: stdout, ms };
  } catch (err) {
    const ms = Date.now() - start;
    const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message;
    debugLog[`call_${callNum}`] = { command, status: 'failed', ms, error: errOut.slice(0, 500) };
    return { ok: false, data: null, ms };
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────
// Handles both { data: { data: X } } and { data: X }
function parseData(raw) {
  try {
    const json = JSON.parse(raw);
    const inner = json?.data?.data ?? json?.data ?? null;
    return inner;
  } catch { return null; }
}

function parseArray(raw) {
  const d = parseData(raw);
  return Array.isArray(d) ? d : null;
}

function parseObject(raw) {
  const d = parseData(raw);
  return (d && !Array.isArray(d)) ? d : null;
}

function fmt(usd) {
  return Math.abs(usd).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

export function computeScore(results, topTraderAddress) {
  const flags = [];
  let score = 0;

  // Factor 1 — Token Age & Liquidity (call_1, results[0])
  (() => {
    if (!results[0].ok || !results[0].data) {
      flags.push({ emoji: '⚪', label: 'Age & Liquidity', detail: 'Data unavailable', points: 0 });
      return;
    }
    let tokenData;
    try {
      const json = JSON.parse(results[0].data);
      tokenData = json?.data?.data;
    } catch {
      flags.push({ emoji: '⚪', label: 'Age & Liquidity', detail: 'Data unavailable', points: 0 });
      return;
    }
    const liquidity = tokenData?.spot_metrics?.liquidity_usd ?? null;
    const name = tokenData?.name ?? 'Unknown';
    const symbol = tokenData?.symbol ?? '';

    if (liquidity === null) {
      flags.push({ emoji: '⚪', label: 'Age & Liquidity', detail: 'Data unavailable', points: 0 });
      return;
    }
    if (liquidity < 100000) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Age & Liquidity', detail: `Low liquidity: ${fmt(liquidity)}`, points: 10 });
    } else if (liquidity < 500000) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Age & Liquidity', detail: `Moderate liquidity: ${fmt(liquidity)}`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Age & Liquidity', detail: `${name} (${symbol}) — ${fmt(liquidity)} liquidity`, points: 0 });
    }
  })();

  // Factor 2 — Buyer Profile (call_2, results[1])
  (() => {
    const arr = parseArray(results[1].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'Buyer Profile', detail: 'Data unavailable', points: 0 });
      return;
    }
    const labeled = arr.filter(x => x.address_label && x.address_label.trim() !== '').length;
    const retail = arr.length - labeled;
    const retailPct = Math.round((retail / arr.length) * 100);

    if (retailPct > 80) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Buyer Profile', detail: `${retailPct}% unlabeled wallets in recent trades`, points: 10 });
    } else if (retailPct > 60) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Buyer Profile', detail: `${retailPct}% unlabeled, ${labeled} labeled wallets`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Buyer Profile', detail: `Mostly labeled wallets (${labeled}/${arr.length})`, points: 0 });
    }
  })();

  // Factor 3 — Top Trader Network (call_3 profiler counterparties, results[2])
  (() => {
    if (!topTraderAddress) {
      flags.push({ emoji: '⚪', label: 'Top Trader Network', detail: 'Data unavailable', points: 0 });
      return;
    }
    const arr = parseArray(results[2].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'Top Trader Network', detail: 'Data unavailable', points: 0 });
      return;
    }
    const unlabeled = arr.filter(x => !x.address_label || x.address_label.trim() === '').length;
    const unlabeledPct = Math.round((unlabeled / arr.length) * 100);

    if (unlabeledPct > 80) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Top Trader Network', detail: `${unlabeledPct}% of top trader's network is unlabeled`, points: 10 });
    } else if (unlabeledPct > 50) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Top Trader Network', detail: `Mixed network — ${unlabeledPct}% unlabeled counterparties`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Top Trader Network', detail: 'Top trader transacts mostly with labeled entities', points: 0 });
    }
  })();

  // Factor 4 — Holder Concentration (call_6, results[5])
  (() => {
    const arr = parseArray(results[5].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'Holder Concentration', detail: 'Data unavailable', points: 0 });
      return;
    }
    const total = arr.reduce((s, x) => s + (x.token_amount ?? 0), 0);
    const topShare = total > 0 ? Math.round((arr[0].token_amount / total) * 100) : null;

    if (topShare === null) {
      flags.push({ emoji: '⚪', label: 'Holder Concentration', detail: 'Data unavailable', points: 0 });
      return;
    }
    if (topShare > 50) {
      score += 20;
      flags.push({ emoji: '🔴', label: 'Holder Concentration', detail: `Top wallet holds ${topShare}% of tracked supply`, points: 20 });
    } else if (topShare > 30) {
      score += 10;
      flags.push({ emoji: '🟡', label: 'Holder Concentration', detail: `Top wallet holds ${topShare}% of tracked supply`, points: 10 });
    } else {
      flags.push({ emoji: '🟢', label: 'Holder Concentration', detail: `Healthy distribution, top wallet ${topShare}%`, points: 0 });
    }
  })();

  // Factor 5 — SM DEX Activity (call_7, results[6])
  (() => {
    const arr = parseArray(results[6].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'SM DEX Activity', detail: 'Data unavailable', points: 0 });
      return;
    }
    const dumpingNew = arr.filter(x => (x.token_sold_age_days ?? 999) < 30).length;
    const buyingNew = arr.filter(x => (x.token_bought_age_days ?? 999) < 30).length;

    if (dumpingNew > buyingNew) {
      score += 15;
      flags.push({ emoji: '🔴', label: 'SM DEX Activity', detail: `SM wallets selling young tokens (${dumpingNew} trades)`, points: 15 });
    } else if (dumpingNew === buyingNew && dumpingNew > 0) {
      score += 8;
      flags.push({ emoji: '🟡', label: 'SM DEX Activity', detail: 'Mixed SM activity on new tokens', points: 8 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM DEX Activity', detail: 'SM wallets buying established tokens', points: 0 });
    }
  })();

  // Factor 6 — SM Net Sentiment (call_8, results[7])
  (() => {
    const arr = parseArray(results[7].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'SM Net Sentiment', detail: 'Data unavailable', points: 0 });
      return;
    }
    const total24h = arr.reduce((s, x) => s + (x.net_flow_24h_usd ?? 0), 0);

    if (total24h < -10000) {
      score += 20;
      flags.push({ emoji: '🔴', label: 'SM Net Sentiment', detail: `Net SM outflow: ${fmt(total24h)} in 24h`, points: 20 });
    } else if (total24h < 0) {
      score += 10;
      flags.push({ emoji: '🟡', label: 'SM Net Sentiment', detail: `Slight SM outflow: ${fmt(total24h)}`, points: 10 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM Net Sentiment', detail: `Positive SM netflow: ${fmt(total24h)}`, points: 0 });
    }
  })();

  // Factor 7 — SM Holdings Trend (call_10, results[9])
  (() => {
    const arr = parseArray(results[9].data);
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'SM Holdings Trend', detail: 'Data unavailable', points: 0 });
      return;
    }
    const declining = arr.filter(x => (x.balance_24h_percent_change ?? 0) < 0).length;
    const growing = arr.filter(x => (x.balance_24h_percent_change ?? 0) > 0).length;
    const flat = arr.length - declining - growing;

    if (declining > growing) {
      score += 15;
      flags.push({ emoji: '🔴', label: 'SM Holdings Trend', detail: `SM holdings declining (${declining} tokens dropping)`, points: 15 });
    } else if (flat === arr.length) {
      score += 8;
      flags.push({ emoji: '🟡', label: 'SM Holdings Trend', detail: 'No SM movement in tracked holdings', points: 8 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM Holdings Trend', detail: `SM holdings growing across ${growing} tokens`, points: 0 });
    }
  })();

  return { score: Math.min(score, 100), flags };
}

export default async function scoreToken(tokenAddress, chain, apiKey, deep = false) {
  const debugLog = { token: tokenAddress, chain, timestamp: new Date().toISOString() };

  // ── Call 0: nansen agent (deep mode only) ────────────────────────────────
  let agentAssessment = null;
  let agentCallEntry = null;
  if (deep) {
    const question = `Analyze token ${tokenAddress} on ${chain}: are there any rug pull signals, smart money exits, unusual holder concentration, or suspicious trading patterns in the last 24 hours? Give a risk assessment in 2-3 sentences.`;
    const agentCmd = `nansen agent "${question.replace(/"/g, '\\"')}"`;
    const agentStart = Date.now();
    try {
      const raw = execSync(agentCmd, {
        env: { ...process.env, NANSEN_API_KEY: apiKey },
        stdio: 'pipe',
        timeout: 60000,
      }).toString().trim();
      const agentMs = Date.now() - agentStart;
      agentAssessment = raw;
      debugLog['call_0'] = { command: agentCmd, status: 'ok', ms: agentMs, raw: raw.slice(0, 1000) };
      agentCallEntry = { callNum: 0, command: agentCmd, status: 'ok', ms: agentMs };
    } catch (err) {
      const agentMs = Date.now() - agentStart;
      const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message;
      debugLog['call_0'] = { command: agentCmd, status: 'failed', ms: agentMs, error: errOut.slice(0, 500) };
      agentCallEntry = { callNum: 0, command: agentCmd, status: 'failed', ms: agentMs };
    }
  }

  // ── Batch 1: cheap calls (1, 2) ──────────────────────────────────────────
  const r1 = run(1, `nansen research token info --token ${tokenAddress} --chain ${chain} --fields name,symbol,liquidity_usd,spot_metrics`, apiKey, debugLog);
  const r2 = run(2, `nansen research token who-bought-sold --token ${tokenAddress} --chain ${chain} --limit 5`, apiKey, debugLog);

  // ── Call 6 early to get holders ──────────────────────────────────────────
  const r6 = run(6, `nansen research token holders --token ${tokenAddress} --chain ${chain} --fields address,token_amount --limit 3`, apiKey, debugLog);

  // Extract top trader address from call_2 for profiler calls
  let topTraderAddress = null;
  try {
    const arr = parseArray(r2.data);
    topTraderAddress = arr?.[0]?.address ?? null;
  } catch { /* use null */ }
  debugLog.topTraderAddress = topTraderAddress;
  debugLog.topTraderAddressSource = topTraderAddress ? 'call2' : 'none';

  // ── Batch 2: profiler calls (3, 4, 5) ────────────────────────────────────
  // call_3: counterparties — network quality of top trader
  // call_4: pnl-summary   — track record
  // call_5: transactions   — recent activity
  const profilerTarget = topTraderAddress ?? '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A';
  const r3 = run(3, `nansen research profiler counterparties --address ${profilerTarget} --limit 5`, apiKey, debugLog);
  const r4 = run(4, `nansen research profiler pnl-summary --address ${profilerTarget}`, apiKey, debugLog);
  const r5 = run(5, `nansen research profiler transactions --address ${profilerTarget} --limit 3`, apiKey, debugLog);

  // ── Batch 3: remaining premium calls (7, 8, 9, 10) ───────────────────────
  const r7  = run(7,  `nansen research smart-money dex-trades --chain ${chain} --timeframe 24h --limit 3`, apiKey, debugLog);
  const r8  = run(8,  `nansen research smart-money netflow --chain ${chain} --timeframe 24h --limit 3`, apiKey, debugLog);
  const r9  = run(9,  `nansen research token flows --token ${tokenAddress} --chain ${chain} --limit 3`, apiKey, debugLog);
  const r10 = run(10, `nansen research smart-money holdings --chain ${chain} --limit 3`, apiKey, debugLog);

  // Results array: index 0–9 → call numbers 1–10
  // [0]=call_1(token info), [1]=call_2(who-bought-sold), [2]=call_3(counterparties),
  // [3]=call_4(pnl), [4]=call_5(txns), [5]=call_6(holders),
  // [6]=call_7(sm dex), [7]=call_8(sm netflow), [8]=call_9(flows), [9]=call_10(sm holdings)
  const results = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10];

  // ── Write debug file ──────────────────────────────────────────────────────
  try {
    await fs.outputJson(DEBUG_PATH, debugLog, { spaces: 2 });
  } catch { /* non-fatal */ }

  // ── Build call log ────────────────────────────────────────────────────────
  const researchCalls = results.map((r, i) => ({
    callNum: i + 1,
    command: debugLog[`call_${i + 1}`]?.command ?? '',
    status: r.ok ? 'ok' : 'failed',
    ms: r.ms,
  }));
  const callLog = agentCallEntry
    ? [agentCallEntry, ...researchCalls]
    : researchCalls;

  // ── Score ─────────────────────────────────────────────────────────────────
  const { score, flags } = computeScore(results, topTraderAddress);

  // ── Credit estimate ───────────────────────────────────────────────────────
  const creditsUsed = results.reduce((sum, r, i) => {
    if (!r.ok) return sum;
    return sum + CREDIT_COST[CALL_TYPES[i + 1]];
  }, 0);
  console.error(`Estimated credits used: ~${creditsUsed}${deep ? ' + ~20 (agent)' : ''}`);

  // ── Token info ────────────────────────────────────────────────────────────
  let tokenInfo = { name: 'Unknown', symbol: 'UNKNOWN', address: tokenAddress };
  try {
    const json = JSON.parse(r1.data);
    const d = json?.data?.data;
    if (d) tokenInfo = { name: d.name ?? tokenInfo.name, symbol: d.symbol ?? tokenInfo.symbol, address: tokenAddress };
  } catch { /* use defaults */ }

  return { score, flags, callLog, tokenInfo, agentAssessment };
}
