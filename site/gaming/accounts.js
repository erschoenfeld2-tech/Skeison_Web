// Verknuepfbare Konten fuer die Gaming-Profile: Name, Farbe, Kurzzeichen, Eingabepruefung und Link zum Profil.
// live: die Edge Function gp-sync prueft das Konto beim Verknuepfen und holt Live-Daten (Rang, Spielzeit, Mitglieder ...).
// check(handle) liefert den bereinigten Wert oder '' (ungueltig). url(handle, extra, data) liefert den Profil-Link oder ''.
(function () {
  'use strict';
  var enc = encodeURIComponent;
  function trim(s) { return String(s || '').trim(); }
  function riot(s) { s = trim(s).replace(/\s*#\s*/, '#'); return /^[^#]{3,16}#[^#]{2,5}$/.test(s) ? s : ''; }
  function plain(re) { return function (s) { s = trim(s).replace(/^@/, ''); return re.test(s) ? s : ''; }; }
  function lastPath(s) { s = trim(s); var m = s.match(/(?:https?:\/\/)?[^/]+\/(?:@)?([^/?#]+)\/?(?:[?#].*)?$/); return m && /\./.test(s.split('/')[0] || '') ? m[1] : s.replace(/^@/, ''); }

  var REGIONS = [['eu', 'Europa'], ['na', 'Nordamerika'], ['ap', 'Asien/Pazifik'], ['kr', 'Korea'], ['latam', 'Lateinamerika'], ['br', 'Brasilien']];
  var LOL = [['euw', 'EU West'], ['eune', 'EU Nord/Ost'], ['na', 'Nordamerika'], ['kr', 'Korea'], ['br', 'Brasilien'], ['tr', 'Türkei'], ['oce', 'Ozeanien']];

  var KINDS = [
    { key: 'valorant', name: 'Valorant', short: 'VAL', color: '#ff4655', live: true, label: 'Riot-ID', placeholder: 'Name#TAG',
      hint: 'Deine Riot-ID wie im Spiel, mit #Tag.', regions: REGIONS, check: riot,
      url: function (h) { return 'https://tracker.gg/valorant/profile/riot/' + enc(h) + '/overview'; } },
    { key: 'steam', name: 'Steam', short: 'ST', color: '#66c0f4', live: true, label: 'Profil-Link oder Steam-ID', placeholder: 'https://steamcommunity.com/id/…',
      hint: 'Link zu deinem Steam-Profil (oder die 17-stellige ID). Für Spielzeiten muss „Spieldetails“ öffentlich sein.',
      check: function (s) {
        s = trim(s);
        var id = s.match(/(7656\d{13})/); if (id) return id[1];
        var v = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/); if (v) return v[1];
        return /^[A-Za-z0-9_-]{2,32}$/.test(s) ? s : '';
      },
      url: function (h, x, d) { return d && d.url ? d.url : (/^7656\d{13}$/.test(h) ? 'https://steamcommunity.com/profiles/' + h + '/' : 'https://steamcommunity.com/id/' + enc(h) + '/'); } },
    { key: 'minecraft', name: 'Minecraft', short: 'MC', color: '#5d9c32', live: true, label: 'Minecraft-Name', placeholder: 'Spielername',
      hint: 'Java-Edition-Name. Dein Skin vom Konto wird automatisch mit angezeigt.', check: plain(/^[A-Za-z0-9_]{3,16}$/),
      url: function (h) { return 'https://namemc.com/profile/' + enc(h); } },
    { key: 'discord', name: 'Discord', short: 'DC', color: '#5865f2', live: true, label: 'Server-Einladung oder Benutzername', placeholder: 'discord.gg/… oder name',
      hint: 'Eine dauerhafte Einladung zeigt Mitglieder und wer online ist; ein Benutzername wird nur angezeigt.',
      check: function (s) {
        s = trim(s);
        var m = s.match(/discord(?:app)?\.(?:gg|com)\/(?:invite\/)?([A-Za-z0-9-]{2,32})/); if (m) return 'discord.gg/' + m[1];
        return /^[a-z0-9_.]{2,32}$/i.test(s) ? s.toLowerCase() : '';
      },
      invite: function (h) { return /^discord\.gg\//.test(h); },
      url: function (h) { return /^discord\.gg\//.test(h) ? 'https://' + h : ''; } },
    { key: 'epic', name: 'Epic Games / Fortnite', short: 'EG', color: '#d8d8d8', label: 'Epic-Anzeigename', placeholder: 'Anzeigename',
      check: plain(/^.{3,32}$/), url: function (h) { return 'https://fortnitetracker.com/profile/all/' + enc(h); } },
    { key: 'xbox', name: 'Xbox', short: 'XB', color: '#107c10', label: 'Gamertag', placeholder: 'Gamertag',
      check: plain(/^[A-Za-z0-9 ]{1,16}(#\d{1,4})?$/), url: function (h) { return 'https://www.xbox.com/de-DE/play/user/' + enc(h); } },
    { key: 'playstation', name: 'PlayStation', short: 'PS', color: '#0070d1', label: 'PSN-ID', placeholder: 'Online-ID',
      check: plain(/^[A-Za-z][A-Za-z0-9_-]{2,15}$/), url: function (h) { return 'https://psnprofiles.com/' + enc(h); } },
    { key: 'nintendo', name: 'Nintendo Switch', short: 'NS', color: '#e60012', label: 'Freundescode', placeholder: 'SW-1234-5678-9012',
      check: function (s) { var d = trim(s).replace(/\D/g, ''); return d.length === 12 ? 'SW-' + d.slice(0, 4) + '-' + d.slice(4, 8) + '-' + d.slice(8) : ''; },
      url: function () { return ''; } },
    { key: 'battlenet', name: 'Battle.net', short: 'BN', color: '#148eff', label: 'BattleTag', placeholder: 'Name#1234',
      check: function (s) { s = trim(s).replace(/\s*#\s*/, '#'); return /^[^#\s]{3,12}#\d{4,6}$/.test(s) ? s : ''; }, url: function () { return ''; } },
    { key: 'ea', name: 'EA', short: 'EA', color: '#ff4747', label: 'EA-ID', placeholder: 'EA-ID', check: plain(/^[A-Za-z0-9_-]{4,16}$/), url: function () { return ''; } },
    { key: 'ubisoft', name: 'Ubisoft Connect', short: 'UB', color: '#0070ff', label: 'Ubisoft-Name', placeholder: 'Benutzername',
      check: plain(/^[A-Za-z0-9._-]{3,15}$/), url: function (h) { return 'https://r6.tracker.network/r6siege/profile/ubi/' + enc(h) + '/overview'; } },
    { key: 'lol', name: 'League of Legends', short: 'LoL', color: '#c89b3c', label: 'Riot-ID', placeholder: 'Name#TAG', regions: LOL, check: riot,
      url: function (h, x) { var p = h.split('#'); return 'https://www.op.gg/summoners/' + ((x && x.region) || 'euw') + '/' + enc(p[0]) + '-' + enc(p[1] || ''); } },
    { key: 'twitch', name: 'Twitch', short: 'TW', color: '#9146ff', label: 'Twitch-Name', placeholder: 'kanalname',
      check: function (s) { s = lastPath(s); return /^[A-Za-z0-9_]{3,25}$/.test(s) ? s : ''; }, url: function (h) { return 'https://www.twitch.tv/' + enc(h); } },
    { key: 'youtube', name: 'YouTube', short: 'YT', color: '#ff0000', label: 'Kanal (@Name oder Link)', placeholder: '@kanal',
      check: function (s) {
        s = trim(s); var c = s.match(/youtube\.com\/(channel\/UC[A-Za-z0-9_-]{22})/); if (c) return c[1];
        s = lastPath(s); return /^[A-Za-z0-9._-]{3,30}$/.test(s) ? '@' + s : '';
      },
      url: function (h) { return 'https://www.youtube.com/' + (h.indexOf('channel/') === 0 ? h : h); } },
    { key: 'tiktok', name: 'TikTok', short: 'TT', color: '#25f4ee', label: 'TikTok-Name', placeholder: '@name',
      check: function (s) { s = lastPath(s); return /^[A-Za-z0-9._]{2,24}$/.test(s) ? '@' + s : ''; }, url: function (h) { return 'https://www.tiktok.com/' + h; } }
  ];
  var BY = {}; KINDS.forEach(function (k) { BY[k.key] = k; });

  // Kurztext je Konto fuer Leiste und Karten (aus den Live-Daten, sonst der Name)
  function summary(acc, data) {
    var k = BY[acc.kind]; if (!k) return '';
    if (data) {
      if (acc.kind === 'valorant' && data.rank) return data.rank.name + (data.rank.tier > 2 ? ' · ' + data.rank.rr + ' RR' : '');
      if (acc.kind === 'steam' && data.totalHours) return Math.round(data.totalHours).toLocaleString('de-DE') + ' Std · ' + (data.gameCount || 0) + ' Spiele';
      if (acc.kind === 'discord' && data.members) return data.online + ' online · ' + data.members + ' Mitglieder';
      if (acc.kind === 'minecraft' && data.name) return data.name;
    }
    return acc.handle;
  }

  window.GAccounts = { KINDS: KINDS, BY: BY, summary: summary,
    link: function (acc, data) { var k = BY[acc.kind]; try { return k ? k.url(acc.handle, acc.extra || {}, data) || '' : ''; } catch (e) { return ''; } } };
})();
