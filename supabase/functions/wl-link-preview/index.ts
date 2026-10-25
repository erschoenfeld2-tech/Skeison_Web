// Liest zu einem Produktlink Titel, Vorschaubild, Beschreibung und Preis (Open Graph, JSON-LD, Meta-Tags).
// Nur fuer angemeldete Nutzer der Wunschliste; private Adressen werden nicht abgerufen.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function blockedHost(host: string) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(local|internal|localhost|lan|home)$/.test(host) || !host.includes('.') && !host.includes(':')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return host.includes(':'); // IPv6-Literale gar nicht erst abrufen
}

async function fetchPage(start: string) {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) throw new Error('blocked');
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
    if (!r.ok) throw new Error('status ' + r.status);
    // Hoechstens ~1,5 MB lesen
    const reader = r.body!.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(size); let o = 0; for (const c of chunks) { buf.set(c.subarray(0, size - o), o); o += c.length; }
    return { html: new TextDecoder().decode(buf), url };
  }
  throw new Error('redirects');
}

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null;
}

function findProduct(node: any, depth = 0): any {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n, depth + 1); if (p) return p; } return null; }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  return findProduct(node['@graph'], depth + 1) ?? findProduct(node.mainEntity, depth + 1);
}

function extract(html: string, base: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    const k = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (k && a.content && !(k in meta)) meta[k] = decode(a.content);
  }
  let product: any = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = findProduct(JSON.parse(m[1].trim())); } catch { /* ungueltiges JSON-LD ueberspringen */ }
    if (product) break;
  }
  const offers = product ? [].concat(product.offers ?? []).flatMap((o: any) => [].concat(o?.offers ?? o)) : [];
  const offer: any = offers.find((o: any) => o && (o.price ?? o.lowPrice) != null) ?? null;
  const img = product ? [].concat(product.image ?? []).map((i: any) => typeof i === 'string' ? i : i?.url ?? i?.contentUrl)[0] : null;

  const title = decode(String(product?.name ?? '')) || meta['og:title'] || meta['twitter:title'] || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
  let image = img || meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || meta['image']
    || html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)/i)?.[1]
    || html.match(/id=["']landingImage["'][^>]*(?:data-old-hires|src)=["']([^"']+)/i)?.[1] || '';
  const description = decode(String(product?.description ?? '')) || meta['og:description'] || meta['description'] || meta['twitter:description'] || '';
  const price = parsePrice(offer?.price ?? offer?.lowPrice) ?? parsePrice(meta['product:price:amount'] ?? meta['og:price:amount'] ?? meta['price'])
    ?? parsePrice(html.match(/"priceAmount"\s*:\s*([\d.]+)/)?.[1]) ?? parsePrice(html.match(/class="a-offscreen">([^<]+)</)?.[1]);
  const currency = String(offer?.priceCurrency ?? meta['product:price:currency'] ?? meta['og:price:currency'] ?? meta['pricecurrency'] ?? 'EUR').toUpperCase();
  if (image) { try { image = new URL(decode(image), base).href.replace(/^http:/, 'https:'); } catch { image = ''; } }
  return {
    title: title.slice(0, 120),
    image: image && image.length <= 2000 ? image : null,
    description: description.slice(0, 400),
    price,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR',
    site: meta['og:site_name'] || new URL(base).hostname.replace(/^www\./, ''),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const supa = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('authorization') ?? '';
  const user = await fetch(`${supa}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } }).catch(() => null);
  if (!user?.ok) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  const target = String(b?.url ?? '').trim();
  if (!/^https?:\/\//i.test(target) || target.length > 2000) return json({ error: 'url' }, 400);
  try {
    const page = await fetchPage(target);
    return json(extract(page.html, page.url));
  } catch (e) {
    return json({ error: 'fetch', detail: String((e as Error).message).slice(0, 80) }, 200);
  }
});
