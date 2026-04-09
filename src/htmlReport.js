import os from 'os';
import path from 'path';
import fs from 'fs-extra';

// ── Minimal Chart.js stub (self-contained, no CDN) ────────────────────────────
// We embed a tiny inline Chart.js implementation for bar + doughnut charts.
// This replaces the full library to keep the file manageable while remaining
// fully offline-capable.
const CHARTJS_INLINE = `
// Minimal Chart.js-compatible renderer (NanShield inline edition)
(function(global) {
  'use strict';
  function Chart(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this._draw();
  }
  Chart.prototype._draw = function() {
    try {
      var type = this.config.type;
      var data = this.config.data;
      var opts = this.config.options || {};
      var c = this.ctx.canvas;
      var w = c.width, h = c.height;
      var ctx = this.ctx;
      ctx.clearRect(0,0,w,h);

      if (type === 'bar') {
        var labels = data.labels || [];
        var dataset = data.datasets[0];
        var values = dataset.data || [];
        var bgColors = dataset.backgroundColor || [];
        var maxVal = Math.max.apply(null, values.map(Math.abs)) || 1;
        var padding = 40, barW = (w - padding*2) / (values.length || 1);
        var baseline = h * 0.6;
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        for (var i=0; i<values.length; i++) {
          var v = values[i];
          var barH = (Math.abs(v)/maxVal) * (h*0.5);
          var x = padding + i*barW;
          ctx.fillStyle = typeof bgColors === 'function' ? bgColors({dataIndex:i}) : (bgColors[i] || '#00ff88');
          var y = v >= 0 ? baseline - barH : baseline;
          ctx.fillRect(x+2, y, barW-4, barH);
          if (labels[i]) {
            ctx.fillStyle = '#888';
            ctx.fillText(labels[i].slice(0,6), x+barW/2, h-4);
          }
        }
        // baseline
        ctx.strokeStyle = '#444';
        ctx.beginPath();
        ctx.moveTo(padding,baseline);
        ctx.lineTo(w-padding,baseline);
        ctx.stroke();
        // title
        if (opts.plugins && opts.plugins.title && opts.plugins.title.text) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(opts.plugins.title.text, w/2, 16);
        }
      }

      if (type === 'doughnut') {
        var dLabels = data.labels || [];
        var dDataset = data.datasets[0];
        var dValues = dDataset.data || [];
        var dColors = dDataset.backgroundColor || ['#00ff88','#ffaa00','#ff4444','#888','#444'];
        var total = dValues.reduce(function(a,b){return a+b;},0) || 1;
        var cx = w/2, cy = h*0.45, r = Math.min(w,h)*0.35;
        var angle = -Math.PI/2;
        for (var j=0; j<dValues.length; j++) {
          var slice = (dValues[j]/total) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx,cy);
          ctx.arc(cx,cy,r,angle,angle+slice);
          ctx.closePath();
          ctx.fillStyle = dColors[j] || '#888';
          ctx.fill();
          // inner hole
          ctx.beginPath();
          ctx.arc(cx,cy,r*0.55,0,Math.PI*2);
          ctx.fillStyle = '#111';
          ctx.fill();
          angle += slice;
        }
        // legend
        ctx.font = '10px monospace';
        var legY = cy + r + 14;
        for (var k=0; k<dLabels.length; k++) {
          var legX = 8 + k * (w/dLabels.length);
          ctx.fillStyle = dColors[k] || '#888';
          ctx.fillRect(legX, legY, 10, 10);
          ctx.fillStyle = '#ccc';
          ctx.textAlign = 'left';
          var pct = total > 0 ? Math.round(dValues[k]/total*100) : 0;
          ctx.fillText(dLabels[k].slice(0,7)+' '+pct+'%', legX+13, legY+9);
        }
      }
    } catch(e) { /* silent */ }
  };
  global.Chart = Chart;
})(window);
`;

// ── Color helpers ─────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score < 40) return '#00ff88';
  if (score < 60) return '#ffaa00';
  return '#ff4444';
}

function verdictText(score) {
  if (score < 40) return 'CLEARED';
  if (score < 60) return 'CLEARED WITH CAUTION';
  if (score < 80) return 'BLOCKED';
  return 'CRITICAL — DO NOT TRADE';
}

function verdictBg(score) {
  if (score < 40) return '#00ff88';
  if (score < 60) return '#ffaa00';
  return '#ff4444';
}

function factorBarColor(score, max) {
  if (score === 0) return '#00ff88';
  if (max > 0 && score / max > 0.5) return '#ff4444';
  return '#ffaa00';
}

function factorLabel(score, max) {
  if (score === 0) return 'CLEAR';
  if (max > 0 && score / max > 0.5) return 'HIGH';
  return 'moderate';
}

// ── HTML generation ───────────────────────────────────────────────────────────
export function buildHtml(scanData) {
  const {
    tokenInfo = {},
    chain = 'base',
    score = 0,
    factors = [],
    callLog = [],
    agentAssessment = null,
    advisorText = null,
    tradeResult = null,
    smNetflow7d = [],
    holderComposition = null,
  } = scanData;

  const symbol    = tokenInfo.symbol || 'UNKNOWN';
  const ts        = new Date().toLocaleString();
  const vText     = verdictText(score);
  const vBg       = verdictBg(score);
  const sColor    = scoreColor(score);
  const vTextColor = score < 40 ? '#000' : '#fff';

  // Factor rows HTML
  const factorRowsHtml = factors.map(f => {
    const pct = f.max > 0 ? Math.round((f.score / f.max) * 100) : 0;
    const barCol = factorBarColor(f.score, f.max);
    const lbl    = factorLabel(f.score, f.max);
    return `
      <div class="factor-row">
        <span class="factor-name">${f.name}</span>
        <div class="factor-bar-wrap">
          <div class="factor-bar" style="width:${pct}%;background:${barCol}"></div>
        </div>
        <span class="factor-score">${f.score}/${f.max}</span>
        <span class="factor-label" style="color:${barCol}">${lbl}</span>
      </div>`;
  }).join('');

  // API call grid HTML
  const callCells = callLog.slice(0, 16).map((c, i) => {
    const icon = c.status === 'ok' ? '✓' : (c.status === 'failed' ? '✗' : '⚠');
    const col  = c.status === 'ok' ? '#00ff88' : (c.status === 'failed' ? '#ff4444' : '#ffaa00');
    const name = (c.command || '').replace(/nansen /, '').split(' ')[0].slice(0, 18);
    return `<div class="call-cell"><div class="call-icon" style="color:${col}">${icon}</div>
      <div class="call-num">${i + 1}</div><div class="call-name">${name}</div></div>`;
  }).join('');

  // SM Netflow chart data
  const netflowLabels = smNetflow7d.map(d => d.date || '').map(d => d.slice(5));
  const netflowValues = smNetflow7d.map(d => d.value || 0);
  const netflowColors = netflowValues.map(v => v >= 0 ? '#00ff88' : '#ff4444');

  // Holder composition data
  const holderData = holderComposition || { Fund: 0, Whale: 0, 'DEX MM': 0, Retail: 0, Unknown: 100 };
  const holderLabels = Object.keys(holderData);
  const holderValues = Object.values(holderData);
  const holderColors = ['#00ff88', '#ffaa00', '#ff4444', '#888', '#444'];

  // Trade block HTML
  const tradeBlockHtml = tradeResult ? `
    <div class="card full-width" style="margin-top:16px">
      <h3 style="color:#ffaa00">Trade Execution</h3>
      <div class="trade-grid">
        <div><span class="label">Spent</span><span class="value">${tradeResult.spend || '—'}</span></div>
        <div><span class="label">Received</span><span class="value">${tradeResult.receive || '—'}</span></div>
        <div><span class="label">Price Impact</span><span class="value">${tradeResult.priceImpact || '—'}</span></div>
        <div><span class="label">Route</span><span class="value">${tradeResult.route || '—'}</span></div>
      </div>
      ${tradeResult.txHash ? `<div style="margin-top:8px"><span class="label">Tx Hash:</span>
        <a href="https://basescan.org/tx/${tradeResult.txHash}" target="_blank" style="color:#00ff88">${tradeResult.txHash}</a>
      </div>` : ''}
    </div>` : '';

  // Agent synthesis HTML
  const agentHtml = agentAssessment ? `
    <div class="card full-width" style="margin-top:16px">
      <h3 style="color:#ffaa00">AI Agent Synthesis</h3>
      <pre class="agent-text">${agentAssessment.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    </div>` : '';

  // Advisor HTML
  const advisorHtml = advisorText ? `
    <div class="card full-width" style="margin-top:16px;border:1px solid #ffaa00">
      <h3 style="color:#ffaa00">Path To Clearance</h3>
      <pre class="agent-text">${advisorText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NanShield — $${symbol} — ${chain}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#fff;font-family:monospace;font-size:14px}
a{color:#00ff88}
.header{background:#111;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #222}
.logo{color:#00ff88;font-size:18px;font-weight:bold}
.header-right{display:flex;align-items:center;gap:16px;color:#888;font-size:12px}
.badge{padding:4px 12px;border-radius:20px;font-weight:bold;font-size:13px;color:${vTextColor};background:${vBg}}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 24px}
.row.full-width-row{display:block;padding:0 24px}
.card{background:#111;border-radius:8px;padding:20px;border:1px solid #1e1e1e}
.full-width{width:100%}
h3{font-size:13px;color:#888;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px}
.score-big{font-size:72px;font-weight:bold;color:${sColor};text-align:center;line-height:1}
.score-verdict{text-align:center;color:${sColor};font-size:13px;margin-top:8px;font-weight:bold}
.gauge-wrap{display:flex;justify-content:center;margin:12px 0}
.gauge-bar{width:80%;height:6px;background:#222;border-radius:3px;overflow:hidden}
.gauge-fill{height:100%;width:${score}%;background:${sColor};border-radius:3px;transition:width 1s}
.factor-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.factor-name{width:160px;color:#ccc;font-size:12px;flex-shrink:0}
.factor-bar-wrap{flex:1;background:#222;height:10px;border-radius:5px;overflow:hidden}
.factor-bar{height:100%;border-radius:5px;transition:width 0.8s}
.factor-score{width:48px;text-align:right;color:#888;font-size:12px;flex-shrink:0}
.factor-label{width:72px;font-size:11px;flex-shrink:0}
canvas{background:#0d0d0d;border-radius:4px;width:100%;height:200px}
.call-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:12px}
.call-cell{background:#0d0d0d;border-radius:4px;padding:8px;text-align:center;border:1px solid #1e1e1e}
.call-icon{font-size:16px;font-weight:bold}
.call-num{font-size:10px;color:#555;margin-top:2px}
.call-name{font-size:9px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agent-text{font-size:12px;color:#ccc;white-space:pre-wrap;line-height:1.6;font-family:monospace}
.trade-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-top:8px}
.label{display:block;font-size:11px;color:#555;margin-bottom:4px}
.value{display:block;font-size:14px;color:#fff;font-weight:bold}
.footer{text-align:center;padding:24px;color:#444;font-size:11px;border-top:1px solid #1a1a1a;margin-top:24px}
</style>
</head>
<body>
<div class="header">
  <div class="logo">🛡 NanShield v2</div>
  <div class="header-right">
    <span>$${symbol} &bull; ${chain.toUpperCase()}</span>
    <span>${ts}</span>
    <div class="badge">${score} — ${vText}</div>
  </div>
</div>

<!-- ROW 1 -->
<div class="row" style="margin-top:16px">
  <div class="card">
    <h3>Risk Score</h3>
    <div class="score-big">${score}</div>
    <div class="gauge-wrap"><div class="gauge-bar"><div class="gauge-fill"></div></div></div>
    <div class="score-verdict">${vText}</div>
  </div>
  <div class="card">
    <h3>Factor Breakdown</h3>
    ${factorRowsHtml}
  </div>
</div>

<!-- ROW 2 -->
<div class="row">
  <div class="card">
    <h3>Smart Money Netflow 7D</h3>
    <canvas id="netflowChart" width="400" height="200"></canvas>
  </div>
  <div class="card">
    <h3>Holder Composition</h3>
    <canvas id="holderChart" width="400" height="200"></canvas>
  </div>
</div>

<!-- ROW 3 trade / ROW 4 agent / ROW 5 api calls / ROW 6 advisor -->
<div class="row full-width-row">
  ${tradeBlockHtml}
  ${agentHtml}

  <div class="card full-width" style="margin-top:16px">
    <h3>API Call Proof</h3>
    <div class="call-grid">${callCells}</div>
    <div style="color:#444;font-size:11px;margin-top:12px;text-align:center">
      ${callLog.length} Nansen API calls — all commands logged and verifiable
    </div>
  </div>

  ${advisorHtml}
</div>

<div class="footer">
  Generated by NanShield v2 &mdash;
  <a href="https://github.com/thenameisdevair/nanshield">github.com/thenameisdevair/nanshield</a>
  &bull; ${ts}
</div>

<script>
${CHARTJS_INLINE}

var netflowCtx = document.getElementById('netflowChart').getContext('2d');
new Chart(netflowCtx, {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(netflowLabels.length ? netflowLabels : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])},
    datasets: [{
      data: ${JSON.stringify(netflowValues.length ? netflowValues : [0,0,0,0,0,0,0])},
      backgroundColor: ${JSON.stringify(netflowColors.length ? netflowColors : ['#00ff88','#00ff88','#ff4444','#00ff88','#ff4444','#00ff88','#00ff88'])}
    }]
  },
  options: { plugins: { title: { display: true, text: 'Smart Money Netflow 7D' } } }
});

var holderCtx = document.getElementById('holderChart').getContext('2d');
new Chart(holderCtx, {
  type: 'doughnut',
  data: {
    labels: ${JSON.stringify(holderLabels)},
    datasets: [{
      data: ${JSON.stringify(holderValues)},
      backgroundColor: ${JSON.stringify(holderColors.slice(0, holderLabels.length))}
    }]
  },
  options: {}
});
</script>
</body>
</html>`;
}

// ── generate(scanData) — write file and optionally open in browser ─────────────
export async function generate(scanData) {
  try {
    const tokenInfo = scanData.tokenInfo || {};
    const symbol    = (tokenInfo.symbol || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '');
    const chain     = (scanData.chain || 'base').replace(/[^A-Za-z0-9_-]/g, '');
    const timeStr   = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');

    const reportDir  = path.join(os.homedir(), '.nanshield', 'reports');
    const fileName   = `NANSHIELD-${symbol}-${chain}-${timeStr}.html`;
    const filePath   = path.join(reportDir, fileName);

    await fs.ensureDir(reportDir);
    const html = buildHtml(scanData);
    await fs.writeFile(filePath, html, 'utf8');

    console.log(`\nHTML report: ${filePath}`);

    // Auto-open in browser if interactive terminal
    if (process.stdout.isTTY) {
      try {
        const { default: openBrowser } = await import('open');
        await openBrowser(filePath);
      } catch { /* silent — file path already printed */ }
    }

    return filePath;
  } catch (err) {
    console.error(`htmlReport.generate error: ${err.message}`);
    return null;
  }
}
