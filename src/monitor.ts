export const QUERY = 'macbook pro m3 pro';
export const ENDPOINT = 'https://api.reefapi.com/cex/v1/search';
export type Product = { id: string; title: string; price: number | null; online: number | null };
export type Entry = Product & { lastKnownOnline: number | null };
export type Alert = { key: string; kind: 'new' | 'restock'; product: Product };
export type State = { version: 1; query: string; checkedAt: string | null;
  products: Record<string, Entry>; pending: Alert[] };
export const emptyState = (): State => ({ version: 1, query: QUERY, checkedAt: null, products: {}, pending: [] });
export function object(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Expected object');
  return x as Record<string, unknown>;
}
function nonnegative(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
export function product(x: unknown): Product {
  const b = object(x);
  if (typeof b.boxId !== 'string' || !b.boxId || typeof b.boxName !== 'string' || !b.boxName || !(b.sellPrice == null || nonnegative(b.sellPrice))) throw new Error('Invalid product identity/price');
  const stock = b.ecomQuantityOnHand;
  if (stock != null && (!nonnegative(stock) || !Number.isInteger(stock))) throw new Error('Invalid online quantity');
  return { id: b.boxId, title: b.boxName, price: b.sellPrice == null ? null : b.sellPrice as number, online: stock == null ? null : stock as number };
}
// ReefAPI reference: https://reefapi.com/docs/cex (reviewed 2026-10-31).
export function page(x: unknown): { total: number; page: number; size: number; more: boolean; products: Product[] } {
  const r = object(x);
  if (r.ok !== true) throw new Error('ReefAPI did not return a successful result');
  const d = object(r.data);
  if (d.country !== 'uk' || d.currency !== 'GBP' || d.query !== QUERY) throw new Error('Unexpected search scope');
  if (!Number.isSafeInteger(d.total) || !nonnegative(d.total)) throw new Error('Invalid total');
  if (!Number.isSafeInteger(d.page) || !nonnegative(d.page) || d.page < 1 ||
      !Number.isSafeInteger(d.page_size) || !nonnegative(d.page_size) || d.page_size < 1 || d.page_size > 100 ||
      typeof d.has_more !== 'boolean' || !Array.isArray(d.results) || d.count !== d.results.length) throw new Error('Invalid pagination');
  const products = d.results.map((row: unknown) => {
    const b = object(row);
    if (b.currency !== 'GBP' || b.country !== 'uk') throw new Error('Unexpected product scope');
    // A missing quantity stays unknown, even when an availability flag is present.
    return product({ boxId: b.box_id, boxName: b.title, sellPrice: b.price_sell, ecomQuantityOnHand: b.stock_online });
  });
  return { total: d.total, page: d.page as number, size: d.page_size as number, more: d.has_more, products };
}
export type Fetcher = typeof fetch;
export async function search(key: string, fetcher: Fetcher = fetch, size = 100): Promise<Product[]> {
  if (!key) throw new Error('REEF_API_KEY secret missing');
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('Invalid page size');
  const found = new Map<string, Product>();
  let expected: number | undefined;
  for (let index = 1; index * size <= 1000; index++) {
    let response: Response;
    try {
      response = await fetcher(ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(30000), redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query: QUERY, country: 'uk', page: index, page_size: size, sort: 'name_asc' }) });
    } catch { throw new Error('ReefAPI transport failure'); }
    if (!response.ok) throw new Error(`ReefAPI HTTP ${response.status}; stopping without state changes`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('ReefAPI did not return JSON');
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new Error('Invalid ReefAPI JSON'); }
    const p = page(raw);
    if (p.page !== index || p.size !== size) throw new Error('Unexpected page or page size');
    if (expected !== undefined && p.total !== expected) throw new Error('Search changed during pagination; retry next run');
    expected = p.total;
    if (p.products.length > size || expected > 1000) throw new Error('Pagination bounds exceeded; complete search unavailable');
    for (const item of p.products) {
      if (found.has(item.id)) throw new Error('Repeated ID across pages; incomplete snapshot');
      found.set(item.id, item);
    }
    if (found.size === expected && !p.more) return [...found.values()];
    if (found.size >= expected || !p.more || p.products.length !== size) throw new Error('Incomplete search snapshot');
  }
  throw new Error('Pagination limit');
}
export function inMonitoringWindow(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 8 && hour <= 20;
}
export function matchesM3Pro(p: Product): boolean {
  return /\bMacBook\s+Pro\b.*\bM3\s+Pro\b/i.test(p.title);
}
export function parseState(raw: unknown): State {
  const s = object(raw);
  if (s.version !== 1 || s.query !== QUERY || !(s.checkedAt === null || (typeof s.checkedAt === 'string' && Number.isFinite(Date.parse(s.checkedAt)))) || !Array.isArray(s.pending)) throw new Error('Invalid state');
  const entries = object(s.products);
  for (const [id, value] of Object.entries(entries)) {
    const e = object(value);
    product({ boxId: e.id, boxName: e.title, sellPrice: e.price, ecomQuantityOnHand: e.online });
    if (e.id !== id || !(e.lastKnownOnline === null || (nonnegative(e.lastKnownOnline) && Number.isInteger(e.lastKnownOnline)))) throw new Error('Invalid state entry');
  }
  for (const value of s.pending) {
    const a = object(value); const p = object(a.product);
    if (typeof a.key !== 'string' || !['new', 'restock'].includes(String(a.kind))) throw new Error('Invalid pending alert');
    product({ boxId: p.id, boxName: p.title, sellPrice: p.price, ecomQuantityOnHand: p.online });
  }
  return s as State;
}
export function reconcile(old: State, snapshot: Product[], now: string): State {
  const state: State = structuredClone(old);
  for (const p of snapshot) {
    const previous = Object.hasOwn(state.products, p.id) ? state.products[p.id] : undefined;
    const kind = !previous ? 'new' : previous.lastKnownOnline === 0 && p.online !== null && p.online > 0 ? 'restock' : null;
    if (old.checkedAt !== null && kind) state.pending.push({ key: `${now}:${kind}:${p.id}`, kind, product: p });
    // Absence from search is never treated as zero stock. Unknown preserves last observed quantity.
    Object.defineProperty(state.products, p.id, { value: { ...p, lastKnownOnline: p.online ?? previous?.lastKnownOnline ?? null }, enumerable: true, writable: true, configurable: true });
  }
  state.checkedAt = now;
  return state;
}
export function message(alert: Alert): string {
  const p = alert.product;
  return `${alert.kind === 'new' ? 'New CeX product' : 'CeX returned to online stock'}\n${p.title.slice(0, 500)}\n${p.price === null ? 'Price unavailable' : `£${p.price.toFixed(2)}`}\nOnline stock: ${p.online === null ? 'unavailable (unknown)' : p.online}\nhttps://uk.webuy.com/product-detail?id=${encodeURIComponent(p.id)}\nObserved ${alert.key.split(':new:')[0]?.split(':restock:')[0]}`;
}
export async function notify(alert: Alert, token: string, chat: string, fetcher: Fetcher = fetch): Promise<void> {
  return sendText(message(alert), token, chat, fetcher);
}
export async function sendText(text: string, token: string, chat: string, fetcher: Fetcher = fetch): Promise<void> {
  let r: Response;
  try {
    r = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }) });
  } catch { throw new Error('Telegram transport failure (delivery may be ambiguous)'); }
  if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`);
  if (object(await r.json()).ok !== true) throw new Error('Telegram rejected message');
}
