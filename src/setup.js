import readline from 'readline';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { printBanner } from './display.js';

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

export default async function runSetup() {
  printBanner();

  if (await fs.pathExists(CONFIG_PATH)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, chalk.yellow('Config found. Overwrite? (y/n) '));
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.cyan('Setup cancelled. Existing config kept.'));
      return;
    }
  }

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

  await fs.outputJson(CONFIG_PATH, { apiKey, defaultChain, riskThreshold, watchInterval, walletName }, { spaces: 2 });

  console.log(chalk.green('\n✓ NanGuard configured. Run: nanshield check <token> --chain base'));
}
