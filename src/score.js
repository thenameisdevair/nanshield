import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { runNansen, runAgentSynthesis, parseData, parseArray, fmt, logCall, resetCallLog, getCallLog } from './nansen.js';

const DEBUG_PATH = path.join(os.homedir(), '.nanshield', 'debug-last-run.json');
const TOTAL_CALLS = 14;

// ── Per-call summary extractor ────────────────────────────────────────────────
function extractSummary(callNum, result) {
  if (!result.ok || !result.data) return '';
  try {
    switch (callNum) {
      case 1: {
        const json = JSON.parse(result.data);
        const d = json?.data?.data;
        const liq = d?.spot_metrics?.liquidity_usd;
        return liq ? `${fmt(liq)} liquidity` : 'OK';
      }
      case 2: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const labeled = arr.filter(x => x.address_label?.trim()).length;
        return `${Math.round(labeled / arr.length * 100)}% labeled buyers`;
      }
      case 3: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const total = arr.reduce((s, x) => s + (x.token_amount ?? 0), 0);
        const topPct = total > 0 ? Math.round((arr[0].token_amount / total) * 100) : '?';
        return `Top holder: ${topPct}%`;
      }
      case 4: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const net = arr.reduce((s, x) => s + (x.net_flow_usd ?? x.inflow_usd ?? 0), 0);
        return `Net ${net >= 0 ? '+' : ''}${fmt(net)}`;
      }
      case 5: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const top = arr[0];
        const pnl = top?.pnl_usd ?? 0;
        return `Top trader ${pnl >= 0 ? '+' : ''}${fmt(pnl)}`;
      }
      case 6: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const buys = arr.filter(x => x.action === 'buy' || x.type === 'buy').length;
        return `${buys} buys, ${arr.length - buys} sells`;
      }
      case 7: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const total = arr.reduce((s, x) => s + (x.net_flow_24h_usd ?? 0), 0);
        return `${total >= 0 ? '+' : ''}${fmt(total)} net`;
      }
      case 8: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const dec = arr.filter(x => (x.balance_24h_percent_change ?? 0) < 0).length;
        return dec > 0 ? `${dec} declining` : 'Stable (no decline)';
      }
      case 9: {
        const d = parseData(result.data);
        const roi = d?.roi_percentage ?? d?.total_pnl_roi_percentage;
        return roi !== undefined ? `Top trader +${Math.round(roi)}% ROI` : 'OK';
      }
      case 10: {
        const arr = parseArray(result.data);
        return arr ? `${arr.length} txns` : 'OK';
      }
      case 11: {
        const arr = parseArray(result.data);
        if (!arr || !arr.length) return 'OK';
        const labeled = arr.filter(x => x.address_label?.trim()).length;
        return `${labeled}/${arr.length} labeled`;
      }
      case 12:
      case 13: {
        const d = parseData(result.data);
        const labels = d?.labels;
        const name = d?.name;
        if (name) return `"${name}"`;
        if (Array.isArray(labels) && labels.length) return `"${labels[0]}"`;
        return 'Labeled entity';
      }
      default: return '';
    }
  } catch { return ''; }
}

// ── Scoring factors ───────────────────────────────────────────────────────────

function scoreAgeLiquidity(result) {
  const name = 'Age & Liquidity';
  const max = 10;
  if (!result.ok || !result.data) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  try {
    const json = JSON.parse(result.data);
    const d = json?.data?.data;
    const liq = d?.spot_metrics?.liquidity_usd ?? null;
    if (liq === null) return { name, score: 0, max, label: 'No data', detail: 'Liquidity data unavailable' };
    if (liq < 100000) return { name, score: 10, max, label: 'Low liquidity', detail: `Low liquidity: ${fmt(liq)}` };
    if (liq < 500000) return { name, score: 5, max, label: 'Moderate', detail: `Moderate liquidity: ${fmt(liq)}` };
    return { name, score: 0, max, label: 'Normal', detail: `${d?.name ?? 'Token'} (${d?.symbol ?? ''}) — ${fmt(liq)} liquidity` };
  } catch {
    return { name, score: 0, max, label: 'No data', detail: 'Parse error' };
  }
}

function scoreBuyerProfile(result) {
  const name = 'Buyer Profile';
  const max = 10;
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const labeled = arr.filter(x => x.address_label?.trim()).length;
  const retailPct = Math.round(((arr.length - labeled) / arr.length) * 100);
  if (retailPct > 80) return { name, score: 10, max, label: 'High retail', detail: `${retailPct}% unlabeled wallets in recent trades` };
  if (retailPct > 60) return { name, score: 5, max, label: 'Mixed', detail: `${retailPct}% unlabeled, ${labeled} labeled wallets` };
  return { name, score: 0, max, label: 'Normal', detail: `Mostly labeled wallets (${labeled}/${arr.length})` };
}

function scoreTopTraderNetwork(result, topTraderAddress) {
  const name = 'Top Trader Network';
  const max = 10;
  if (!topTraderAddress) return { name, score: 0, max, label: 'No data', detail: 'No top trader identified' };
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const unlabeled = arr.filter(x => !x.address_label?.trim()).length;
  const unlabeledPct = Math.round((unlabeled / arr.length) * 100);
  if (unlabeledPct > 80) return { name, score: 10, max, label: 'Anonymous', detail: `${unlabeledPct}% of top trader's network is unlabeled` };
  if (unlabeledPct > 50) return { name, score: 5, max, label: 'Mixed', detail: `Mixed network — ${unlabeledPct}% unlabeled counterparties` };
  return { name, score: 0, max, label: 'Normal', detail: 'Top trader transacts mostly with labeled entities' };
}

function scoreHolderConcentration(result) {
  const name = 'Holder Concentration';
  const max = 20;
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const total = arr.reduce((s, x) => s + (x.token_amount ?? 0), 0);
  const topShare = total > 0 ? Math.round((arr[0].token_amount / total) * 100) : null;
  if (topShare === null) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  if (topShare > 50) return { name, score: 20, max, label: 'Concentrated', detail: `Top wallet holds ${topShare}% of tracked supply` };
  if (topShare > 30) return { name, score: 10, max, label: 'Moderate', detail: `Top wallet holds ${topShare}% of tracked supply` };
  return { name, score: 0, max, label: 'Normal', detail: `Healthy distribution, top wallet ${topShare}%` };
}

function scoreSmDexActivity(result) {
  const name = 'SM DEX Activity';
  const max = 15;
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const dumpingNew = arr.filter(x => (x.token_sold_age_days ?? 999) < 30).length;
  const buyingNew = arr.filter(x => (x.token_bought_age_days ?? 999) < 30).length;
  if (dumpingNew > buyingNew) return { name, score: 15, max, label: 'Selling', detail: `SM wallets selling young tokens (${dumpingNew} trades)` };
  if (dumpingNew === buyingNew && dumpingNew > 0) return { name, score: 8, max, label: 'Mixed', detail: 'Mixed SM activity on new tokens' };
  return { name, score: 0, max, label: 'Normal', detail: 'SM wallets buying established tokens' };
}

function scoreSmNetSentiment(result) {
  const name = 'SM Net Sentiment';
  const max = 15;
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const total24h = arr.reduce((s, x) => s + (x.net_flow_24h_usd ?? 0), 0);
  if (total24h < -10000) return { name, score: 15, max, label: 'Outflow', detail: `Net SM outflow: ${fmt(total24h)} in 24h` };
  if (total24h < 0) return { name, score: 8, max, label: 'Slight outflow', detail: `Slight SM outflow: ${fmt(total24h)}` };
  return { name, score: 0, max, label: 'Normal', detail: `Positive SM netflow: ${fmt(total24h)}` };
}

function scoreSmHoldingsTrend(result) {
  const name = 'SM Holdings Trend';
  const max = 10;
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No data', detail: 'Data unavailable' };
  const declining = arr.filter(x => (x.balance_24h_percent_change ?? 0) < 0).length;
  const growing = arr.filter(x => (x.balance_24h_percent_change ?? 0) > 0).length;
  const flat = arr.length - declining - growing;
  if (declining > growing) return { name, score: 10, max, label: 'Declining', detail: `SM holdings declining (${declining} tokens dropping)` };
  if (flat === arr.length) return { name, score: 5, max, label: 'Stagnant', detail: 'No SM movement in tracked holdings' };
  return { name, score: 0, max, label: 'Normal', detail: `SM holdings growing across ${growing} tokens` };
}

function scorePnlDumpRisk(result) {
  const name = 'PnL Dump Risk';
  const max = 10;
  if (!result.ok || !result.data) return { name, score: 0, max, label: 'No PnL data', detail: 'Token PnL data unavailable — scored neutral' };
  const arr = parseArray(result.data);
  if (!arr || arr.length === 0) return { name, score: 0, max, label: 'No PnL data', detail: 'Token PnL data unavailable — scored neutral' };

  const topTraders = arr.slice(0, 10);
  const totalPnl = topTraders.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const avgPnl = totalPnl / topTraders.length;
  const allInProfit = topTraders.every(t => (t.pnl_usd || 0) > 0);
  const totalSell = topTraders.reduce((s, t) => s + (t.sell_volume_usd || 0), 0);
  const totalBuy = topTraders.reduce((s, t) => s + (t.buy_volume_usd || 0), 0);
  const sellRatio = totalBuy > 0 ? totalSell / totalBuy : 0;

  if (allInProfit && avgPnl > 50000) {
    return { name, score: 10, max, label: 'HIGH dump risk', detail: `All top 10 traders in profit (avg +${fmt(avgPnl)}). Heavy sell pressure likely.` };
  }
  if (allInProfit && avgPnl > 10000) {
    return { name, score: 7, max, label: 'Elevated dump risk', detail: `All top 10 in profit (avg +${fmt(avgPnl)}). Moderate sell pressure risk.` };
  }
  if (sellRatio > 1.5) {
    return { name, score: 5, max, label: 'Active selling', detail: `Sell volume ${sellRatio.toFixed(1)}x buy volume among top traders.` };
  }
  return { name, score: 0, max, label: 'Normal', detail: 'Top trader PnL distribution is healthy.' };
}

// ── Compute all 8 factors ─────────────────────────────────────────────────────
export function computeScore(results, topTraderAddress, lastKnownScores = {}) {
  // results indices:
  // [0]=tokenInfo [1]=whoBoughtSold [2]=holders [3]=flows [4]=tokenPnl
  // [5]=smDex [6]=smNetflow [7]=smHoldings [8]=profPnl [9]=profTxns
  // [10]=profCounterparties [11]=profLabels [12]=deployerLabels
  // [13]=smHistoricalHoldings (call #14)
  //
  // SM Holdings Trend uses smHistoricalHoldings ([13]) when available,
  // falling back to smHoldings ([7]) for backward compatibility.
  const smHoldingsResult = (results[13] && results[13].ok) ? results[13] : results[7];

  const rawFactors = [
    scoreAgeLiquidity(results[0]),
    scoreBuyerProfile(results[1]),
    scoreTopTraderNetwork(results[10], topTraderAddress),
    scoreHolderConcentration(results[2]),
    scoreSmDexActivity(results[5]),
    scoreSmNetSentiment(results[6]),
    scoreSmHoldingsTrend(smHoldingsResult),
    scorePnlDumpRisk(results[4]),
  ];

  // Apply lastKnownScores: if a factor returns no data, use the previous
  // successful score so watch mode doesn't reset to 0 on transient failures.
  const updatedLastKnown = { ...lastKnownScores };
  const factors = rawFactors.map(f => {
    if (f.label === 'No data' || f.label === 'No PnL data') {
      const lk = lastKnownScores[f.name];
      if (lk !== undefined) {
        return { ...f, score: lk.score, label: lk.label, detail: lk.detail + ' (last known)' };
      }
      return f;
    }
    updatedLastKnown[f.name] = { score: f.score, label: f.label, detail: f.detail };
    return f;
  });

  const totalScore = Math.min(factors.reduce((s, f) => s + f.score, 0), 100);

  const flags = factors.map(f => ({
    emoji: f.score === 0 ? '🟢' : f.score >= f.max * 0.75 ? '🔴' : '🟡',
    label: f.name,
    detail: f.detail,
    points: f.score,
    max: f.max,
  }));

  return { score: totalScore, flags, factors, lastKnownScores: updatedLastKnown };
}

// ── Main entry point ──────────────────────────────────────────────────────────
export default async function scoreToken(tokenAddress, chain, apiKey, deep = false, onProgress = null, lastKnownScores = {}) {
  resetCallLog();
  const debugLog = { token: tokenAddress, chain, timestamp: new Date().toISOString() };

  function runWith(callNum, label, command) {
    if (onProgress) onProgress(callNum, TOTAL_CALLS, label, false, null);
    const result = runNansen(command, apiKey);
    const summary = extractSummary(callNum, result);
    logCall(callNum, command, result.ok ? 'ok' : 'failed', summary, result.ms);
    debugLog[`call_${callNum}`] = { command, status: result.ok ? 'ok' : 'failed', ms: result.ms, raw: result.data?.slice(0, 2000), summary };
    if (onProgress) onProgress(callNum, TOTAL_CALLS, label, true, { ok: result.ok, summary });
    return result;
  }

  // ── Calls 1-13 run first; agent fires after scoring (needs factor summary) ──
  let agentAssessment = null;
  let agentCallEntry = null;

  // ── Calls 1-13: sequential research calls ────────────────────────────────
  const r1 = runWith(1, 'Token Info',
    `nansen research token info --token ${tokenAddress} --chain ${chain} --fields name,symbol,liquidity_usd,spot_metrics`);
  const r2 = runWith(2, 'Who Bought/Sold',
    `nansen research token who-bought-sold --token ${tokenAddress} --chain ${chain} --limit 5`);
  const r3 = runWith(3, 'Token Holders',
    `nansen research token holders --token ${tokenAddress} --chain ${chain} --fields address,token_amount --limit 3`);

  // Extract key addresses — explicit length check prevents undefined access
  const whoData = parseArray(r2.data);
  const topTraderAddress = (whoData && whoData.length > 0) ? (whoData[0].address ?? null) : null;
  const holderData = parseArray(r3.data);
  const topHolderAddress = (holderData && holderData.length > 0) ? (holderData[0].address ?? null) : null;
  debugLog.topTraderAddress = topTraderAddress;
  debugLog.topHolderAddress = topHolderAddress;

  const r4 = runWith(4, 'Token Flows',
    `nansen research token flows --token ${tokenAddress} --chain ${chain} --limit 3`);
  const r5 = runWith(5, 'Token PnL Leaderboard',
    `nansen research token pnl --token ${tokenAddress} --chain ${chain} --days 30 --sort pnl_usd:desc --limit 10`);
  const r6 = runWith(6, 'SM DEX Trades',
    `nansen research smart-money dex-trades --chain ${chain} --timeframe 24h --limit 3`);
  const r7 = runWith(7, 'SM Net Flow',
    `nansen research smart-money netflow --chain ${chain} --timeframe 24h --limit 3`);
  const r8 = runWith(8, 'SM Holdings',
    `nansen research smart-money holdings --chain ${chain} --limit 3`);

  const profilerTarget = topTraderAddress ?? '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A';
  const r9  = runWith(9,  'Profiler PnL Summary',
    `nansen research profiler pnl-summary --address ${profilerTarget}`);
  const r10 = runWith(10, 'Profiler Transactions',
    `nansen research profiler transactions --address ${profilerTarget} --limit 3`);
  const r11 = runWith(11, 'Profiler Counterparties',
    `nansen research profiler counterparties --address ${profilerTarget} --limit 5`);
  const r12 = runWith(12, 'Profiler Labels',
    `nansen research profiler labels --address ${profilerTarget} --chain ${chain}`);

  const holderTarget = topHolderAddress ?? profilerTarget;
  const r13 = runWith(13, 'Deployer/Top Holder Labels',
    `nansen research profiler labels --address ${holderTarget} --chain ${chain}`);

  // Call #14: SM historical-holdings (always-on) — positions over time
  const r14 = runWith(14, 'SM Historical Holdings',
    `nansen research smart-money historical-holdings --chain ${chain} --limit 3`);

  // results array: index maps to call number - 1
  const results = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14];

  // ── Write debug file ──────────────────────────────────────────────────────
  try { await fs.outputJson(DEBUG_PATH, debugLog, { spaces: 2 }); } catch {}

  // ── Score ─────────────────────────────────────────────────────────────────
  const { score, flags, factors, lastKnownScores: updatedLastKnown } = computeScore(results, topTraderAddress, lastKnownScores);

  // ── Agent call: standard scan (synthesis) or deep (--expert) ─────────────
  // Fires after scoring so we can pass factor summary into the prompt.
  const factorSummary = factors.map(f => `${f.name}:${f.score}/${f.max}`).join(', ');
  const agentResult = await runAgentSynthesis(tokenAddress, chain, apiKey, factorSummary, deep);
  const agentCmd = deep
    ? `nansen agent "<synthesis prompt>" --expert`
    : `nansen agent "<synthesis prompt>"`;
  if (agentResult.ok) {
    agentAssessment = agentResult.data?.trim() || null;
    agentCallEntry = { callNum: 0, command: agentCmd, status: 'ok', summary: 'AI synthesis complete', ms: agentResult.ms };
  } else {
    agentCallEntry = { callNum: 0, command: agentCmd, status: 'failed', summary: 'Agent call failed (UNSCORED)', ms: agentResult.ms };
  }
  debugLog['call_0'] = { command: agentCmd, status: agentResult.ok ? 'ok' : 'failed', ms: agentResult.ms };

  // ── Build call log ────────────────────────────────────────────────────────
  const researchCalls = getCallLog();
  const callLog = agentCallEntry ? [agentCallEntry, ...researchCalls] : researchCalls;

  // ── Token info ────────────────────────────────────────────────────────────
  let tokenInfo = { name: 'Unknown', symbol: 'UNKNOWN', address: tokenAddress };
  try {
    const json = JSON.parse(r1.data);
    const d = json?.data?.data;
    if (d) tokenInfo = { name: d.name ?? tokenInfo.name, symbol: d.symbol ?? tokenInfo.symbol, address: tokenAddress };
  } catch {}

  // ── Credits estimate ──────────────────────────────────────────────────────
  const creditsUsed = results.filter(r => r.ok).length * 3; // rough estimate
  console.error(`Estimated credits used: ~${creditsUsed}${deep ? ' + ~20 (agent)' : ''}`);

  return { score, flags, factors, callLog, tokenInfo, agentAssessment, topTraderAddress, topHolderAddress, lastKnownScores: updatedLastKnown };
}
