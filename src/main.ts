import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { emptyState, parseState, reconcile, search, notify, isCheckDue, matchesM3Pro } from './monitor.ts';
import type { State } from './monitor.ts';

const file = 'data/state.json';
const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function save(s: State): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  if (process.env.GITHUB_ACTIONS === 'true') {
    git('add', '--', file);
    if (!git('diff', '--cached', '--name-only')) return;
    git('commit', '-m', 'Persist CeX monitor state [skip ci]');
    // Ordinary non-force push rejects conflicting updates. Never send before durable outbox commit.
    git('push', 'origin', 'HEAD');
  }
}
async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'probe') {
    const products = await search(process.env.REEF_API_KEY ?? '');
    console.log(JSON.stringify({ observedAt: new Date().toISOString(), totalResults: products.length,
      pages: Math.max(1, Math.ceil(products.length / 100)), products: products.filter(matchesM3Pro) }, null, 2));
    return;
  }
  if (mode !== 'monitor') throw new Error('Use probe or monitor');
  if (process.env.MONITOR_ENABLED !== 'true') throw new Error('ReefAPI access not validated; monitor disabled');
  const token = process.env.TELEGRAM_BOT_TOKEN; const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('Telegram secrets missing');
  let state: State;
  try { state = parseState(JSON.parse(await readFile(file, 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') state = emptyState(); else throw e; }
  if (!isCheckDue(new Date(), state.lastAttemptAt ?? state.checkedAt)) {
    console.log('Outside UK monitoring hours or this two-hour slot already attempted; no API calls'); return;
  }
  // Drain durable pending alerts before new observations. Persist each acknowledgement.
  const drain = async (): Promise<void> => {
    while (state.pending.length) {
      await notify(state.pending[0]!, token, chat);
      state.pending.shift();
      await save(state);
    }
  };
  await drain();
  // Reserve the slot durably before spending credits, including if the search fails.
  state.lastAttemptAt = new Date().toISOString();
  await save(state);
  const snapshot = await search(process.env.REEF_API_KEY ?? '');
  state = reconcile(state, snapshot.filter(matchesM3Pro), new Date().toISOString());
  await save(state);
  await drain();
  console.log(`Snapshot saved: ${Object.keys(state.products).length} known IDs`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : 'Monitor failed'); process.exitCode = 1; });
