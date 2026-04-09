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

// ── Error classification ───────────────────────────────────────────────────────
// Returns 'timeout' or 'endpoint error' so callers can display the distinction.
export function classifyError(err, errOut = '') {
  const text = (errOut + ' ' + (err?.message || '') + ' ' + (err?.signal || '')).toLowerCase();
  if (err?.signal === 'SIGTERM' || /timeout|timed.?out|etimedout/i.test(text)) return 'timeout';
  if (/404|not found|no route|unknown.*endpoint|invalid.*endpoint/i.test(text)) return 'endpoint error';
  if (/401|unauthorized|invalid.*key|api.*key/i.test(text)) return 'auth error';
  return 'endpoint error';
}

// ── Execute a nansen CLI command with exponential backoff ─────────────────────
// Retries up to 3 times on non-zero exit: 1s, 2s, 4s delays.
// After 3 failures returns { ok: false, errorType } — never throws.
export async function runNansenAsync(command, apiKey, timeout = 30000) {
  const delays = [1000, 2000, 4000];
  let lastError = '';
  let lastErrorType = 'endpoint error';

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
      const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
      lastError = errOut.slice(0, 500);
      lastErrorType = classifyError(err, errOut);
      const ms = Date.now() - start;
      if (attempt < 3) {
        await sleep(delays[attempt]);
      } else {
        return { ok: false, data: null, ms, error: lastError, errorType: lastErrorType };
      }
    }
  }
  return { ok: false, data: null, ms: 0, error: lastError, errorType: lastErrorType };
}

// ── Single-retry async call for SM netflow ────────────────────────────────────
// Retries exactly once after 2 seconds (rate-limit window).
// Returns errorType so the caller can display 'timeout' vs 'endpoint error'.
export async function runNansenSingleRetry(command, apiKey, timeout = 30000) {
  function attempt() {
    const start = Date.now();
    try {
      const stdout = execSync(command, {
        env: { ...process.env, NANSEN_API_KEY: apiKey },
        stdio: 'pipe',
        timeout,
      }).toString();
      return { ok: true, data: stdout, ms: Date.now() - start };
    } catch (err) {
      const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
      return { ok: false, data: null, ms: Date.now() - start, error: errOut.slice(0, 500), errorType: classifyError(err, errOut) };
    }
  }

  const first = attempt();
  if (first.ok) return first;

  // Retry once after 2s
  await sleep(2000);
  return attempt();
}

// ── Synchronous wrapper (kept for callers that don't await) ───────────────────
// NOTE: No retry for sync callers — use runNansenAsync for full retry support.
// Returns errorType so callers can show 'timeout' vs 'endpoint error'.
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
    const errOut = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
    return { ok: false, data: null, ms: Date.now() - start, error: errOut.slice(0, 500), errorType: classifyError(err, errOut) };
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

// ── Build agent prompt ────────────────────────────────────────────────────────
// Separates triggered factors so the agent focuses on what actually fired.
// Key rules baked into the prompt:
//   - unlabeled wallets = anonymous = increased risk (not "safe")
//   - must not contradict the computed verdict
//   - must end with one specific monitor action for the trader
function buildAgentPrompt(tokenAddress, chain, factorSummary, score, verdict, deep) {
  // Parse triggered factors (score > 0) from the summary string
  // Format: "Name:score/max(detail) | ..."
  const triggeredLines = factorSummary
    .split(' | ')
    .filter(segment => {
      const m = segment.match(/:(\d+)\//);
      return m && parseInt(m[1], 10) > 0;
    })
    .map(segment => `- ${segment.trim()}`)
    .join('\n');

  const riskSignals = triggeredLines || '- No factors triggered (all scored 0)';

  const sharedRules = [
    `1. State what the main risk signals actually mean for a trader (be specific, not generic).`,
    `2. Do NOT interpret unlabeled wallets as safe — unlabeled means anonymous, which increases risk.`,
    `3. Do NOT contradict the computed verdict of ${verdict}.`,
    `4. End with one specific thing the trader should monitor before executing.`,
  ].join('\n');

  if (deep) {
    return (
      `NanShield computed a risk score of ${score}/100. Verdict: ${verdict}.\n\n` +
      `Key risk signals found:\n${riskSignals}\n\n` +
      `Perform a deep expert analysis of token ${tokenAddress} on ${chain}. ` +
      `Evaluate rug pull signals, smart money positioning, holder concentration, and suspicious trading patterns. ` +
      `Your response must follow these rules:\n${sharedRules}`
    );
  }

  return (
    `NanShield computed a risk score of ${score}/100. Verdict: ${verdict}.\n\n` +
    `Key risk signals found:\n${riskSignals}\n\n` +
    `Provide a 2-3 sentence assessment that follows these rules:\n${sharedRules}`
  );
}

// ── Fire nansen agent with retry ──────────────────────────────────────────────
// Standard scan: grounded synthesis prompt listing only triggered factors.
// Deep scan: adds --expert flag and deeper analysis instruction.
// scoreData = { score, threshold, verdict } — agent explains, never overrides.
export async function runAgentSynthesis(tokenAddress, chain, apiKey, factorSummary, deep = false, scoreData = {}) {
  const { score = '?', verdict = 'UNKNOWN' } = scoreData;

  const prompt = buildAgentPrompt(tokenAddress, chain, factorSummary, score, verdict, deep);

  const expertFlag = deep ? ' --expert' : '';
  const cmd = `nansen agent "${prompt.replace(/"/g, '\\"')}"${expertFlag}`;

  const result = await runNansenAsync(cmd, apiKey, 90000);
  return result;
}
