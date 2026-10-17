// Laeuft auf dem Server-PC. Zeigt offene Whitelist-Bewerbungen und gibt sie per RCON frei.
//   node whitelist-admin.js            -> offene Bewerbungen auflisten
//   node whitelist-admin.js approve 5  -> Bewerbung 5: "whitelist add <Name>" + Status approved
//   node whitelist-admin.js reject 5   -> Bewerbung 5 ablehnen
// Zugangsdaten (nur lokal, NIE ins Repo): tools\admin.config.json
//   { "supabaseUrl": "https://pumdupjmmvimlxqvuymg.supabase.co", "serviceKey": "<service_role key>" }
// Der RCON-Befehl wird ueber tools\rcon-cli.js abgesetzt (RCON-Daten aus tools\config.json).
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin.config.json'), 'utf8'));
const api = (q, opt) => fetch(cfg.supabaseUrl + '/rest/v1/whitelist_applications' + q, Object.assign({
  headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation' } }, opt))
  .then(async (r) => { if (!r.ok) throw new Error(r.status + ' ' + await r.text()); return r.json(); });

(async () => {
  const [cmd, id] = process.argv.slice(2);
  if (!cmd) {
    const rows = await api('?status=eq.pending&order=created_at');
    if (!rows.length) return console.log('Keine offenen Bewerbungen.');
    rows.forEach((r) => console.log(`#${r.id}  ${r.minecraft_name}  (Discord: ${r.discord_name})  ${r.created_at}`));
    return console.log('\nFreigeben: node whitelist-admin.js approve <ID>   Ablehnen: ... reject <ID>');
  }
  if (!/^\d+$/.test(id || '') || !['approve', 'reject'].includes(cmd)) throw new Error('Aufruf: approve|reject <ID>');
  const [row] = await api('?id=eq.' + id + '&status=eq.pending');
  if (!row) throw new Error('Keine offene Bewerbung mit dieser ID.');
  if (cmd === 'approve') {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(row.minecraft_name)) throw new Error('Ungueltiger Name.');
    const out = cp.execFileSync(process.execPath, [path.join(__dirname, 'rcon-cli.js'), 'whitelist add ' + row.minecraft_name]).toString().trim();
    console.log('RCON:', out);
  }
  await api('?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: cmd === 'approve' ? 'approved' : 'rejected' }) });
  console.log(`#${id} ${row.minecraft_name}: ${cmd === 'approve' ? 'freigegeben' : 'abgelehnt'}.`);
})().catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
