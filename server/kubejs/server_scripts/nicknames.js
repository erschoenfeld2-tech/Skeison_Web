// Spitznamen fuer Spieler, nur fuer Admins (OP-Level 2):
//   /nick <spieler> <name>   setzt den Anzeigenamen (Farbcodes mit &, z. B. "&aGrüner Name")
//   /nick <spieler> reset    stellt den echten Namen wieder her
//   /nicks                   listet alle vergebenen Spitznamen mit echtem Namen
// Der Spitzname erscheint im Chat, in der Tab-Liste und in Servernachrichten (Beitritt, Tod).
// Das Namensschild ueber dem Kopf zeigt weiterhin den echten Namen (das zeichnet der Client selbst).
// Gespeichert wird in den Serverdaten der Welt, die Namen bleiben also nach einem Neustart erhalten.
// Ablage auf dem Server: <Serverordner>/kubejs/server_scripts/nicknames.js (danach Server neu starten)

var NetComponent = Java.loadClass('net.minecraft.network.chat.Component')
var JUUID = Java.loadClass('java.util.UUID')
var MAX_LEN = 32

function nickTag(server) { return server.persistentData.getCompound('nicknames') }
function getNick(server, uuid) { var t = nickTag(server); return t.contains(uuid) ? t.getString(uuid) : null }
function saveNick(server, uuid, nick) {
  var t = nickTag(server)
  if (nick) t.putString(uuid, nick); else t.remove(uuid)
  server.persistentData.put('nicknames', t)
}
// &-Farbcodes in Minecraft-Formatierung umwandeln; am Ende zuruecksetzen, damit nachfolgender Text normal bleibt
function toComponent(nick) { return NetComponent.literal(String(nick).replace(/&([0-9a-fk-or])/gi, '§$1') + '§r') }
function plain(nick) { return String(nick).replace(/&[0-9a-fk-or]/gi, '') }
function refresh(player) {
  player.refreshDisplayName()
  try { player.refreshTabListName() } catch (e) { /* aeltere NeoForge-Version: Tab-Liste aktualisiert sich beim naechsten Beitritt */ }
}

// Anzeigename (Chat, Servernachrichten) und Tab-Liste durch den Spitznamen ersetzen
NativeEvents.onEvent('net.neoforged.neoforge.event.entity.player.PlayerEvent$NameFormat', event => {
  try {
    var pl = event.getEntity(), srv = pl.getServer()
    if (!srv) return
    var nick = getNick(srv, String(pl.uuid))
    if (nick) event.setDisplayname(toComponent(nick))
  } catch (e) { console.error('[nicknames] NameFormat: ' + e) }
})
NativeEvents.onEvent('net.neoforged.neoforge.event.entity.player.PlayerEvent$TabListNameFormat', event => {
  try {
    var pl = event.getEntity(), srv = pl.getServer()
    if (!srv) return
    var nick = getNick(srv, String(pl.uuid))
    if (nick) event.setDisplayName(toComponent(nick))
  } catch (e) { console.error('[nicknames] TabListNameFormat: ' + e) }
})

ServerEvents.commandRegistry(event => {
  var Commands = event.commands, Arguments = event.arguments
  var reply = (ctx, text) => ctx.source.sendSystemMessage(NetComponent.literal(text))

  var setNick = ctx => {
    var target = Arguments.PLAYER.getResult(ctx, 'spieler')
    var nick = String(Arguments.GREEDY_STRING.getResult(ctx, 'name')).replace(/§/g, '').trim()
    var len = plain(nick).length
    if (len < 1 || len > MAX_LEN) { ctx.source.sendFailure(NetComponent.literal('Der Name muss 1–' + MAX_LEN + ' Zeichen lang sein (ohne Farbcodes).')); return 0 }
    saveNick(ctx.source.server, String(target.uuid), nick)
    refresh(target)
    reply(ctx, target.getGameProfile().getName() + ' heißt jetzt ' + plain(nick) + '.')
    target.sendSystemMessage(NetComponent.literal('Ein Admin hat deinen Anzeigenamen auf ').append(toComponent(nick)).append(NetComponent.literal(' gesetzt.')))
    return 1
  }
  var resetNick = ctx => {
    var target = Arguments.PLAYER.getResult(ctx, 'spieler'), real = target.getGameProfile().getName()
    saveNick(ctx.source.server, String(target.uuid), null)
    refresh(target)
    reply(ctx, real + ' hat wieder den echten Namen.')
    return 1
  }
  var listNicks = ctx => {
    var server = ctx.source.server, t = nickTag(server), keys = t.getAllKeys()
    if (keys.isEmpty()) { reply(ctx, 'Es sind keine Spitznamen vergeben.'); return 1 }
    var lines = []
    keys.forEach(uuid => {
      var real = uuid.substring(0, 8)
      try {
        var online = server.getPlayerList().getPlayer(JUUID.fromString(uuid))
        if (online) real = online.getGameProfile().getName()
        else { var cached = server.getProfileCache().get(JUUID.fromString(uuid)); if (cached.isPresent()) real = cached.get().getName() }
      } catch (e) { /* unbekannter Spieler: UUID-Anfang anzeigen */ }
      lines.push(plain(t.getString(uuid)) + ' = ' + real)
    })
    reply(ctx, 'Spitznamen (' + lines.length + '):\n' + lines.join('\n'))
    return 1
  }

  event.register(
    Commands.literal('nick')
      .requires(src => src.hasPermission(2))
      .then(Commands.argument('spieler', Arguments.PLAYER.create(event))
        .then(Commands.literal('reset').executes(resetNick))
        .then(Commands.argument('name', Arguments.GREEDY_STRING.create(event)).executes(setNick)))
  )
  event.register(
    Commands.literal('nicks')
      .requires(src => src.hasPermission(2))
      .executes(listNicks)
  )
})
