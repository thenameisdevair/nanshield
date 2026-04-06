#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import runSetup from './setup.js';
import runCheck from './check.js';
import runTrade from './trade.js';
import runWatch from './watch.js';

yargs(hideBin(process.argv))
  .scriptName('nanshield')
  .usage('Usage: $0 <command> [options]')

  .command(
    'setup',
    'First-run wizard — configure API key, chain, and wallet',
    () => {},
    () => runSetup()
  )

  .command(
    'check <token>',
    'Run a security scan on a token address',
    (y) => {
      y.positional('token', { describe: 'Token contract address', type: 'string' });
      y.option('chain',     { type: 'string',  default: 'base', describe: 'Chain to scan on' });
      y.option('threshold', { type: 'number',  default: 60,     describe: 'Risk score threshold (0-100)' });
      y.option('report',    { type: 'boolean', default: false,  describe: 'Write NANSHIELD-REPORT.md' });
      y.option('deep',      { type: 'boolean', default: false,  describe: 'Include AI agent analysis (costs 20 credits)' });
      y.option('api-key',   { type: 'string',                   describe: 'Override API key' });
    },
    (argv) => runCheck(argv.token, argv.chain, argv)
  )

  .command(
    'trade <token>',
    'Security scan + conditional DEX execution',
    (y) => {
      y.positional('token', { describe: 'Token contract address', type: 'string' });
      y.option('chain',        { type: 'string',  default: 'base',  describe: 'Chain to trade on' });
      y.option('amount',       { type: 'number',                    describe: 'Amount to trade', demandOption: true });
      y.option('amount-unit',  { type: 'string',  default: 'token', describe: 'Amount unit', choices: ['token', 'base'] });
      y.option('execute',      { type: 'boolean', default: false,   describe: 'Execute trade if scan passes' });
      y.option('force',        { type: 'boolean', default: false,   describe: 'Override security gate' });
      y.option('threshold',    { type: 'number',  default: 60,      describe: 'Risk score threshold (0-100)' });
      y.option('wallet',       { type: 'string',  default: 'default', describe: 'Nansen wallet name' });
      y.option('api-key',      { type: 'string',                    describe: 'Override API key' });
    },
    (argv) => runTrade(argv.token, argv.chain, argv)
  )

  .command(
    'watch <token>',
    'Continuously monitor token risk and log alerts',
    (y) => {
      y.positional('token', { describe: 'Token contract address', type: 'string' });
      y.option('chain',     { type: 'string', default: 'base', describe: 'Chain to monitor' });
      y.option('interval',  { type: 'number', default: 5,      describe: 'Poll interval in minutes' });
      y.option('threshold', { type: 'number', default: 60,     describe: 'Risk score threshold (0-100)' });
      y.option('api-key',   { type: 'string',                  describe: 'Override API key' });
    },
    (argv) => runWatch(argv.token, argv.chain, argv)
  )

  .demandCommand(1, 'Specify a command: setup | check | trade | watch')
  .strict()
  .help()
  .version()
  .parse();
