// /claude <frage>: stellt eine Frage an die Server-KI.
// Das Skript schreibt die Frage als Zeile "[KI-FRAGE] {...}" ins KubeJS-Log; der Bot tools\ki-bot.js liest sie dort,
// fragt Claude und schickt die Antwort per RCON (tellraw) nur an den Fragenden zurueck.
// Hier wird nur geprueft (Laenge, Wartezeit) und bestaetigt, damit der Spieler sofort eine Rueckmeldung hat.
var KI_NetComponent = Java.loadClass('net.minecraft.network.chat.Component')
var KI_MAX_LEN = 300
var KI_COOLDOWN_MS = 30000
var KI_LAST = {}
var KI_COUNTER = 0

ServerEvents.commandRegistry(function (event) {
  var Commands = event.commands, Arguments = event.arguments
  var run = function (ctx) {
    try {
      var p = ctx.source.player
      if (!p) { ctx.source.sendSystemMessage(KI_NetComponent.literal('Der Befehl geht nur ingame.')); return 0 }
      var name = String(p.getGameProfile().getName()), uuid = String(p.uuid)
      var q = String(Arguments.GREEDY_STRING.getResult(ctx, 'frage')).replace(/[\r\n\t]+/g, ' ').trim()
      if (q.length < 3) { ctx.source.sendSystemMessage(KI_NetComponent.literal('Stell bitte eine Frage, z. B. /claude Wo spawnt Octillery?')); return 0 }
      if (q.length > KI_MAX_LEN) { ctx.source.sendSystemMessage(KI_NetComponent.literal('Die Frage ist zu lang (maximal ' + KI_MAX_LEN + ' Zeichen).')); return 0 }
      var now = Date.now(), wait = (KI_LAST[uuid] || 0) + KI_COOLDOWN_MS - now
      if (wait > 0) { ctx.source.sendSystemMessage(KI_NetComponent.literal('Bitte warte noch ' + Math.ceil(wait / 1000) + ' Sekunden.')); return 0 }
      KI_LAST[uuid] = now
      KI_COUNTER++
      console.info('[KI-FRAGE] ' + JSON.stringify({ id: KI_COUNTER + '-' + now, player: name, q: q }))
      ctx.source.sendSystemMessage(KI_NetComponent.literal('§b[KI]§r Ich überlege …'))
      return 1
    } catch (err) { console.error('[ki_command] ' + err); return 0 }
  }
  event.register(
    Commands.literal('claude')
      .requires(function (src) { return src.hasPermission(0) })
      .then(Commands.argument('frage', Arguments.GREEDY_STRING.create(event)).executes(run))
  )
})
