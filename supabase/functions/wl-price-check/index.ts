// Prueft an Aktionstagen (Black Week, Black Friday, Cyber Monday …) die Preise aller Produktlinks der Wunschlisten.
// Aufruf nur aus pg_cron (private.wl_price_run, Header x-webhook-secret = app_config.price_check_secret).
// Je Aufruf bis zu 40 Links, die laenger als 6 Stunden nicht geprueft wurden; die Arbeit laeuft im Hintergrund weiter,
// die Antwort kommt sofort. Der eingetragene Preis bleibt unveraendert, das Ergebnis landet in wl_items.price_now.
// Seitenabruf und Preis-Erkennung wie in wl-link-preview (dort auch die Erklaerungen).
const supa = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rpc = (fn: string, body: unknown) =>
  fetch(`${supa}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(async (r) => {
    if (!r.ok) throw new Error(fn + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  });

function blockedHost(host: string) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(local|internal|localhost|lan|home)$/.test(host) || !host.includes('.') && !host.includes(':')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return host.includes(':');
}
function privateIp(ip: string) {
  ip = ip.toLowerCase();
  const m4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) {
    const [a, b] = [+m4[1], +m4[2]];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('::ffff:');
}
async function resolvesPrivate(host: string) {
  const resolve = (Deno as any).resolveDns as undefined | ((h: string, t: string) => Promise<string[]>);
  if (typeof resolve !== 'function') return false;
  const ips = (await Promise.all(['A', 'AAAA'].map((t) => resolve(host, t).catch(() => [] as string[])))).flat();
  return ips.some(privateIp);
}
function decodeHtml(buf: Uint8Array, contentType: string | null) {
  let cs = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!cs) cs = new TextDecoder('latin1').decode(buf.subarray(0, 4096)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return new TextDecoder().decode(buf); }
}
async function fetchPage(start: string) {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname) || await resolvesPrivate(u.hostname)) throw new Error('blocked');
    const r = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
      },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location')!, u).href; continue; }
    const reader = r.body!.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(size); let o = 0; for (const c of chunks) { buf.set(c.subarray(0, size - o), o); o += c.length; }
    return { html: decodeHtml(buf, r.headers.get('content-type')), url, ok: r.ok };
  }
  throw new Error('redirects');
}
const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isFinite(n) && n > 0 && n < 1e8 ? Math.round(n * 100) / 100 : null;
}
function findProduct(node: any, depth = 0): any {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n, depth + 1); if (p) return p; } return null; }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  return findProduct(node['@graph'], depth + 1) ?? findProduct(node.mainEntity, depth + 1);
}
function attrs(tag: string) {
  const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}
function isBotWall(html: string) {
  return html.length < 20000 && /captcha|robot check|api-services-support@amazon|validatecaptcha|just a moment\.\.\.|cf-chl-|access denied|tut uns leid/i.test(html);
}

// Aktueller Preis der Seite. Stehen mehrere Preise zur Wahl (Varianten, Groessen), nehmen wir den, der dem
// eingetragenen Preis am naechsten liegt: lieber einen Rabatt uebersehen als einen falschen melden.
function currentPrice(html: string, stored: number) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const k = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (k && a.content && !(k in meta)) meta[k] = decode(a.content);
  }
  let product: any = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = findProduct(JSON.parse(m[1].trim())); } catch { /* ungueltiges JSON-LD */ }
    if (product) break;
  }
  const offers: any[] = product ? [].concat(product.offers ?? []).flatMap((o: any) => [].concat(o?.offers ?? o)).filter(Boolean) : [];
  let currency = String(offers.find((o) => o.priceCurrency)?.priceCurrency ?? meta['product:price:currency'] ?? meta['og:price:currency'] ?? meta['pricecurrency'] ?? 'EUR').toUpperCase();
  let cands = offers.map((o) => parsePrice(o.price ?? o.priceSpecification?.price)).filter((p): p is number => p != null);
  if (!cands.length) cands = offers.map((o) => parsePrice(o.lowPrice)).filter((p): p is number => p != null);
  if (!cands.length) {
    const p = parsePrice(meta['product:price:amount'] ?? meta['og:price:amount'] ?? meta['price'])
      ?? parsePrice(html.match(/"priceAmount"\s*:\s*([\d.]+)/)?.[1])
      // Amazon: Preis im Kaufkasten (nicht der erste beliebige Preis der Seite)
      ?? parsePrice(html.match(/id="corePrice(?:Display_desktop)?_feature_div"[\s\S]{0,5000}?class="a-offscreen">([^<]+)</)?.[1]);
    if (p != null) cands = [p];
  }
  if (!cands.length) return null;
  const price = cands.reduce((best, p) => Math.abs(p - stored) < Math.abs(best - stored) ? p : best, cands[0]);
  if (!/^[A-Z]{3}$/.test(currency)) currency = 'EUR';
  return { price, currency };
}

async function checkOne(row: { url: string; currency: string; price: number }) {
  try {
    const page = await fetchPage(row.url);
    if (!page.ok || isBotWall(page.html)) return { url: row.url, price: null, currency: row.currency, status: 'blocked' };
    const p = currentPrice(page.html, Number(row.price));
    return p ? { url: row.url, price: p.price, currency: p.currency, status: 'ok' } : { url: row.url, price: null, currency: row.currency, status: 'none' };
  } catch (e) {
    return { url: row.url, price: null, currency: row.currency, status: String((e as Error).message).slice(0, 40) };
  }
}

async function run() {
  const t0 = Date.now();
  const queue: { url: string; currency: string; price: number }[] = await rpc('wl_price_queue', { p_limit: 40 });
  const out: any[] = [];
  let i = 0;
  // 6 Abrufe gleichzeitig, hoechstens ~90 s
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < queue.length && Date.now() - t0 < 90_000) out.push(await checkOne(queue[i++]));
  }));
  if (out.length) await rpc('wl_price_store', { p_rows: out });
  const n = (s: string) => out.filter((x) => x.status === s).length;
  console.log(`wl-price-check: ${out.length}/${queue.length} geprueft, ${n('ok')} mit Preis, ${n('blocked')} gesperrt, ${n('none')} ohne Preis, ${Date.now() - t0} ms`);
  return { checked: out.length, queued: queue.length, ok: n('ok') };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const cfg = await fetch(`${supa}/rest/v1/app_config?key=eq.price_check_secret&select=value`, { headers: H }).then((r) => r.json()).catch(() => null);
  const secret = cfg?.[0]?.value;
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return new Response('forbidden', { status: 403 });
  const job = run().catch((e) => { console.error('wl-price-check', e); return { error: String(e) }; });
  // Auf Wunsch (?wait=1) auf das Ergebnis warten, sonst im Hintergrund weiterarbeiten
  if (new URL(req.url).searchParams.get('wait')) return new Response(JSON.stringify(await job), { headers: { 'Content-Type': 'application/json' } });
  (globalThis as any).EdgeRuntime?.waitUntil?.(job);
  return new Response(JSON.stringify({ started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
