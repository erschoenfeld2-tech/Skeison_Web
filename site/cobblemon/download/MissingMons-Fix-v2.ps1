# MissingMons-Fix-v2.ps1  (lokaler Patch, enthaelt KEINE Inhalte der Mod)
# Zweck: MissingMons 3.6.1 mit Cobblemon 1.8.2 lauffaehig machen.
# Problem: MissingMons liefert 33 Animationsdateien mit denselben Namen wie Cobblemon. Cobblemon gewinnt,
#          die MissingMons-Poser finden ihre eigenen Animationen nicht ("Animation ... not found in animation group").
# Loesung: Die 33 Animationsgruppen werden in der LOKALEN Kopie von X nach X_mm umbenannt (Dateiname, Schluessel
#          "animation.X.", Verweise bedrock*(X, ...) in beiden Schreibweisen (q.bedrock('X', ...) und bedrock(X, ...)) in den Posern). Drei fehlende Animationen werden als leere
#          Platzhalter ergaenzt. Das Original wird nie veraendert; die gepatchte Jar ist NUR fuer den eigenen PC.
#          Die gepatchte Jar darf NICHT weitergegeben werden (Lizenz von MissingMons).
#
# Benutzung:
#   .\MissingMons-Fix-v2.ps1 -Quelle "C:\Pfad\missingmons-cobblemon-3.6.1.jar"
#   -> erzeugt daneben "missingmons-cobblemon-3.6.1-localfix.jar"
#   Diese Datei in den Ordner custom_mods des Profils legen und die normale MissingMons im Launcher AUSSCHALTEN.
param(
  [Parameter(Mandatory = $true)][string]$Quelle,
  [string]$Ziel
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $Quelle)) { throw "Quelle nicht gefunden: $Quelle" }
if (-not $Ziel) { $Ziel = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $Quelle)) ([IO.Path]::GetFileNameWithoutExtension($Quelle) + '-localfix.jar') }
if ((Resolve-Path -LiteralPath $Quelle).Path -eq $Ziel) { throw 'Quelle und Ziel duerfen nicht gleich sein.' }

$gruppen = @(
  'rowlet','klefki','rotom','rotom_fan','rotom_frost','rotom_heat','rotom_mow','rotom_wash',
  'deino','zweilous','hydreigon','lycanroc_dusk','lycanroc_midday','lycanroc_midnight','rockruff',
  'foongus','amoonguss','applin','flapple','appletun','dipplin','hydrapple','duraludon','archaludon',
  'furret','marowak_alolan','mareanie','sandygast','palossand','minior','poipole','naganadel','veluza'
)
# Platzhalter fuer Animationen, die weder MissingMons noch Cobblemon liefern: Dateiendung -> (Gruppe, Name)
$platzhalter = @(
  @{ Gruppe = 'foongus';  Name = 'status' },
  @{ Gruppe = 'rockruff'; Name = 'recoil' },
  @{ Gruppe = 'pawmot';   Name = 'sleep'  }
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Lies($e) { $r = New-Object IO.StreamReader($e.Open(), $utf8); try { $r.ReadToEnd() } finally { $r.Dispose() } }
function Schreibe($zip, $name, $text) {
  $e = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
  $s = $e.Open(); try { $b = $utf8.GetBytes($text); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
}

Copy-Item -LiteralPath $Quelle -Destination $Ziel -Force
$zip = [IO.Compression.ZipFile]::Open($Ziel, 'Update')
try {
  $alle = @($zip.Entries | ForEach-Object { $_.FullName })
  $anzahlAnim = 0; $anzahlPoser = 0
  # 1) Animationsdateien umbenennen und Schluessel anpassen
  foreach ($pfad in $alle) {
    if ($pfad -notmatch '/animations/.+\.animation\.json$') { continue }
    $g = [IO.Path]::GetFileName($pfad) -replace '\.animation\.json$', ''
    if ($gruppen -notcontains $g) { continue }
    $e = $zip.GetEntry($pfad); $t = Lies $e
    $t = $t.Replace('"animation.' + $g + '.', '"animation.' + $g + '_mm.')
    $neu = $pfad -replace ('/' + [regex]::Escape($g) + '\.animation\.json$'), ('/' + $g + '_mm.animation.json')
    $e.Delete(); Schreibe $zip $neu $t; $anzahlAnim++
  }
  # 2) Poser-Verweise anpassen
  foreach ($pfad in $alle) {
    if ($pfad -notmatch '/posers/.+\.json$') { continue }
    $e = $zip.GetEntry($pfad); $t = Lies $e; $alt = $t
    foreach ($g in $gruppen) {
      $t = [regex]::Replace($t, "(bedrock\w*\(\s*)(['""]?)" + [regex]::Escape($g) + "\2(\s*,)", '${1}${2}' + $g + '_mm${2}${3}')
    }
    if ($t -ne $alt) { $e.Delete(); Schreibe $zip $pfad $t; $anzahlPoser++ }
  }
  # 3) Platzhalter ergaenzen
  foreach ($p in $platzhalter) {
    $g = $p.Gruppe; $gn = if ($gruppen -contains $g) { $g + '_mm' } else { $g }
    $pfad = $zip.Entries | Where-Object { $_.FullName -match ('/animations/.+/' + [regex]::Escape($gn) + '\.animation\.json$') } | Select-Object -First 1
    if (-not $pfad) { Write-Warning "Animationsdatei fuer $gn nicht gefunden"; continue }
    $name = $pfad.FullName; $t = Lies $pfad
    $schluessel = 'animation.' + $gn + '.' + $p.Name
    if ($t.Contains('"' + $schluessel + '"')) { continue }
    $eintrag = '"' + $schluessel + '": { "loop": true, "animation_length": 1.0, "bones": {} },'
    $m = [regex]::Match($t, '"animations"\s*:\s*\{')
    if (-not $m.Success) { Write-Warning "Kein animations-Block in $name"; continue }
    $t = $t.Insert($m.Index + $m.Length, "`n    " + $eintrag)
    $pfad.Delete(); Schreibe $zip $name $t
  }
}
finally { $zip.Dispose() }
Write-Host "Fertig: $Ziel"
Write-Host "Animationsdateien umbenannt: $anzahlAnim (erwartet 33), Poser angepasst: $anzahlPoser"
Write-Host 'Naechste Schritte: Datei in custom_mods des Profils legen, normale MissingMons im Launcher ausschalten.'
