import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseState, inMonitoringWindow, sendText } from './monitor.ts';

async function setup(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('Telegram secrets missing');
  const before = parseState(JSON.parse(await readFile('data/state.json', 'utf8')));
  if (before.checkedAt === null) {
    if (!inMonitoringWindow(new Date())) throw new Error('Run baseline setup during UK monitoring hours');
    // Uses the production commit/push path. First snapshot is silent.
    const run = spawnSync(process.execPath, ['src/main.ts', 'monitor'], {
      stdio: 'inherit', env: { ...process.env, MONITOR_ENABLED: 'true' }
    });
    if (run.status !== 0) throw new Error('Baseline setup failed; schedule remains disabled');
  }
  const state = parseState(JSON.parse(await readFile('data/state.json', 'utf8')));
  if (state.checkedAt === null) throw new Error('No baseline saved');
  await sendText(`CeX monitor connection test passed.\nBaseline saved: ${Object.keys(state.products).length} MacBook Pro M3 Pro product IDs.\nChecks are configured for 09:00, 11:00, 13:00, 15:00, 17:00 and 19:00 UK time.\nThis is a setup message, not a stock alert.`, token, chat);
  console.log('Telegram accepted setup message; repository baseline verified');
}
setup().catch((e: unknown) => { console.error(e instanceof Error ? e.message : 'Setup failed'); process.exitCode = 1; });
