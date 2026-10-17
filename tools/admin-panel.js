// Lokales Admin-Panel fuer Whitelist-Bewerbungen. Nur auf diesem PC erreichbar: http://127.0.0.1:8090
// Nutzt tools\admin.config.json (supabaseUrl, serviceKey) und tools\rcon-cli.js (RCON-Daten aus tools\config.json).
// Start: admin-panel.bat  (kein Autostart, kein Zugriff von aussen)
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), cp = require('child_process');

const PORT = +process.env.ADMIN_PORT || 8090;
const cfg = JSON.parse(fs.readFileSync(process.env.ADMIN_CONFIG || path.join(__dirname, 'admin.config.json'), 'utf8'));
const RCON_CLI = process.env.RCON_CLI || path.join(__dirname, 'rcon-cli.js');
const TOKEN = crypto.randomBytes(24).toString('hex'); // pro Start neu; schuetzt vor Aufrufen fremder Webseiten
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

const db = (q, opt) => fetch(cfg.supabaseUrl + '/rest/v1/whitelist_applications' + q, Object.assign({
  headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation' } }, opt))
  .then(async (r) => { if (!r.ok) throw new Error('Datenbank ' + r.status); return r.json(); });
const rcon = (cmd) => cp.execFileSync(process.execPath, [RCON_CLI, cmd], { timeout: 15000 }).toString().trim();

const PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Whitelist-Admin</title><style>
:root{--bg:#0e1220;--panel:#171d33;--line:#2b3560;--text:#eaf0ff;--muted:#97a3c7;--acc:#ffcb05;--ok:#3ddc84;--red:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px}.muted{color:var(--muted)}
.tabs{display:flex;gap:8px;margin:18px 0}.tabs button{cursor:pointer;font:inherit;font-weight:600;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 16px}
.tabs button.on{background:var(--acc);color:#1a1500;border-color:var(--acc)}
.card{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:10px}
.mc{font-weight:700;font-size:1.1rem}.dc{color:var(--muted);font-size:.9rem}
.b{cursor:pointer;font:inherit;font-weight:700;border:0;border-radius:9px;padding:7px 14px;margin-left:6px}.ok{background:var(--ok);color:#06210f}.no{background:none;border:1px solid var(--line);color:var(--text)}
.tag{font-size:.8rem;font-weight:700;padding:2px 10px;border-radius:99px;border:1px solid var(--line)}.tag.approved{color:var(--ok)}.tag.rejected{color:var(--red)}
#msg{min-height:1.5em;font-weight:600}.err{color:var(--red)}.good{color:var(--ok)}
</style></head><body><main><h1>Whitelist-Bewerbungen</h1><p class="muted">Freigeben fuehrt <code>whitelist add</code> per RCON auf dem Server aus.</p>
<div class="tabs"><button class="on" data-s="pending">Offen</button><button data-s="done">Erledigt</button><button id="reload">Neu laden</button></div>
<p id="msg" role="status"></p><div id="list"></div></main>
<script>
var TOKEN=__TOKEN__,tab='pending',$=function(i){return document.getElementById(i)};
function say(t,bad){var m=$('msg');m.textContent=t;m.className=bad?'err':'good'}
function api(p,o){o=o||{};o.headers={'X-Admin-Token':TOKEN,'Content-Type':'application/json'};return fetch(p,o).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);return j})})}
function load(){api('/api/list?s='+tab).then(function(rows){var l=$('list');l.textContent='';
 if(!rows.length){var p=document.createElement('p');p.className='muted';p.textContent=tab==='pending'?'Keine offenen Bewerbungen.':'Noch nichts erledigt.';l.appendChild(p)}
 rows.forEach(function(r){var c=document.createElement('div');c.className='card';var a=document.createElement('div');
  var mc=document.createElement('div');mc.className='mc';mc.textContent=r.minecraft_name;
  var dc=document.createElement('div');dc.className='dc';dc.textContent='Discord: '+r.discord_name+' · '+new Date(r.created_at).toLocaleString('de-DE');
  a.appendChild(mc);a.appendChild(dc);c.appendChild(a);var b=document.createElement('div');
  if(r.status==='pending'){b.appendChild(btn('Freigeben','b ok',function(){act('approve',r)}));b.appendChild(btn('Ablehnen','b no',function(){act('reject',r)}))}
  else{var t=document.createElement('span');t.className='tag '+r.status;t.textContent=r.status==='approved'?'freigegeben':'abgelehnt';b.appendChild(t)}
  c.appendChild(b);l.appendChild(c)})}).catch(function(e){say('Fehler: '+e.message,1)})}
function btn(t,c,f){var b=document.createElement('button');b.className=c;b.textContent=t;b.onclick=f;return b}
function act(what,r){if(what==='approve'&&!confirm(r.minecraft_name+' auf die Whitelist setzen?'))return;say('...');
 api('/api/'+what,{method:'POST',body:JSON.stringify({id:r.id})}).then(function(j){say(j.message);load()}).catch(function(e){say('Fehler: '+e.message,1)})}
document.querySelectorAll('.tabs button[data-s]').forEach(function(b){b.onclick=function(){tab=b.dataset.s;document.querySelectorAll('.tabs button[data-s]').forEach(function(x){x.classList.toggle('on',x===b)});load()}});
$('reload').onclick=load;load();setInterval(function(){if(!document.hidden)load()},30000);
</script></body></html>`;

const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 2000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ok({}); } }); });

http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, { error: 'verboten' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE.replace('__TOKEN__', JSON.stringify(TOKEN)), 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/') || req.headers['x-admin-token'] !== TOKEN) return send(res, 403, { error: 'verboten' });
    if (req.method === 'GET' && url.pathname === '/api/list') {
      const f = url.searchParams.get('s') === 'pending' ? 'status=eq.pending&order=created_at.asc' : 'status=neq.pending&order=created_at.desc&limit=100';
      return send(res, 200, await db('?' + f));
    }
    if (req.method === 'POST' && (url.pathname === '/api/approve' || url.pathname === '/api/reject')) {
      const id = (await readBody(req)).id;
      if (!Number.isInteger(id)) return send(res, 400, { error: 'ungueltige ID' });
      const [row] = await db('?id=eq.' + id + '&status=eq.pending');
      if (!row) return send(res, 404, { error: 'Bewerbung nicht mehr offen' });
      const approve = url.pathname === '/api/approve';
      let note = '';
      if (approve) {
        if (!NAME_RE.test(row.minecraft_name)) return send(res, 400, { error: 'ungueltiger Name' });
        note = rcon('whitelist add ' + row.minecraft_name);
      }
      await db('?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: approve ? 'approved' : 'rejected' }) });
      return send(res, 200, { message: row.minecraft_name + (approve ? ' freigegeben. ' + note : ' abgelehnt.') });
    }
    send(res, 404, { error: 'nicht gefunden' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log('Admin-Panel: http://127.0.0.1:' + PORT + '  (Strg+C beendet)'));
