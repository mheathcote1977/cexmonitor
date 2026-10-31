import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, reconcile, page, search, notify, message, parseState, inMonitoringWindow, matchesM3Pro } from '../src/monitor.ts';
import type { Product, Fetcher } from '../src/monitor.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const p: Product = { id: 'TEST-1', title: 'MacBook Pro M3 Pro', price: 999, online: 0 };
const envelope = (ids: string[], total = ids.length, index = 1, size = 2): unknown => ({ ok: true, data: {
  total, page: index, page_size: size, count: ids.length, has_more: index * size < total,
  country: 'uk', currency: 'GBP', query: 'macbook pro m3 pro',
  results: ids.map(box_id => ({ box_id, title: p.title, price_sell: p.price, stock_online: 0, country: 'uk', currency: 'GBP' }))
} });
const response = (x: unknown): Response => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
test('only M3 Pro MacBooks are selected for alerts', () => {
  assert.equal(matchesM3Pro(p), true);
  assert.equal(matchesM3Pro({ ...p, title: 'MacBook Pro 15,6/M3 Pro (11-CPU 14-GPU)/18GB Ram' }), true);
  assert.equal(matchesM3Pro({ ...p, title: 'MacBook Pro 15,9/M3 Max (16-CPU 40-GPU)' }), false);
  assert.equal(matchesM3Pro({ ...p, title: 'MacBook Pro M3/8GB' }), false);
  assert.equal(matchesM3Pro({ ...p, title: 'MacBook Pro M4 Pro' }), false);
});
test('baseline is silent; new IDs alert exactly once', () => {
  const base = reconcile(emptyState(), [p], '2026-10-31T12:00:00Z');
  assert.equal(base.pending.length, 0);
  const next = reconcile(base, [p, { ...p, id: 'TEST-2', online: null }], '2026-10-31T12:15:00Z');
  assert.equal(next.pending[0]?.kind, 'new');
  assert.equal(reconcile(next, [p], '2026-10-31T12:30:00Z').pending.length, 1);
});
test('known zero to positive alerts; unknown and absence do not invent zero', () => {
  let s = reconcile(emptyState(), [p], '2026-10-31T12:00:00Z');
  s = reconcile(s, [], '2026-10-31T12:15:00Z');
  s = reconcile(s, [{ ...p, online: null }], '2026-10-31T12:30:00Z');
  s = reconcile(s, [{ ...p, online: 2 }], '2026-10-31T12:45:00Z');
  assert.equal(s.pending[0]?.kind, 'restock');
  assert.equal(reconcile(s, [{ ...p, online: 2 }], '2026-10-31T13:00:00Z').pending.length, 1);
  const unknown = reconcile(emptyState(), [{ ...p, online: null }], '2026-10-31T12:00:00Z');
  assert.equal(reconcile(unknown, [{ ...p, online: 1 }], '2026-10-31T12:15:00Z').pending.length, 0);
});
test('schema rejects broken prices and preserves unknown stock', () => {
  assert.throws(() => page({}));
  const good = envelope(['a']) as { data: { results: Record<string, unknown>[] } };
  const row = good.data.results[0]!;
  row.price_sell = '999';
  assert.throws(() => page(good));
  row.price_sell = null; delete row.stock_online;
  assert.equal(page(good).products[0]?.online, null);
  assert.equal(page(good).products[0]?.price, null);
  assert.throws(() => parseState({ ...emptyState(), version: 2 }));
  assert.deepEqual(parseState(emptyState()), emptyState());
});
test('pagination advances one-based pages and collects full results', async () => {
  const offsets: string[] = [];
  const f: Fetcher = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const first = String(body.page); offsets.push(first);
    assert.equal(new Headers(options?.headers).get('x-api-key'), 'fixture');
    assert.equal(body.page_size, 2);
    return response(envelope(first === '1' ? ['a', 'b'] : ['c'], 3, body.page));
  };
  assert.equal((await search('fixture', f, 2)).length, 3);
  assert.deepEqual(offsets, ['1', '2']);
});
test('blocks, HTML, incomplete pages, changed totals and duplicates abort', async () => {
  await assert.rejects(search('fixture', async () => new Response('', { status: 403 })), /403/);
  await assert.rejects(search('fixture', async () => new Response('<html>')), /JSON/);
  await assert.rejects(search('fixture', async () => response(envelope(['a'], 3)), 2), /Incomplete/);
  await assert.rejects(search('fixture', async (_url, options) => response(envelope(['a', 'b'], 3, JSON.parse(String(options?.body)).page)), 2), /Repeated/);
  let call = 0;
  await assert.rejects(search('fixture', async () => response(envelope(['a', 'b'], ++call === 1 ? 3 : 4, call)), 2), /changed/);
});
test('Telegram checks API success and never labels unknown as in stock', async () => {
  const alert = { key: 'test', kind: 'new' as const, product: { ...p, online: null } };
  assert.match(message(alert), /unknown/);
  await assert.rejects(notify(alert, 'SECRET', '1', async () => response({ ok: false })), /rejected/);
  await assert.rejects(notify(alert, 'SECRET', '1', async () => { throw new Error('SECRET'); }), (e: Error) => !e.message.includes('SECRET'));
  await notify(alert, 'SECRET', '1', async (_url, options) => {
    assert.equal(JSON.parse(String(options?.body)).chat_id, '1');
    return response({ ok: true });
  });
});
test('disabled monitor and corrupt state fail without overwriting persisted data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cex-test-'));
  try {
    mkdirSync(join(dir, 'data'));
    const file = join(dir, 'data/state.json');
    writeFileSync(file, '{corrupt');
    const entry = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const env = { ...process.env, MONITOR_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 'fixture', TELEGRAM_CHAT_ID: 'fixture' };
    const disabled = spawnSync(process.execPath, [entry, 'monitor'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(disabled.status, 1);
    assert.match(disabled.stderr, /not validated/);
    const corrupt = spawnSync(process.execPath, [entry, 'monitor'], { cwd: dir, env: { ...env, MONITOR_ENABLED: 'true' }, encoding: 'utf8' });
    assert.equal(corrupt.status, 1);
    assert.equal(readFileSync(file, 'utf8'), '{corrupt');
  } finally { rmSync(dir, { recursive: true }); }
});

test('six two-hourly UK slots follow BST and reject even hours and overnight', () => {
  for (const month of ['01', '07']) {
    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const now = new Date(`2026-${month}-15T${String(utcHour).padStart(2, '0')}:00:00Z`);
      const localHour = (utcHour + (month === '07' ? 1 : 0)) % 24;
      assert.equal(inMonitoringWindow(now), localHour >= 9 && localHour <= 19 && localHour % 2 === 1);
    }
  }
  for (const date of ['2026-03-29', '2026-10-25']) {
    assert.equal(inMonitoringWindow(new Date(`${date}T${date.includes('03-29') ? '08' : '09'}:00:00Z`)), true);
    assert.equal(inMonitoringWindow(new Date(`${date}T21:00:00Z`)), false);
  }
});
test('ReefAPI failures, wrong country and pagination caps abort', async () => {
  await assert.rejects(search('fixture', async () => response({ ok: false, error: { code: 'QUOTA_EXCEEDED' } })), /successful/);
  const wrong = envelope(['a']) as { data: { currency: string } }; wrong.data.currency = 'EUR';
  assert.throws(() => page(wrong), /scope/);
  await assert.rejects(search('fixture', async () => response(envelope(['a', 'b'], 1001)), 2), /bounds/);
  await assert.rejects(search('fixture', async () => { throw new Error('fixture'); }), (e: Error) => !e.message.includes('fixture'));
});

test('five-page credit ceiling stops before requesting page six', async () => {
  let calls = 0;
  await assert.rejects(search('fixture', async () => {
    calls++;
    return response(envelope(['a', 'b'], 11));
  }, 2), /five-page credit budget/);
  assert.equal(calls, 1);
});
