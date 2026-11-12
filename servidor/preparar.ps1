<#
  jitsi-ndi · Preparar servidor Jitsi local (Windows + Docker Desktop)
  --------------------------------------------------------------------
  Descarga la versión estable de docker-jitsi-meet en servidor\jitsi,
  crea el archivo .env con contraseñas propias y lo ajusta para TCRV:
  video máximo 360p, entrada desde el navegador del teléfono y la IP
  de esta PC en la red local.

  Uso (desde la carpeta del repo):
    powershell -ExecutionPolicy Bypass -File servidor\preparar.ps1
    powershell -ExecutionPolicy Bypass -File servidor\preparar.ps1 -Ip 192.168.1.50

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
#>
param(
  [string]$Ip = '',
  [int]$PuertoHttps = 8443,
  [string]$Sala = 'tcrv-prueba',
  [int]$MaxPersonas = 15,   # tope de personas en la sala (cuenta al host y a la app NDI)
  [switch]$SinDocker   # solo para pruebas automáticas: prepara la configuración sin revisar Docker
)
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino = Join-Path $aqui 'jitsi'

Write-Host "`n== jitsi-ndi · servidor Jitsi local ==`n" -ForegroundColor Cyan

# 1. Docker
if ($SinDocker) { Write-Host '(sin revisar Docker)' }
elseif (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'No encuentro Docker. Instala Docker Desktop (https://www.docker.com/products/docker-desktop/), ábrelo y vuelve a correr este script.'
}
if (-not $SinDocker) { cmd /c 'docker info >nul 2>&1' }
if (-not $SinDocker -and $LASTEXITCODE -ne 0) { throw 'Docker está instalado pero no está corriendo. Abre Docker Desktop, espera a que diga "Engine running" y vuelve a intentar.' }

# 2. IP de esta PC en la red local
if (-not $Ip) {
  $ruta = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
  if ($ruta) {
    $Ip = (Get-NetIPAddress -InterfaceIndex $ruta.InterfaceIndex -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress
  }
}
if (-not $Ip) { throw 'No pude detectar la IP local. Córrelo de nuevo con -Ip 192.168.x.x (la ves con el comando ipconfig).' }
Write-Host "IP de esta PC en la red: $Ip"

# 3. Descargar docker-jitsi-meet (solo la primera vez)
if (Test-Path (Join-Path $destino 'docker-compose.yml')) {
  Write-Host 'docker-jitsi-meet ya está descargado; se conserva.'
} else {
  Write-Host 'Descargando la última versión estable de docker-jitsi-meet...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $cab = @{ 'User-Agent' = 'jitsi-ndi' }
  $rel = Invoke-RestMethod 'https://api.github.com/repos/jitsi/docker-jitsi-meet/releases/latest' -Headers $cab
  $temporal = [IO.Path]::GetTempPath()
  $zip = Join-Path $temporal 'docker-jitsi-meet.zip'
  $tmp = Join-Path $temporal ('djm-' + [guid]::NewGuid().ToString('N'))
  Invoke-WebRequest $rel.zipball_url -OutFile $zip -Headers $cab -UseBasicParsing
  Expand-Archive $zip $tmp
  Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $destino
  Remove-Item $zip -Force; Remove-Item $tmp -Recurse -Force
  Write-Host "Versión: $($rel.tag_name)"
}

# 4. Archivo .env (si ya existe, se conservan sus contraseñas)
$archivoEnv = Join-Path $destino '.env'
$base = if (Test-Path $archivoEnv) { $archivoEnv } else { Join-Path $destino 'env.example' }
$texto = [IO.File]::ReadAllText($base)

function Poner([string]$clave, [string]$valor) {
  $patron = "(?m)^#?\s*$clave=.*$"
  if ([regex]::IsMatch($script:texto, $patron)) {
    $script:texto = [regex]::Replace($script:texto, $patron, "$clave=$valor", 1)
  } else {
    $script:texto = $script:texto.TrimEnd() + "`n$clave=$valor`n"
  }
}
function Clave() {
  $b = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

foreach ($c in 'JICOFO_AUTH_PASSWORD','JVB_AUTH_PASSWORD','JIGASI_XMPP_PASSWORD','JIGASI_TRANSCRIBER_PASSWORD','JIBRI_RECORDER_PASSWORD','JIBRI_XMPP_PASSWORD') {
  if (-not [regex]::IsMatch($texto, "(?m)^$c=\S+")) { Poner $c (Clave) }
}
Poner 'CONFIG' './config'
Poner 'TZ' 'America/Mexico_City'
Poner 'HTTP_PORT' '8000'
Poner 'HTTPS_PORT' "$PuertoHttps"
Poner 'PUBLIC_URL' "https://${Ip}:$PuertoHttps"
Poner 'JVB_ADVERTISE_IPS' $Ip
# TCRV: video de 360p como máximo (también ahorra subida en los teléfonos)
Poner 'RESOLUTION' '360'
Poner 'RESOLUTION_MIN' '180'
Poner 'RESOLUTION_WIDTH' '640'
Poner 'RESOLUTION_WIDTH_MIN' '320'
# Que el teléfono entre desde el navegador, sin mandarlo a descargar la app
Poner 'DISABLE_DEEP_LINKING' 'true'
# Tope de personas por sala, para que nadie más se cuele durante una función
Poner 'MAX_PARTICIPANTS' "$MaxPersonas"

[IO.File]::WriteAllText($archivoEnv, $texto, (New-Object Text.UTF8Encoding($false)))
foreach ($d in 'web','transcripts','prosody/config','prosody/prosody-plugins-custom','jicofo','jvb','jigasi','jibri') {
  New-Item -ItemType Directory -Force -Path (Join-Path $destino "config/$d") | Out-Null
}
Write-Host "Archivo .env listo (máximo $MaxPersonas personas por sala)."

# 5. Firewall (necesita PowerShell como administrador)
$admin = $false
try { $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
if ($SinDocker -and -not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
  Write-Host 'Firewall: se omite fuera de Windows.'
} elseif ($admin) {
  if (-not (Get-NetFirewallRule -DisplayName 'Jitsi TCRV web' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Jitsi TCRV web' -Direction Inbound -Protocol TCP -LocalPort $PuertoHttps -Action Allow -Profile Private | Out-Null
    New-NetFirewallRule -DisplayName 'Jitsi TCRV video' -Direction Inbound -Protocol UDP -LocalPort 10000 -Action Allow -Profile Private | Out-Null
  }
  Write-Host 'Firewall: puertos abiertos en redes privadas.'
} else {
  Write-Host "`nAviso: no abrí el firewall porque esta terminal no es de administrador." -ForegroundColor Yellow
  Write-Host 'Para que entren los teléfonos, corre esto en una terminal de administrador:'
  Write-Host "  New-NetFirewallRule -DisplayName 'Jitsi TCRV web' -Direction Inbound -Protocol TCP -LocalPort $PuertoHttps -Action Allow -Profile Private"
  Write-Host "  New-NetFirewallRule -DisplayName 'Jitsi TCRV video' -Direction Inbound -Protocol UDP -LocalPort 10000 -Action Allow -Profile Private"
}

Write-Host "`n== Siguiente paso ==" -ForegroundColor Cyan
Write-Host "  cd `"$destino`""
Write-Host '  docker compose up -d'
Write-Host "`nLuego abre:"
Write-Host "  https://${Ip}:$PuertoHttps/$Sala"
Write-Host "  (la misma dirección en esta PC y en los teléfonos de la misma red Wi-Fi; con localhost la reunión se desconecta)"
Write-Host "`nEl navegador avisará que el certificado no es seguro: es normal en la prueba local; acepta para continuar."
Write-Host "Para apagar el servidor: docker compose down (en esa misma carpeta).`n"
