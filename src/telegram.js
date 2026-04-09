import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const CONFIG_PATH  = path.join(os.homedir(), '.nanshield', 'config.json');
const TG_FAIL_LOG  = path.join(os.homedir(), '.nanshield', 'logs', 'tg-failures.log');

// ── Load TG credentials from config ──────────────────────────────────────────
async function loadCredentials() {
  try {
    if (await fs.pathExists(CONFIG_PATH)) {
      const cfg = await fs.readJson(CONFIG_PATH);
      return { botToken: cfg.tgBotToken || null, chatId: cfg.tgChatId || null };
    }
  } catch {}
  return { botToken: null, chatId: null };
}

// ── Send raw Telegram message with retry-once ─────────────────────────────────
async function sendTelegramMessage(botToken, chatId, text) {
  // Truncate to 4096 chars (TG limit)
  let msg = text;
  if (msg.length > 4096) {
    msg = msg.slice(0, 4000) + '\n...run --report for full breakdown';
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' });

  async function attempt() {
    const { default: https } = await import('https');
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) resolve(true);
            else reject(new Error(parsed.description || 'TG API error'));
          } catch { reject(new Error('Invalid TG response')); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  try {
    await attempt();
    return true;
  } catch (err1) {
    // Retry once after 3 seconds
    await new Promise(r => setTimeout(r, 3000));
    try {
      await attempt();
      return true;
    } catch (err2) {
      console.error(`TG send failed: ${err2.message}`);
      // Also write to fail log
      try {
        await fs.ensureDir(path.dirname(TG_FAIL_LOG));
        const entry = `[${new Date().toISOString()}] ${err2.message}\nMessage: ${msg.slice(0, 200)}\n---\n`;
        await fs.appendFile(TG_FAIL_LOG, entry);
      } catch {}
      return false;
    }
  }
}

// ── configure(botToken, chatId) ───────────────────────────────────────────────
export async function configure(botToken, chatId) {
  try {
    let cfg = {};
    if (await fs.pathExists(CONFIG_PATH)) {
      try { cfg = await fs.readJson(CONFIG_PATH); } catch {}
    }
    cfg.tgBotToken = botToken;
    cfg.tgChatId   = chatId;
    await fs.outputJson(CONFIG_PATH, cfg, { spaces: 2 });

    const ok = await sendTelegramMessage(botToken, chatId, '🛡 NanShield connected ✓');
    return ok;
  } catch (err) {
    console.error(`TG configure error: ${err.message}`);
    return false;
  }
}

// ── sendTestMessage() ─────────────────────────────────────────────────────────
export async function sendTestMessage() {
  try {
    const { botToken, chatId } = await loadCredentials();
    if (!botToken || !chatId) {
      console.error('TG not configured. Run: nanshield setup');
      return false;
    }
    return await sendTelegramMessage(botToken, chatId, '🛡 NanShield v2 connected. Watch alerts active.');
  } catch (err) {
    console.error(`TG sendTestMessage error: ${err.message}`);
    return false;
  }
}

// ── sendAlert(type, data) ─────────────────────────────────────────────────────
export async function sendAlert(type, data) {
  try {
    const { botToken, chatId } = await loadCredentials();
    console.log('TG config:', botToken ? 'token present' : 'TOKEN MISSING', chatId ? 'chatId present' : 'CHATID MISSING');
    if (!botToken || !chatId) {
      console.error('TG not configured. Run: nanshield setup');
      return false;
    }

    let text = '';
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });

    switch (type) {
      case 'THRESHOLD_CROSSED': {
        const { symbol, chain, scanNum, oldScore, newScore, threshold, deltas, token } = data;
        const deltaLines = (deltas || []).map(d => {
          const arrow = d.delta > 0 ? '↑' : '↓';
          const sign  = d.delta > 0 ? '+' : '';
          return `${arrow} ${d.name}: ${d.previous} → ${d.current} (${sign}${d.delta}) — ${d.detail || ''}`;
        }).join('\n');

        const scoreChange = oldScore !== null ? `${oldScore} → ${newScore}` : `${newScore} (already blocked on first scan)`;
        text = `🛡 <b>NANSHIELD ALERT</b>\n\n` +
               `Token: $${symbol || token} (${chain})\n` +
               `Scan #${scanNum} — ${ts}\n\n` +
               `Score: ${scoreChange} ⛔ ABOVE THRESHOLD (≥${threshold})\n\n` +
               `Changes:\n${deltaLines || '(none recorded)'}\n\n` +
               `Run deep scan:\n<code>nanshield check ${token} --chain ${chain} --deep</code>`;
        break;
      }

      case 'FACTOR_CHANGED': {
        const { symbol, chain, score, deltas, token } = data;
        const deltaLines = (deltas || []).map(d => {
          const arrow = d.delta > 0 ? '↑' : '↓';
          const sign  = d.delta > 0 ? '+' : '';
          return `${arrow} ${d.name}: ${d.previous} → ${d.current} (${sign}${d.delta})`;
        }).join('\n');

        text = `🟡 <b>NANSHIELD WATCH UPDATE</b>\n` +
               `Token: $${symbol || token}  Score: ${score}/100 ✅\n` +
               `${(deltas || []).length} factor${(deltas || []).length !== 1 ? 's' : ''} changed — details below...\n\n` +
               deltaLines;
        break;
      }

      case 'MONITORING_STOPPED': {
        const { symbol, chain, reason, token } = data;
        text = `⚠️ <b>NANSHIELD MONITORING STOPPED</b>\n` +
               `Token: $${symbol || token} (${chain})\n` +
               `Reason: ${reason}\n\n` +
               `Restart: <code>nanshield watch ${token} --chain ${chain} --tg</code>`;
        break;
      }

      case 'FORCE_TRADE_EXECUTED': {
        const { symbol, score, amount, fromToken, toToken, txHash, token } = data;
        text = `⚠️ <b>FORCE TRADE EXECUTED</b>\n` +
               `Token: $${symbol || token} — Score was ${score}/100 (BLOCKED)\n` +
               `Amount: ${amount} ${fromToken || 'USDC'} → ${toToken || symbol || token}\n` +
               `Tx: ${txHash || '(not available)'}\n` +
               `You overrode the security gate.`;
        break;
      }

      default:
        text = `🛡 NanShield alert: ${type}\n${JSON.stringify(data).slice(0, 200)}`;
    }

    return await sendTelegramMessage(botToken, chatId, text);
  } catch (err) {
    console.error(`TG sendAlert error: ${err.message}`);
    return false;
  }
}
