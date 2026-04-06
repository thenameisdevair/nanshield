import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const DEBUG_PATH = path.join(os.homedir(), '.nanshield', 'debug-last-run.json');
const FALLBACK_WHALE = '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A';

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

function parse(result) {
  if (!result.ok || !result.data) return null;
  try {
    const parsed = JSON.parse(result.data);
    return parsed.data ?? parsed;
  } catch {
    return null;
  }
}

function parseFirst(result) {
  const data = parse(result);
  if (!data) return null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

function computeScore(results) {
  const flags = [];
  let score = 0;

  // Factor 1 — Token Age & Liquidity (call 1)
  (() => {
    const data = parseFirst(results[0]);
    const liq = data?.liquidity_usd ?? data?.liquidity ?? null;
    const createdAt = data?.created_at ?? data?.creation_date ?? null;
    const liqVal = liq !== null ? parseFloat(liq) : null;
    const age = createdAt ? daysSince(createdAt) : null;

    if (liqVal === null && age === null) {
      flags.push({ emoji: '⚪', label: 'Age & Liquidity', detail: 'Data unavailable', points: 0 });
      return;
    }
    const liqStr = liqVal !== null ? `$${liqVal.toLocaleString()}` : 'unknown liq';
    const ageStr = age !== null ? `${Math.floor(age)}d old` : 'unknown age';

    if ((liqVal !== null && liqVal < 100000) || (age !== null && age < 30)) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 10 });
    } else if ((liqVal !== null && liqVal < 500000) || (age !== null && age < 90)) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 0 });
    }
  })();

  // Factor 2 — Buyer Profile (call 2)
  (() => {
    const data = parse(results[1]);
    const arr = Array.isArray(data) ? data : null;
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'Buyer Profile', detail: 'Data unavailable', points: 0 });
      return;
    }
    const retailPct =
      arr[0]?.retail_buyer_pct ?? arr[0]?.retail_pct ?? arr[0]?.retail_percent ??
      arr.find(r => (r.buyer_type ?? r.type ?? '').toLowerCase().includes('retail'))?.percentage ?? null;

    if (retailPct === null) {
      flags.push({ emoji: '⚪', label: 'Buyer Profile', detail: 'Data unavailable', points: 0 });
      return;
    }
    const val = parseFloat(retailPct);
    if (val > 80) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Buyer Profile', detail: `${val.toFixed(1)}% retail buyers`, points: 10 });
    } else if (val >= 60) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Buyer Profile', detail: `${val.toFixed(1)}% retail buyers`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Buyer Profile', detail: `${val.toFixed(1)}% retail buyers`, points: 0 });
    }
  })();

  // Factor 3 — Top Holder Identity (call 3 — profiler labels)
  (() => {
    const data = parse(results[2]);
    const labels = data?.labels ?? (Array.isArray(data) ? data : null);
    if (labels === null) {
      flags.push({ emoji: '⚪', label: 'Top Holder Identity', detail: 'Data unavailable', points: 0 });
      return;
    }
    if (!Array.isArray(labels) || labels.length === 0) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Top Holder Identity', detail: 'Top holder has no labels', points: 10 });
      return;
    }
    const knownEntities = ['exchange', 'fund', 'market maker', 'custodian', 'institution', 'cex', 'dex'];
    const isKnown = labels.some((l) => {
      const lstr = (typeof l === 'string' ? l : l?.label ?? l?.name ?? '').toLowerCase();
      return knownEntities.some((e) => lstr.includes(e));
    });
    if (isKnown) {
      const names = labels.slice(0, 2).map(l => typeof l === 'string' ? l : l?.label ?? '').join(', ');
      flags.push({ emoji: '🟢', label: 'Top Holder Identity', detail: `Known entity: ${names}`, points: 0 });
    } else {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Top Holder Identity', detail: 'Labeled but not exchange/fund', points: 5 });
    }
  })();

  // Factor 4 — Holder Concentration (call 6)
  (() => {
    const data = parse(results[5]);
    const holders = Array.isArray(data) ? data : data?.holders ?? [];
    const top = holders[0];
    const pct = top?.percentage ?? top?.percent_of_supply ?? top?.balance_pct ?? null;
    if (pct === null) {
      flags.push({ emoji: '⚪', label: 'Holder Concentration', detail: 'Data unavailable', points: 0 });
      return;
    }
    const val = parseFloat(pct);
    if (val > 30) {
      score += 20;
      flags.push({ emoji: '🔴', label: 'Holder Concentration', detail: `Top wallet holds ${val.toFixed(1)}% of supply`, points: 20 });
    } else if (val >= 15) {
      score += 10;
      flags.push({ emoji: '🟡', label: 'Holder Concentration', detail: `Top wallet holds ${val.toFixed(1)}% of supply`, points: 10 });
    } else {
      flags.push({ emoji: '🟢', label: 'Holder Concentration', detail: `Top wallet holds ${val.toFixed(1)}% of supply`, points: 0 });
    }
  })();

  // Factor 5 — SM Activity (call 7 — sm dex-trades)
  (() => {
    const data = parse(results[6]);
    const arr = Array.isArray(data) ? data : null;
    if (!arr || arr.length === 0) {
      flags.push({ emoji: '⚪', label: 'SM DEX Activity', detail: 'Data unavailable', points: 0 });
      return;
    }
    // Score based on buy vs sell volume
    let buyVol = 0, sellVol = 0;
    for (const trade of arr) {
      const side = (trade.side ?? trade.trade_type ?? trade.type ?? '').toLowerCase();
      const vol = parseFloat(trade.volume_usd ?? trade.amount_usd ?? trade.value_usd ?? 0);
      if (side.includes('buy')) buyVol += vol;
      else if (side.includes('sell')) sellVol += vol;
    }
    if (sellVol > buyVol * 2) {
      score += 15;
      flags.push({ emoji: '🔴', label: 'SM DEX Activity', detail: `SM selling dominant (${arr.length} trades)`, points: 15 });
    } else if (sellVol > buyVol) {
      score += 8;
      flags.push({ emoji: '🟡', label: 'SM DEX Activity', detail: `SM net selling (${arr.length} trades)`, points: 8 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM DEX Activity', detail: `SM net buying (${arr.length} trades)`, points: 0 });
    }
  })();

  // Factor 6 — SM Net Sentiment (call 8 — sm netflow)
  (() => {
    const first = parseFirst(results[7]);
    const netFlow = first?.net_flow_usd ?? first?.netflow_usd ?? first?.net_flow ?? null;
    if (netFlow === null) {
      flags.push({ emoji: '⚪', label: 'SM Net Sentiment', detail: 'Data unavailable', points: 0 });
      return;
    }
    const val = parseFloat(netFlow);
    if (val < -500000) {
      score += 20;
      flags.push({ emoji: '🔴', label: 'SM Net Sentiment', detail: `SM net outflow $${Math.abs(val).toLocaleString()}`, points: 20 });
    } else if (val < 0) {
      score += 10;
      flags.push({ emoji: '🟡', label: 'SM Net Sentiment', detail: `SM net outflow $${Math.abs(val).toLocaleString()}`, points: 10 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM Net Sentiment', detail: `SM net inflow $${val.toLocaleString()}`, points: 0 });
    }
  })();

  // Factor 7 — Flow Anomaly (call 9 — token flows)
  (() => {
    const data = parseFirst(results[8]);
    const inflow = data?.inflow_usd ?? data?.inflow ?? data?.total_inflow_usd ?? null;
    const avg = data?.avg_inflow_usd ?? data?.average_inflow_usd ?? null;
    if (inflow === null || avg === null || parseFloat(avg) === 0) {
      flags.push({ emoji: '⚪', label: 'Flow Anomaly', detail: 'Data unavailable', points: 0 });
      return;
    }
    const spike = ((parseFloat(inflow) - parseFloat(avg)) / parseFloat(avg)) * 100;
    if (spike > 200) {
      score += 15;
      flags.push({ emoji: '🔴', label: 'Flow Anomaly', detail: `Inflow spike ${spike.toFixed(0)}% above average`, points: 15 });
    } else if (spike > 100) {
      score += 8;
      flags.push({ emoji: '🟡', label: 'Flow Anomaly', detail: `Inflow spike ${spike.toFixed(0)}% above average`, points: 8 });
    } else {
      flags.push({ emoji: '🟢', label: 'Flow Anomaly', detail: 'Inflow within normal range', points: 0 });
    }
  })();

  return { score: Math.min(score, 100), flags };
}

export default async function scoreToken(tokenAddress, chain, apiKey) {
  const debugLog = { token: tokenAddress, chain, timestamp: new Date().toISOString() };

  // ── Batch 1: cheap calls (1, 2) ──────────────────────────────────────────
  const r1  = run(1,  `nansen research token info --token ${tokenAddress} --chain ${chain} --fields name,symbol,liquidity_usd,created_at`, apiKey, debugLog);
  const r2  = run(2,  `nansen research token who-bought-sold --token ${tokenAddress} --chain ${chain} --limit 5`, apiKey, debugLog);

  // ── Call 6 early to extract top holder for profiler calls ─────────────────
  const r6  = run(6,  `nansen research token holders --token ${tokenAddress} --chain ${chain} --fields address,percentage,token_amount --limit 3`, apiKey, debugLog);

  // Extract top holder address — fall back to known whale for demo
  let profilerAddress = FALLBACK_WHALE;
  try {
    const holdersData = parse(r6);
    const holders = Array.isArray(holdersData) ? holdersData : holdersData?.holders ?? [];
    const extracted = holders[0]?.address ?? holders[0]?.wallet_address ?? holders[0]?.holder_address ?? null;
    if (extracted) profilerAddress = extracted;
  } catch {
    // use fallback
  }
  debugLog.profilerAddress = profilerAddress;
  debugLog.profilerAddressSource = profilerAddress === FALLBACK_WHALE ? 'fallback' : 'call6';

  // ── Batch 2: profiler calls (3, 4, 5) ────────────────────────────────────
  const r3  = run(3,  `nansen research profiler labels --address ${profilerAddress}`, apiKey, debugLog);
  const r4  = run(4,  `nansen research profiler pnl-summary --address ${profilerAddress}`, apiKey, debugLog);
  const r5  = run(5,  `nansen research profiler transactions --address ${profilerAddress} --limit 3`, apiKey, debugLog);

  // ── Batch 3: remaining premium calls (7, 8, 9, 10) ───────────────────────
  const r7  = run(7,  `nansen research smart-money dex-trades --chain ${chain} --timeframe 24h --limit 3`, apiKey, debugLog);
  const r8  = run(8,  `nansen research smart-money netflow --chain ${chain} --timeframe 24h --limit 3`, apiKey, debugLog);
  const r9  = run(9,  `nansen research token flows --token ${tokenAddress} --chain ${chain} --limit 3`, apiKey, debugLog);
  const r10 = run(10, `nansen research smart-money holdings --chain ${chain} --limit 3`, apiKey, debugLog);

  // Results array indexed 0-9 → call numbers 1-10
  const results = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10];

  // ── Write debug file ──────────────────────────────────────────────────────
  try {
    await fs.outputJson(DEBUG_PATH, debugLog, { spaces: 2 });
  } catch {
    // non-fatal
  }

  // ── Build call log ────────────────────────────────────────────────────────
  const callLog = results.map((r, i) => ({
    callNum: i + 1,
    command: debugLog[`call_${i + 1}`]?.command ?? '',
    status: r.ok ? 'ok' : 'failed',
    ms: r.ms,
  }));

  // ── Score ─────────────────────────────────────────────────────────────────
  const { score, flags } = computeScore(results);

  // ── Credit estimate ───────────────────────────────────────────────────────
  const creditsUsed = results.reduce((sum, r, i) => {
    if (!r.ok) return sum;
    return sum + CREDIT_COST[CALL_TYPES[i + 1]];
  }, 0);
  console.error(`Estimated credits used: ~${creditsUsed}`);

  // ── Token info ────────────────────────────────────────────────────────────
  let tokenInfo = { name: 'Unknown', symbol: 'UNKNOWN', address: tokenAddress };
  try {
    const d = parseFirst(r1);
    if (d) tokenInfo = { name: d.name ?? tokenInfo.name, symbol: d.symbol ?? tokenInfo.symbol, address: tokenAddress };
  } catch {
    // use defaults
  }

  return { score, flags, callLog, tokenInfo };
}
