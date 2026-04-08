import chalk from 'chalk';
import ora from 'ora';
import { printBanner } from './display.js';
import { runNansen, parseArray } from './nansen.js';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

function fmtUsd(n) {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

function truncateAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default async function runDiscover(argv = {}) {
  // 1. Load config
  let config = {};
  try {
    const cfgPath = CONFIG_PATH;
    if (await fs.pathExists(cfgPath)) config = await fs.readJson(cfgPath);
  } catch {}

  const chain     = argv.chain     || config.defaultChain || 'base';
  const timeframe = argv.timeframe || '24h';
  const limit     = argv.limit     || 10;
  const sort      = argv.sort      || 'buy_volume:desc';
  const apiKey    = argv.apiKey    || config.apiKey || process.env.NANSEN_API_KEY;

  if (!apiKey) {
    console.log(chalk.red('✗ No Nansen API key found. Run: nanshield setup'));
    process.exit(1);
  }

  // 2. Header
  printBanner();
  console.log(chalk.bold.cyan(`╔══════════════════════════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║  NanShield Token Discovery — ${chain.padEnd(8)} — ${timeframe.padEnd(15)} ║`));
  console.log(chalk.bold.cyan(`╚══════════════════════════════════════════════════════════╝\n`));

  // 3. Screener call
  const cmd = `nansen research token screener --chain ${chain} --timeframe ${timeframe} --sort ${sort} --limit ${limit}`;
  const spinner = ora('Fetching trending tokens...').start();
  const result = runNansen(cmd, apiKey);
  spinner.stop();

  if (!result.ok) {
    console.log(chalk.red(`✖ Screener call failed: ${result.error ?? 'unknown error'}`));
    process.exit(1);
  }

  const tokens = parseArray(result.data);
  if (!tokens || tokens.length === 0) {
    console.log(chalk.yellow('No tokens returned from screener.'));
    process.exit(0);
  }

  // 4. Table header
  const COL = { num: 3, token: 10, addr: 16, buy: 12, sell: 12, net: 12 };
  const header = [
    ' # '.padEnd(COL.num),
    'Token'.padEnd(COL.token),
    'Address'.padEnd(COL.addr),
    'Buy Vol'.padStart(COL.buy),
    'Sell Vol'.padStart(COL.sell),
    'Net Flow'.padStart(COL.net),
  ].join('  ');

  console.log(chalk.bold(header));
  console.log(chalk.gray('─'.repeat(header.length)));

  // 5. Table rows
  tokens.forEach((t, i) => {
    const symbol  = (t.token_symbol ?? t.symbol ?? t.name ?? '—').slice(0, 9).padEnd(COL.token);
    const rawAddr = t.token_address ?? t.address ?? t.contract_address ?? '';
    const addr    = truncateAddr(rawAddr).padEnd(COL.addr);
    const buyVol  = ('$' + fmtUsd(t.buy_volume_usd ?? t.volume_buy_usd)).padStart(COL.buy);
    const sellVol = ('$' + fmtUsd(t.sell_volume_usd ?? t.volume_sell_usd)).padStart(COL.sell);
    const netRaw  = t.net_flow_usd ?? t.net_flow_1h_usd ?? t.net_flow_24h_usd
                    ?? ((t.buy_volume_usd ?? 0) - (t.sell_volume_usd ?? 0));
    const net     = netRaw ?? 0;
    const netSign = net >= 0 ? '+' : '';
    const netStr  = (`${netSign}$${fmtUsd(net)}`).padStart(COL.net);
    const netColor = net >= 0 ? chalk.green : chalk.red;

    const row = [
      String(i + 1).padStart(2) + ' ',
      chalk.bold(symbol),
      chalk.dim(addr),
      chalk.white(buyVol),
      chalk.white(sellVol),
      netColor(netStr),
    ].join('  ');

    console.log(row);
  });

  // 6. Footer hint
  console.log('');
  console.log(chalk.dim(`  Scan any token:  nanshield check <address> --chain ${chain}`));
  console.log(chalk.dim(`  Trade any token: nanshield trade <address> --chain ${chain} --amount 1 --execute`));
  console.log('');
}
