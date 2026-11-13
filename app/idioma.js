/*
  jitsi-ndi · idiomas (español / English)
  Los textos fijos de la página llevan data-t (texto), data-t-html, data-t-title,
  data-t-ph (placeholder) o data-t-aria. Los textos del programa usan t('clave').

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/
'use strict'

const TEXTOS = {
  es: {
    desconectado: 'desconectado',
    acercaTitulo: 'Acerca de (i)',
    acerca: 'acerca de',
    servidor: 'servidor',
    sala: 'sala',
    nombreSala: 'nombre en la sala',
    prefijo: 'prefijo NDI',
    calidad: 'calidad',
    encuadre: 'encuadre',
    encuadreTitulo: 'Cómo sale por NDI un teléfono puesto en vertical',
    llenar: 'horizontal · llenar',
    ajustar: 'horizontal · ajustar',
    original: 'original',
    audio: 'audio al entrar',
    audioTitulo: 'Si la voz de cada persona que entra sale por NDI (se puede cambiar en cada ficha)',
    apagado: 'apagado',
    encendido: 'encendido',
    conectar: 'conectar',
    desconectar: 'desconectar',
    vacio: 'Conéctate a la sala. Cada persona con cámara aparecerá aquí y saldrá por NDI con su nombre.',
    ayudaTeclas: 'h oculta los controles · i acerca de',
    cerrar: 'Cerrar',
    mostrar: 'Mostrar controles',
    descripcion: 'Recibe la cámara de cada participante de una reunión en Jitsi y la publica como una señal NDI separada (con su audio, si lo activas), para el mixer TCRV en TouchDesigner.',
    tcrv: 'Forma parte de la investigación del <strong>TCRV · Teatro de Creación Remota en Vivo</strong> de Landscape Artes Escénicas (México): una metodología para crear en vivo con un elenco reunido en una videollamada, cada quien desde su lugar y su cámara, editado en tiempo real como en la televisión en directo. Reconocida con el World Summit Award 2020, iniciativa vinculada a la Cumbre Mundial sobre la Sociedad de la Información de las Naciones Unidas, y presentada en la Cuadrienal de Praga 2024.',
    idiomaTitulo: 'English',
    participante: 'Participante',
    pantalla: 'pantalla',
    sinNdi: 'sin NDI',
    senal: 'señal',
    senales: 'señales',
    audioFicha: 'Audio de esta persona por NDI',
    errNdi: 'El módulo NDI no cargó: ',
    errHttps: 'El servidor debe empezar con https://',
    errSala: 'Falta el nombre de la sala',
    cargandoLib: 'cargando lib-jitsi-meet…',
    conectando: 'conectando…',
    noConecta: 'no se pudo conectar: ',
    enSala: 'en la sala «{sala}»',
    rechazo: 'la sala rechazó la conexión: ',
    ndiNo: 'NDI no disponible: revisa la instalación (npm install)',
    equipo: 'equipo'
  },
  en: {
    desconectado: 'disconnected',
    acercaTitulo: 'About (i)',
    acerca: 'about',
    servidor: 'server',
    sala: 'room',
    nombreSala: 'name in the room',
    prefijo: 'NDI prefix',
    calidad: 'quality',
    encuadre: 'framing',
    encuadreTitulo: 'How a phone held upright is sent over NDI',
    llenar: 'landscape · fill',
    ajustar: 'landscape · fit',
    original: 'original',
    audio: 'audio on join',
    audioTitulo: 'Whether the voice of each person who joins is sent over NDI (can be changed on each tile)',
    apagado: 'off',
    encendido: 'on',
    conectar: 'connect',
    desconectar: 'disconnect',
    vacio: 'Join the room. Everyone with a camera will appear here and be sent over NDI under their name.',
    ayudaTeclas: 'h hides the controls · i about',
    cerrar: 'Close',
    mostrar: 'Show controls',
    descripcion: 'Receives each participant\'s camera from a Jitsi meeting and publishes it as a separate NDI source (with their audio, if enabled), for the TCRV mixer in TouchDesigner.',
    tcrv: 'Part of the research behind <strong>TCRV · Live Remote Creation Theater</strong> by Landscape Artes Escénicas (Mexico): a method for making live work with a cast gathered in a video call, each performer from their own place and camera, edited in real time like live television. It received the World Summit Award 2020, an initiative linked to the United Nations World Summit on the Information Society, and was presented at the Prague Quadrennial 2024.',
    idiomaTitulo: 'Español',
    participante: 'Participant',
    pantalla: 'screen',
    sinNdi: 'no NDI',
    senal: 'source',
    senales: 'sources',
    audioFicha: 'This person\'s audio over NDI',
    errNdi: 'The NDI module did not load: ',
    errHttps: 'The server must start with https://',
    errSala: 'The room name is missing',
    cargandoLib: 'loading lib-jitsi-meet…',
    conectando: 'connecting…',
    noConecta: 'could not connect: ',
    enSala: 'in room «{sala}»',
    rechazo: 'the room refused the connection: ',
    ndiNo: 'NDI not available: check the installation (npm install)',
    equipo: 'computer'
  }
}

let idioma = 'es'
try {
  idioma = localStorage.getItem('jn.idioma') || ((navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en')
} catch (e) { idioma = (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en' }

function t (clave, vars) {
  let s = (TEXTOS[idioma] && TEXTOS[idioma][clave]) || TEXTOS.es[clave] || clave
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k])
  return s
}

function aplicarIdioma () {
  document.documentElement.lang = idioma
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  for (const el of document.querySelectorAll('[data-t-html]')) el.innerHTML = t(el.dataset.tHtml)
  for (const el of document.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle)
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria))
  for (const el of document.querySelectorAll('[data-t-label]')) el.firstChild.nodeValue = t(el.dataset.tLabel)
  const b = document.getElementById('btnIdioma')
  if (b) { b.textContent = idioma === 'es' ? 'EN' : 'ES'; b.title = t('idiomaTitulo') }
}

function cambiarIdioma () {
  idioma = idioma === 'es' ? 'en' : 'es'
  try { localStorage.setItem('jn.idioma', idioma) } catch (e) { /* sin almacenamiento */ }
  aplicarIdioma()
  document.dispatchEvent(new Event('idioma'))
}
