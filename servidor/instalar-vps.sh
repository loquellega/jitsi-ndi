#!/usr/bin/env bash
# jitsi-ndi · Instalar Jitsi en un servidor en internet (Ubuntu 22.04/24.04, x86 o ARM)
# -------------------------------------------------------------------------------------
# Instala Docker y docker-jitsi-meet con certificado de Let's Encrypt y los ajustes del
# TCRV (360p máximo, tope de personas por sala). Funciona en Oracle Cloud, Vultr,
# K2WebHost, etc.
#
# Antes: el subdominio (p. ej. tcrv.hectorcruz.com.mx) debe apuntar a la IP del servidor.
#
# Uso, en el servidor:
#   curl -fsSL https://raw.githubusercontent.com/loquellega/jitsi-ndi/main/servidor/instalar-vps.sh \
#     | sudo bash -s -- tcrv.hectorcruz.com.mx tu@correo.com
#
# Opcional, como tercer y cuarto argumento: tope de personas (15) y zona horaria (America/Mexico_City).
#
# Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
# Colección Alchemy of Meaning.

set -euo pipefail

DOMINIO="${1:-}"
CORREO="${2:-}"
MAX_PERSONAS="${3:-15}"
ZONA="${4:-America/Mexico_City}"
BASE=/opt/jitsi-ndi
DESTINO="$BASE/jitsi"

info () { printf '\n\033[36m== %s\033[0m\n' "$*"; }
aviso () { printf '\033[33mAviso: %s\033[0m\n' "$*"; }
error () { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || error 'corre el script con sudo.'
[ -n "$DOMINIO" ] && [ -n "$CORREO" ] || error 'uso: instalar-vps.sh DOMINIO CORREO [MAX_PERSONAS] [ZONA_HORARIA]'

info "jitsi-ndi · servidor Jitsi en $DOMINIO"

# 1. Paquetes y Docker
info 'Instalando Docker y utilidades'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip dnsutils iptables-persistent >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || error 'Docker Compose no quedó instalado.'
systemctl enable --now docker >/dev/null

# 2. IP pública y DNS
IP_PUBLICA="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me)"
[ -n "$IP_PUBLICA" ] || error 'no pude averiguar la IP pública del servidor.'
echo "IP pública: $IP_PUBLICA"
IP_DNS="$(dig +short A "$DOMINIO" | tail -n1)"
if [ "$IP_DNS" != "$IP_PUBLICA" ]; then
  aviso "$DOMINIO apunta a '${IP_DNS:-nada}' y no a $IP_PUBLICA."
  aviso 'Let'"'"'s Encrypt no podrá dar el certificado hasta que el DNS apunte aquí (puede tardar unos minutos).'
  aviso 'Cuando apunte, vuelve a correr este mismo comando.'
fi

# 3. Firewall del sistema (las imágenes de Oracle traen iptables cerrado)
info 'Abriendo puertos 80/tcp, 443/tcp y 10000/udp'
abrir () {
  local proto="$1" puerto="$2"
  iptables -C INPUT -p "$proto" --dport "$puerto" -j ACCEPT 2>/dev/null ||
    iptables -I INPUT 1 -p "$proto" --dport "$puerto" -j ACCEPT
}
abrir tcp 80; abrir tcp 443; abrir udp 10000
netfilter-persistent save >/dev/null 2>&1 || true
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 10000/udp >/dev/null
fi
echo 'Listo. En Oracle abre también esos puertos en la «Security List» de la red (ver README).'

# 4. docker-jitsi-meet (versión estable más reciente, solo la primera vez)
mkdir -p "$BASE"
if [ ! -f "$DESTINO/docker-compose.yml" ]; then
  info 'Descargando docker-jitsi-meet estable'
  URL_ZIP="$(curl -fsS https://api.github.com/repos/jitsi/docker-jitsi-meet/releases/latest | grep -m1 '"zipball_url"' | cut -d'"' -f4)"
  TMP="$(mktemp -d)"
  curl -fsSL "$URL_ZIP" -o "$TMP/djm.zip"
  unzip -q "$TMP/djm.zip" -d "$TMP"
  mv "$TMP"/*/ "$DESTINO"
  rm -rf "$TMP"
else
  echo 'docker-jitsi-meet ya está descargado; se conserva.'
fi

# 5. Archivo .env (si ya existe, se conservan sus contraseñas)
info 'Configurando .env'
cd "$DESTINO"
[ -f .env ] || cp env.example .env
poner () {
  local clave="$1" valor="$2"
  if grep -qE "^#?\s*$clave=" .env; then
    sed -i -E "0,/^#?\s*$clave=.*/s||$clave=$valor|" .env
  else
    printf '%s=%s\n' "$clave" "$valor" >> .env
  fi
}
grep -qE '^JICOFO_AUTH_PASSWORD=\S+' .env || bash gen-passwords.sh
poner CONFIG "$BASE/config"
poner TZ "$ZONA"
poner HTTP_PORT 80
poner HTTPS_PORT 443
poner PUBLIC_URL "https://$DOMINIO"
poner JVB_ADVERTISE_IPS "$IP_PUBLICA"
if [ "${SIN_LETSENCRYPT:-0}" = 1 ]; then
  poner ENABLE_LETSENCRYPT 0   # solo para pruebas: certificado autofirmado
else
  poner ENABLE_LETSENCRYPT 1
fi
poner LETSENCRYPT_DOMAIN "$DOMINIO"
poner LETSENCRYPT_EMAIL "$CORREO"
poner ENABLE_HTTP_REDIRECT 1
# TCRV: video de 360p como máximo y tope de personas por sala
poner RESOLUTION 360
poner RESOLUTION_MIN 180
poner RESOLUTION_WIDTH 640
poner RESOLUTION_WIDTH_MIN 320
poner MAX_PARTICIPANTS "$MAX_PERSONAS"
poner RESTART_POLICY unless-stopped

for d in web transcripts prosody/config prosody/prosody-plugins-custom jicofo jvb jigasi jibri storage/prosody storage/web; do
  mkdir -p "$BASE/config/$d"
done
chown -R 1000:1000 "$BASE/config"   # los contenedores corren como uid 1000

# 6. Arrancar
info 'Arrancando Jitsi (la primera vez descarga ~2 GB)'
docker compose pull -q
docker compose up -d

printf '\nEsperando a que responda https://%s ' "$DOMINIO"
for _ in $(seq 1 60); do
  if [ "${SIN_LETSENCRYPT:-0}" = 1 ]; then
    curl -fsSk https://localhost/config.js >/dev/null 2>&1 && { OK=1; break; }
  elif curl -fsS "https://$DOMINIO/config.js" >/dev/null 2>&1; then OK=1; break; fi
  printf '.'; sleep 5
done
echo

if [ "${OK:-0}" = 1 ]; then
  info 'Servidor listo'
  echo "  Sala de prueba:      https://$DOMINIO/tcrv-prueba"
  echo "  En la app jitsi-ndi: servidor https://$DOMINIO  ·  sala tcrv-prueba"
  echo "  Tope: $MAX_PERSONAS personas por sala · video máximo 360p"
else
  aviso "todavía no responde https://$DOMINIO con certificado válido."
  echo '  Revisa: el DNS apunta aquí, los puertos 80/443/10000 abiertos en el panel del proveedor,'
  echo "  y los registros con:  cd $DESTINO && docker compose logs web | tail -40"
fi
echo "  Apagar: cd $DESTINO && docker compose down  ·  Encender: docker compose up -d"
