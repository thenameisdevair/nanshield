import { execSync } from 'child_process';

// ── Call log for API proof summary ────────────────────────────────────────────
const _callLog = [];

export function logCall(callNum, command, status, summary, ms) {
  _callLog.push({ callNum, command, status, summary: summary || '', ms, timestamp: new Date().toISOString() });
}

export function getCallLog() { return [..._callLog]; }
export function getCallCount() { return _callLog.length; }
export function resetCallLog() { _callLog.length = 0; }

// ── Execute a nansen CLI command ──────────────────────────────────────────────
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
