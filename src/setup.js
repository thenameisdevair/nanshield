import readline from 'readline';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { printBanner } from './display.js';
import { configure as tgConfigure, sendTestMessage } from './telegram.js';

const CONFIG_PATH = path.join(os.homedir(), '.nanshield', 'config.json');

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptMasked(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(question);
    let input = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit();
      } else if (char === '\u007f' || char === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(question + '*'.repeat(input.length));
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

function withDefault(answer, def) {
  return answer.trim() === '' ? def : answer.trim();
}

// ── Telegram-only sub-wizard ──────────────────────────────────────────────────
async function runTgWizard(cfg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.cyan('\nTelegram Alert Setup'));
  console.log(chalk.gray('  Create a bot at t.me/BotFather to get a bot token.'));
  const botToken = await prompt(rl, 'Enter your Telegram Bot Token: ');
  console.log(chalk.gray('  Message @userinfobot on Telegram to get your Chat ID.'));
  const chatId   = await prompt(rl, 'Enter your Telegram Chat ID: ');
  rl.close();

  const trimmedToken = botToken.trim();
  const trimmedChatId = chatId.trim();

  // Save regardless
  cfg.tgBotToken = trimmedToken;
  cfg.tgChatId   = trimmedChatId;
  await fs.outputJson(CONFIG_PATH, cfg, { spaces: 2 });

  if (!trimmedToken || !trimmedChatId) {
    console.log(chalk.yellow('Token or Chat ID empty — saved but not verified.'));
    return;
  }

  console.log(chalk.cyan('Testing Telegram connection...'));
  const ok = await sendTestMessage();
  if (ok) {
    console.log(chalk.green('✓ Telegram connected'));
  } else {
    console.log(chalk.red('✗ Connection failed. Check token and chat ID.'));
    console.log(chalk.gray('  Reconfigure: nanshield setup --tg-only'));
  }
}

export default async function runSetup(options = {}) {
  printBanner();

  // ── --tg-only mode: only re-run TG wizard ────────────────────────────────
  if (options.tgOnly) {
    let cfg = {};
    try {
      if (await fs.pathExists(CONFIG_PATH)) cfg = await fs.readJson(CONFIG_PATH);
    } catch {}
    await runTgWizard(cfg);
    return;
  }

  if (await fs.pathExists(CONFIG_PATH)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, chalk.yellow('Config found. Overwrite? (y/n) '));
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.cyan('Setup cancelled. Existing config kept.'));
      return;
    }
  }

  // Q1-Q3: API key + basic settings
  const apiKey = await promptMasked('Enter your Nansen API key: ');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const chainAnswer    = await prompt(rl, 'Default chain? (base/solana) [base]: ');
  const threshAnswer   = await prompt(rl, 'Risk threshold 0-100? [60]: ');
  const intervalAnswer = await prompt(rl, 'Watch interval in minutes? [5]: ');
  const walletAnswer   = await prompt(rl, 'Nansen wallet name? [default]: ');
  rl.close();

  const defaultChain    = withDefault(chainAnswer, 'base');
  const riskThreshold   = Number(withDefault(threshAnswer, '60'));
  const watchInterval   = Number(withDefault(intervalAnswer, '5'));
  const walletName      = withDefault(walletAnswer, 'default');

  console.log(chalk.cyan('\nTesting API key...'));
  try {
    execSync(
      `nansen research token info --token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --chain base --fields symbol,name`,
      { env: { ...process.env, NANSEN_API_KEY: apiKey }, stdio: 'pipe' }
    );
    console.log(chalk.green('✓ API key verified'));
  } catch {
    console.log(chalk.red('✗ API key test failed — saved anyway, check key at app.nansen.ai'));
  }

  let cfg = { apiKey, defaultChain, riskThreshold, watchInterval, walletName };
  await fs.outputJson(CONFIG_PATH, cfg, { spaces: 2 });

  // Q4: Telegram
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const tgAnswer = await prompt(rl2, '\nConfigure Telegram alerts? (Y/n) ');
  rl2.close();

  if (tgAnswer.trim().toLowerCase() !== 'n') {
    // Reload cfg before passing (may have been written above)
    try { cfg = await fs.readJson(CONFIG_PATH); } catch {}
    await runTgWizard(cfg);
  }

  // Q5: pm2
  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pm2Answer = await prompt(rl3, '\nInstall pm2 for detached watch mode? (Y/n) ');
  rl3.close();

  if (pm2Answer.trim().toLowerCase() !== 'n') {
    console.log(chalk.cyan('Installing pm2 globally...'));
    try {
      execSync('npm install -g pm2', { stdio: 'inherit' });
      console.log(chalk.green('✓ pm2 installed. Use --detach flag in watch commands.'));
    } catch {
      console.log(chalk.red('pm2 install failed. Install manually: npm install -g pm2'));
    }
  }

  console.log(chalk.green('\n✓ NanShield configured. Run: nanshield check <token> --chain base'));
}
