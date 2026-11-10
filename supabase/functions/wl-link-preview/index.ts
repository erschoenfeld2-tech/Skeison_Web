// Liest zu einem Produktlink Titel, Vorschaubild, Beschreibung und Preis (Open Graph, JSON-LD, Meta-Tags,
// Amazon-Hauptbild, sonst das erste brauchbare Bild der Seite; bei gesperrten Amazon-Seiten ueber die Artikelnummer).
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

// Private oder besondere Adressen (fuer aufgeloeste IPs)
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
// Auch Namen pruefen, die auf private Adressen zeigen (z. B. 127.0.0.1.nip.io). Gibt es kein DNS-API, bleibt es bei der Namenspruefung.
async function resolvesPrivate(host: string) {
  const resolve = (Deno as any).resolveDns as undefined | ((h: string, t: string) => Promise<string[]>);
  if (typeof resolve !== 'function') return false;
  const ips = (await Promise.all(['A', 'AAAA'].map((t) => resolve(host, t).catch(() => [] as string[])))).flat();
  return ips.some(privateIp);
}

// Zeichensatz aus dem Content-Type-Header oder <meta charset> lesen (viele aeltere Shops nutzen ISO-8859-1)
function decodeHtml(buf: Uint8Array, contentType: string | null) {
  let cs = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!cs) {
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 4096));
    cs = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
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
    // Hoechstens ~1,5 MB lesen
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
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  // "1.299" = deutscher Tausenderpunkt (Preise mit drei Nachkommastellen gibt es praktisch nicht)
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
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

// Attribute eines Tags lesen (beliebige Reihenfolge, mit oder ohne Anfuehrungszeichen)
function attrs(tag: string) {
  const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}

// Sperr- oder Captcha-Seite statt Produktseite (Amazon, Cloudflare & Co.): dann nichts daraus uebernehmen
function isBotWall(html: string) {
  return html.length < 20000 && /captcha|robot check|api-services-support@amazon|validatecaptcha|just a moment\.\.\.|cf-chl-|access denied|tut uns leid/i.test(html);
}

// Amazon: Hauptbild der Produktseite. Amazon schreibt id="landingImage" HINTER src und data-old-hires,
// deshalb das ganze Tag suchen und die Attribute einzeln lesen. Groesste Variante bevorzugen.
function amazonImageFromHtml(html: string) {
  const tag = html.match(/<img\b[^>]*\bid=["'](?:landingImage|imgBlkFront|ebooksImgBlkFront|main-image)["'][^>]*>/i)?.[0];
  if (tag) {
    const a = attrs(tag);
    if (/^https?:\/\//.test(a['data-old-hires'] ?? '')) return a['data-old-hires'];
    const dyn = a['data-a-dynamic-image'];
    if (dyn) {
      try {
        const sizes = JSON.parse(decode(dyn)) as Record<string, number[]>;
        const best = Object.entries(sizes).sort((x, y) => (y[1][0] * y[1][1]) - (x[1][0] * x[1][1]))[0]?.[0];
        if (best) return best;
      } catch { /* kaputtes JSON ueberspringen */ }
    }
    if (/^https?:\/\//.test(a.src ?? '')) return a.src;
  }
  const hi = html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/)?.[1] ?? html.match(/"large"\s*:\s*"(https:\/\/[^"]*\/images\/I\/[^"]+)"/)?.[1];
  if (hi) return hi;
  return html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[\w%+.-]+\.(?:jpe?g|png|webp)/)?.[0] ?? '';
}

// Allgemeiner Fallback: das erste brauchbare Bild im Seiteninhalt (keine Logos, Icons, Sprites, Tracking-Pixel)
function firstImage(html: string) {
  const start = html.search(/<body\b/i);
  const body = start >= 0 ? html.slice(start) : html;
  for (const tag of body.match(/<img\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const set = (a.srcset || a['data-srcset'] || '').split(',')[0].trim().split(/\s+/)[0];
    const src = a['data-zoom-image'] || a['data-large_image'] || a['data-src'] || a['data-original'] || a['data-lazy-src'] || a.src || set;
    if (!src || /^data:/i.test(src)) continue;
    if (/\.svg(\?|#|$)|\.gif(\?|#|$)/i.test(src)) continue;
    if (/(^|[\/_.-])(sprites?|logos?|icons?|favicon|pixel|spacer|blank|placeholder|loader|loading|tracking|badges?|flags?|avatars?|payment|rating|stars?)([\/_.-]|$)/i.test(src)) continue;
    const w = parseInt(a.width ?? ''), h = parseInt(a.height ?? '');
    if ((w && w < 100) || (h && h < 100)) continue;
    return decode(src);
  }
  return '';
}

// Amazon-Artikelnummer (ASIN) aus einem Produktlink, auch nach Weiterleitung von amzn.eu / amzn.to
function amazonAsin(link: string) {
  try {
    const u = new URL(link);
    if (!/(^|\.)amazon\.[a-z.]{2,6}$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/asin|product)\/([A-Z0-9]{10})(?=[/?#]|$)/i);
    const asin = m?.[1] ?? u.searchParams.get('asin') ?? u.searchParams.get('ASIN') ?? '';
    return /^[A-Z0-9]{10}$/i.test(asin) ? asin.toUpperCase() : null;
  } catch { return null; }
}
// Viele Amazon-Links tragen den Produktnamen im Pfad: /Echo-Dot-5-Gen/dp/B09B8XJDW5
function amazonTitleFromUrl(link: string) {
  try {
    const slug = new URL(link).pathname.match(/^\/([^/]{6,})\/(?:dp|gp\/product)\//)?.[1];
    return slug ? decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  } catch { return ''; }
}
// Gibt Amazon die Seite nicht heraus, liefert das Bildarchiv ueber die ASIN oft trotzdem das Produktfoto.
// Fuer manche Artikel kommt nur ein 1x1-Platzhalter (GIF, 43 Byte) zurueck; den erkennen wir an Typ und Groesse.
async function amazonImageByAsin(asin: string) {
  const url = `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX500_.jpg`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const type = r.headers.get('content-type') ?? '';
    const size = (await r.arrayBuffer()).byteLength;
    return r.ok && /^image\/(jpeg|png|webp)/.test(type) && size > 1000 ? url : '';
  } catch { return ''; }
}

function extract(html: string, base: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
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
  // Reihenfolge: Produktdaten (JSON-LD) -> Vorschaubild (Open Graph/Twitter) -> Amazon-Hauptbild -> image_src -> erstes Bild der Seite
  let image = img || meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || meta['image']
    || amazonImageFromHtml(html)
    || html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)/i)?.[1]
    || firstImage(html) || '';
  const description = decode(String(product?.description ?? '')) || meta['og:description'] || meta['description'] || meta['twitter:description'] || '';
  const price = parsePrice(offer?.price ?? offer?.lowPrice) ?? parsePrice(meta['product:price:amount'] ?? meta['og:price:amount'] ?? meta['price'])
    ?? parsePrice(html.match(/"priceAmount"\s*:\s*([\d.]+)/)?.[1]) ?? parsePrice(html.match(/class="a-offscreen">([^<]+)</)?.[1]);
  const currency = String(offer?.priceCurrency ?? meta['product:price:currency'] ?? meta['og:price:currency'] ?? meta['pricecurrency'] ?? 'EUR').toUpperCase();
  if (image) { try { image = new URL(decode(image), base).href.replace(/^http:/, 'https:'); } catch { image = ''; } }
  // Amazon haengt den Shopnamen an ("Amazon.de: Echo Dot …", "Harry Potter: Amazon.de: Bücher")
  const clean = /(^|\.)amazon\./i.test(new URL(base).hostname)
    ? title.replace(/^amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*amazon\.[a-z.]+(\s*:.*)?$/i, '').trim() || title
    : title;
  return {
    title: clean.slice(0, 120),
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
    const blocked = !page.ok || isBotWall(page.html);
    const out = blocked
      ? { title: '', image: null as string | null, description: '', price: null as number | null, currency: 'EUR', site: new URL(page.url).hostname.replace(/^www\./, '') }
      : extract(page.html, page.url);
    // Amazon sperrt Abrufe aus Rechenzentren oft (503 oder Captcha). Bild und Titel dann ueber Artikelnummer und Link.
    const asin = amazonAsin(page.url) ?? amazonAsin(target);
    if (asin && !out.image) out.image = (await amazonImageByAsin(asin)) || null;
    if (asin && !out.title) out.title = amazonTitleFromUrl(page.url) || amazonTitleFromUrl(target);
    if (blocked && !out.image && !out.title) return json({ error: 'fetch', detail: 'blocked' }, 200);
    return json({ ...out, partial: blocked });
  } catch (e) {
    return json({ error: 'fetch', detail: String((e as Error).message).slice(0, 80) }, 200);
  }
});
