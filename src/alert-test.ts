import assert from 'node:assert/strict';
import { emptyState, reconcile, message, sendText } from './monitor.ts';
import type { Product } from './monitor.ts';

async function testAlerts(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('Telegram secrets missing');
  // Entirely in-memory fixtures: no ReefAPI calls or repository-state access.
  const existing: Product = { id: 'TEST-RESTOCK', title: 'SIMULATED MacBook Pro M3 Pro', price: 1000, online: 0 };
  const baseline = reconcile(emptyState(), [existing], '2026-01-01T09:00:00Z');
  assert.equal(baseline.pending.length, 0);
  const observedAt = new Date().toISOString();
  const snapshot = [{ ...existing, online: 1 }, { ...existing, id: 'TEST-NEW-ID', online: null }];
  const changed = reconcile(baseline, snapshot, observedAt);
  assert.deepEqual(changed.pending.map(a => a.kind), ['restock', 'new']);
  const acknowledged = { ...changed, pending: [] };
  assert.equal(reconcile(acknowledged, snapshot, observedAt).pending.length, 0);
  for (const alert of changed.pending) {
    const preview = message(alert).split('\n').filter(line => !line.startsWith('https://')).join('\n');
    await sendText(`TEST ONLY — simulated ${alert.kind === 'restock' ? 'return to stock' : 'new product ID'}.\nThis is not real stock or a real price.\n\n${preview}`, token, chat);
    console.log(`Telegram accepted simulated ${alert.kind} alert`);
  }
  console.log('Both detection paths, duplicate suppression, message formatting and Telegram transport passed. Real state untouched; zero ReefAPI calls.');
}
testAlerts().catch((e: unknown) => { console.error(e instanceof Error ? e.message : 'Alert test failed'); process.exitCode = 1; });
