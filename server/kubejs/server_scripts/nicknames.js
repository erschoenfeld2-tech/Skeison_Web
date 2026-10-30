// Spitznamen fuer Spieler, nur fuer Admins (OP-Level 2):
//   /nick <spieler> <name>   setzt den Anzeigenamen (Farbcodes mit &, z. B. "&aGrüner Name")
//   /nick <spieler> reset    stellt den echten Namen wieder her
//   /nicks                   listet alle vergebenen Spitznamen mit echtem Namen
// Der Spitzname erscheint im Chat, in der Tab-Liste und in Servernachrichten (Beitritt, Tod).
// Das Namensschild ueber dem Kopf zeigt weiterhin den echten Namen (das zeichnet der Client selbst).
// Gespeichert wird in den Serverdaten der Welt, die Namen bleiben also nach einem Neustart erhalten.
// Ablage auf dem Server: <Serverordner>/kubejs/server_scripts/nicknames.js (danach Server neu starten)

const Component = Java.loadClass('net.minecraft.network.chat.Component')
const UUID = Java.loadClass('java.util.UUID')
const MAX_LEN = 32

function nickTag(server) { return server.persistentData.getCompound('nicknames') }
function getNick(server, uuid) { const t = nickTag(server); return t.contains(uuid) ? t.getString(uuid) : null }
function saveNick(server, uuid, nick) {
  const t = nickTag(server)
  if (nick) t.putString(uuid, nick); else t.remove(uuid)
  server.persistentData.put('nicknames', t)
}
// &-Farbcodes in Minecraft-Formatierung umwandeln; am Ende zuruecksetzen, damit nachfolgender Text normal bleibt
function toComponent(nick) { return Component.literal(nick.replace(/&([0-9a-fk-or])/gi, '§$1') + '§r') }
function plain(nick) { return nick.replace(/&[0-9a-fk-or]/gi, '') }
function refresh(player) {
  player.refreshDisplayName()
  try { player.refreshTabListName() } catch (e) { /* aeltere NeoForge-Version: Tab-Liste aktualisiert sich beim naechsten Beitritt */ }
}

// Anzeigename (Chat, Servernachrichten) und Tab-Liste durch den Spitznamen ersetzen
NativeEvents.onEvent('net.neoforged.neoforge.event.entity.player.PlayerEvent$NameFormat', event => {
  const player = event.getEntity(), server = player.getServer()
  if (!server) return
  const nick = getNick(server, player.getStringUUID())
  if (nick) event.setDisplayname(toComponent(nick))
})
NativeEvents.onEvent('net.neoforged.neoforge.event.entity.player.PlayerEvent$TabListNameFormat', event => {
  const player = event.getEntity(), server = player.getServer()
  if (!server) return
  const nick = getNick(server, player.getStringUUID())
  if (nick) event.setDisplayName(toComponent(nick))
})

ServerEvents.commandRegistry(event => {
  const { commands: Commands, arguments: Arguments } = event
  const reply = (ctx, text) => ctx.source.sendSuccess(() => Component.literal(text), true)

  const setNick = ctx => {
    const target = Arguments.PLAYER.getResult(ctx, 'spieler')
    const nick = Arguments.GREEDY_STRING.getResult(ctx, 'name').replace(/§/g, '').trim()
    const len = plain(nick).length
    if (len < 1 || len > MAX_LEN) { ctx.source.sendFailure(Component.literal('Der Name muss 1–' + MAX_LEN + ' Zeichen lang sein (ohne Farbcodes).')); return 0 }
    saveNick(ctx.source.server, target.getStringUUID(), nick)
    refresh(target)
    reply(ctx, target.getGameProfile().getName() + ' heißt jetzt ' + plain(nick) + '.')
    target.sendSystemMessage(Component.literal('Ein Admin hat deinen Anzeigenamen auf ').append(toComponent(nick)).append(Component.literal(' gesetzt.')))
    return 1
  }
  const resetNick = ctx => {
    const target = Arguments.PLAYER.getResult(ctx, 'spieler'), real = target.getGameProfile().getName()
    saveNick(ctx.source.server, target.getStringUUID(), null)
    refresh(target)
    reply(ctx, real + ' hat wieder den echten Namen.')
    return 1
  }
  const listNicks = ctx => {
    const server = ctx.source.server, t = nickTag(server), keys = t.getAllKeys()
    if (keys.isEmpty()) { ctx.source.sendSuccess(() => Component.literal('Es sind keine Spitznamen vergeben.'), false); return 1 }
    const lines = []
    keys.forEach(uuid => {
      let real = uuid.substring(0, 8)
      try {
        const online = server.getPlayerList().getPlayer(UUID.fromString(uuid))
        if (online) real = online.getGameProfile().getName()
        else { const cached = server.getProfileCache().get(UUID.fromString(uuid)); if (cached.isPresent()) real = cached.get().getName() }
      } catch (e) { /* unbekannter Spieler: UUID-Anfang anzeigen */ }
      lines.push(plain(t.getString(uuid)) + ' = ' + real)
    })
    ctx.source.sendSuccess(() => Component.literal('Spitznamen (' + lines.length + '):\n' + lines.join('\n')), false)
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
