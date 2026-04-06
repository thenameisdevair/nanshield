import { execSync } from 'child_process';

function run(command, apiKey) {
  const start = Date.now();
  try {
    const stdout = execSync(command, {
      env: { ...process.env, NANSEN_API_KEY: apiKey },
      stdio: 'pipe',
      timeout: 30000,
    }).toString();
    return { ok: true, data: stdout, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, data: null, ms: Date.now() - start };
  }
}

function parse(result) {
  if (!result.ok || !result.data) return null;
  try {
    return JSON.parse(result.data).data;
  } catch {
    return null;
  }
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff / (1000 * 60 * 60 * 24);
}

function computeScore(results) {
  const flags = [];
  let score = 0;

  // Factor 1 — Holder Concentration (call 4)
  (() => {
    const data = parse(results[3]);
    if (!data) {
      flags.push({ emoji: '⚪', label: 'Holder Concentration', detail: 'Data unavailable', points: 0 });
      return;
    }
    const holders = Array.isArray(data) ? data : data.holders ?? [];
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

  // Factor 2 — SM Net Sentiment (call 5)
  (() => {
    const data = parse(results[4]);
    const netFlow = data?.net_flow_usd ?? data?.netflow_usd ?? data?.net_flow ?? null;
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

  // Factor 3 — SM Exit Signal (call 6)
  (() => {
    const data = parse(results[5]);
    const count = data?.sm_holder_count ?? data?.holder_count ?? (Array.isArray(data) ? data.length : null);
    if (count === null) {
      flags.push({ emoji: '⚪', label: 'SM Exit Signal', detail: 'Data unavailable', points: 0 });
      return;
    }
    const val = parseInt(count);
    if (val < 3) {
      score += 15;
      flags.push({ emoji: '🔴', label: 'SM Exit Signal', detail: `Only ${val} SM holders remaining`, points: 15 });
    } else if (val <= 10) {
      score += 8;
      flags.push({ emoji: '🟡', label: 'SM Exit Signal', detail: `${val} SM holders`, points: 8 });
    } else {
      flags.push({ emoji: '🟢', label: 'SM Exit Signal', detail: `${val} SM holders`, points: 0 });
    }
  })();

  // Factor 4 — Flow Anomaly (call 2)
  (() => {
    const data = parse(results[1]);
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
      flags.push({ emoji: '🟢', label: 'Flow Anomaly', detail: `Inflow within normal range`, points: 0 });
    }
  })();

  // Factor 5 — Buyer Profile (call 3)
  (() => {
    const data = parse(results[2]);
    const retailPct = data?.retail_buyer_pct ?? data?.retail_pct ?? data?.retail_percent ?? null;
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

  // Factor 6 — Top Holder Identity (call 8)
  (() => {
    const data = parse(results[7]);
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
      flags.push({ emoji: '🟢', label: 'Top Holder Identity', detail: `Labeled as known entity: ${labels.slice(0, 2).map(l => typeof l === 'string' ? l : l?.label ?? '').join(', ')}`, points: 0 });
    } else {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Top Holder Identity', detail: `Labeled but not exchange/fund`, points: 5 });
    }
  })();

  // Factor 7 — Token Age and Liquidity (call 1)
  (() => {
    const data = parse(results[0]);
    const liquidity = data?.liquidity_usd ?? data?.liquidity ?? null;
    const createdAt = data?.created_at ?? data?.creation_date ?? null;
    const liq = liquidity !== null ? parseFloat(liquidity) : null;
    const age = createdAt !== null ? daysSince(createdAt) : null;

    const lowLiq = liq !== null && liq < 100000;
    const youngAge = age !== null && age < 30;
    const midLiq = liq !== null && liq >= 100000 && liq < 500000;
    const midAge = age !== null && age >= 30 && age < 90;

    if (liq === null && age === null) {
      flags.push({ emoji: '⚪', label: 'Age & Liquidity', detail: 'Data unavailable', points: 0 });
      return;
    }
    const liqStr = liq !== null ? `$${liq.toLocaleString()}` : 'unknown';
    const ageStr = age !== null ? `${Math.floor(age)}d old` : 'unknown age';

    if (lowLiq || youngAge) {
      score += 10;
      flags.push({ emoji: '🔴', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 10 });
    } else if (midLiq || midAge) {
      score += 5;
      flags.push({ emoji: '🟡', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 5 });
    } else {
      flags.push({ emoji: '🟢', label: 'Age & Liquidity', detail: `${liqStr} liquidity, ${ageStr}`, points: 0 });
    }
  })();

  return { score: Math.min(score, 100), flags };
}

export default async function scoreToken(tokenAddress, chain, apiKey) {
  const commands = [
    `nansen research token info --token ${tokenAddress} --chain ${chain} --fields name,symbol,liquidity_usd,created_at`,
    `nansen research token flows --token ${tokenAddress} --chain ${chain}`,
    `nansen research token who-bought-sold --token ${tokenAddress} --chain ${chain} --timeframe 24h`,
    `nansen research token holders --token ${tokenAddress} --chain ${chain} --fields address,percentage,token_amount --limit 3`,
    `nansen research smart-money netflow --chain ${chain} --timeframe 24h --limit 5`,
    `nansen research smart-money holdings --chain ${chain} --limit 5`,
    `nansen research smart-money dex-trades --chain ${chain} --timeframe 24h --limit 5`,
  ];

  const results = commands.map((cmd) => run(cmd, apiKey));

  // Extract top holder address for profiler calls
  let topHolderAddress = null;
  try {
    const holdersData = parse(results[3]);
    console.error('[debug] call 4 raw:', results[3].data?.slice(0, 500));
    console.error('[debug] call 4 parsed:', JSON.stringify(holdersData)?.slice(0, 500));
    const holders = Array.isArray(holdersData) ? holdersData : holdersData?.holders ?? [];
    topHolderAddress = holders[0]?.address ?? holders[0]?.wallet_address ?? holders[0]?.holder_address ?? null;
    console.error('[debug] top holder address:', topHolderAddress);
  } catch {
    // leave null
  }

  const profilerCommands = topHolderAddress
    ? [
        `nansen research profiler labels --address ${topHolderAddress}`,
        `nansen research profiler pnl-summary --address ${topHolderAddress}`,
        `nansen research profiler transactions --address ${topHolderAddress} --limit 5`,
      ]
    : [null, null, null];

  const profilerResults = profilerCommands.map((cmd) =>
    cmd ? run(cmd, apiKey) : { ok: false, data: null, ms: 0 }
  );

  const allResults = [...results, ...profilerResults];

  const allCommands = [...commands, ...profilerCommands.map((c) => c ?? '(skipped — no top holder)')];

  const callLog = allResults.map((r, i) => ({
    callNum: i + 1,
    command: allCommands[i],
    status: r.ok ? 'ok' : 'failed',
    ms: r.ms,
  }));

  const { score, flags } = computeScore(allResults);

  // Token info from call 1
  let tokenInfo = { name: 'Unknown', symbol: 'UNKNOWN', address: tokenAddress };
  try {
    const d = parse(results[0]);
    if (d) {
      tokenInfo = {
        name: d.name ?? tokenInfo.name,
        symbol: d.symbol ?? tokenInfo.symbol,
        address: tokenAddress,
      };
    }
  } catch {
    // use defaults
  }

  return { score, flags, callLog, tokenInfo };
}
