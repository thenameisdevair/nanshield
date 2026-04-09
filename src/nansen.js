import { execSync } from 'child_process';

// ── Call log for API proof summary ────────────────────────────────────────────
const _callLog = [];

export function logCall(callNum, command, status, summary, ms) {
  _callLog.push({ callNum, command, status, summary: summary || '', ms, timestamp: new Date().toISOString() });
}

export function getCallLog() { return [..._callLog]; }
export function getCallCount() { return _callLog.length; }
export function resetCallLog() { _callLog.length = 0; }

// ── Sleep helper ──────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Execute a nansen CLI command with exponential backoff ─────────────────────
// Retries up to 3 times on non-zero exit: 1s, 2s, 4s delays.
// After 3 failures returns { ok: false } — never throws.
export async function runNansenAsync(command, apiKey, timeout = 30000) {
  const delays = [1000, 2000, 4000];
  let lastError = '';

  for (let attempt = 0; attempt <= 3; attempt++) {
    const start = Date.now();
    try {
      const stdout = execSync(command, {
        env: { ...process.env, NANSEN_API_KEY: apiKey },
        stdio: 'pipe',
        timeout,
      }).toString();
      return { ok: true, data: stdout, ms: Date.now() - start };
    } catch (err) {
      lastError = (err.stdout?.toString() || err.stderr?.toString() || err.message).slice(0, 500);
      const ms = Date.now() - start;
      if (attempt < 3) {
        await sleep(delays[attempt]);
      } else {
        return { ok: false, data: null, ms, error: lastError };
      }
    }
  }
  return { ok: false, data: null, ms: 0, error: lastError };
}

// ── Synchronous wrapper (kept for callers that don't await) ───────────────────
// NOTE: No retry for sync callers — use runNansenAsync for full retry support.
export function runNansen(command, apiKey, timeout = 30000) {
  const start = Date.now();
  try {
    const stdout = execSync(command, {
      env: { ...process.env, NANSEN_API_KEY: apiKey },
      stdio: 'pipe',
      timeout,
    }).toString();
    return { ok: true, data: stdout, ms: Date.now() - start };
  } catch (err) {
    const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message;
    return { ok: false, data: null, ms: Date.now() - start, error: errOut.slice(0, 500) };
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────
export function parseData(raw) {
  try {
    const json = JSON.parse(raw);
    return json?.data?.data ?? json?.data ?? null;
  } catch { return null; }
}

export function parseArray(raw) {
  const d = parseData(raw);
  return Array.isArray(d) ? d : null;
}

export function parseObject(raw) {
  const d = parseData(raw);
  return (d && !Array.isArray(d)) ? d : null;
}

export function fmt(usd) {
  return Math.abs(usd).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

// ── Address detection (EVM or Solana) ────────────────────────────────────────
export function isAddress(input) {
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return true;
  return false;
}

// ── Fire nansen agent with retry ──────────────────────────────────────────────
// Standard scan: focused 150-word synthesis prompt (not --expert).
// Deep scan: adds --expert flag.
export async function runAgentSynthesis(tokenAddress, chain, apiKey, factorSummary, deep = false) {
  const prompt = deep
    ? `Perform a deep expert analysis of token ${tokenAddress} on ${chain}. ` +
      `Factor assessment: ${factorSummary}. ` +
      `Evaluate rug pull signals, smart money positioning, holder concentration risks, ` +
      `and suspicious trading patterns. Provide a comprehensive risk verdict.`
    : `Synthesize a one-paragraph risk verdict for token ${tokenAddress} on ${chain}. ` +
      `Factor scores: ${factorSummary}. ` +
      `In under 150 words: is this token safe to trade? What are the top 2 risk signals? ` +
      `What does smart money positioning indicate?`;

  const expertFlag = deep ? ' --expert' : '';
  const cmd = `nansen agent "${prompt.replace(/"/g, '\\"')}"${expertFlag}`;

  const result = await runNansenAsync(cmd, apiKey, 90000);
  return result;
}
