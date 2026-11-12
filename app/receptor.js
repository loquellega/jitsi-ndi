/*
  jitsi-ndi · receptor
  Entra a la sala de Jitsi sin cámara ni micrófono, recibe el video de cada
  participante y lo publica como una señal NDI con el nombre de la persona.

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/
'use strict'

// window.puente lo crea preload.js: da acceso al módulo NDI sin exponer Node a la página
const puente = window.puente || { version: '?', equipo: '?', ndi: { disponible: false, error: 'sin preload' }, salir () {} }
const ndi = puente.ndi

const $ = (id) => document.getElementById(id)
const campos = ['servidor', 'sala', 'nombre', 'prefijo', 'altura']
const params = new URLSearchParams(location.search)
const prueba = params.has('servidor') ? {
  servidor: params.get('servidor'),
  sala: params.get('sala') || 'tcrv-prueba',
  segundos: Number(params.get('segundos') || 90),
  esperado: params.get('esperado') || ''
} : null

// ---------- estado ----------
const estado = {
  conexion: null,
  conferencia: null,
  conectado: false,
  libDesde: null, // servidor desde el que se cargó lib-jitsi-meet
  salidas: new Map(), // nombre NDI → { sender, enUso }
  participantes: new Map() // id de pista → ficha
}

// ---------- utilidades ----------
function log (...a) { console.log('[jitsi-ndi]', ...a) }
function guardar () {
  try { for (const c of campos) localStorage.setItem('jn.' + c, $(c).value) } catch (e) { /* sin almacenamiento */ }
}
function cargar () {
  const def = { servidor: '', sala: 'tcrv-prueba', nombre: 'NDI', prefijo: 'TCRV', altura: '360' }
  for (const c of campos) {
    let v = null
    try { v = localStorage.getItem('jn.' + c) } catch (e) { /* nada */ }
    $(c).value = v !== null ? v : def[c]
  }
  if (prueba) { $('servidor').value = prueba.servidor; $('sala').value = prueba.sala }
}
function ponerEstado (texto, tipo = '') {
  const el = $('estado')
  el.textContent = texto
  el.className = 'estado ' + tipo
  log('estado:', texto)
}
function cargarScript (url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = resolve
    s.onerror = () => reject(new Error('No se pudo cargar ' + url))
    document.head.appendChild(s)
  })
}
function limpiarNombre (n) {
  return String(n || '').replace(/[()\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}

// ---------- salidas NDI ----------
async function obtenerSalida (nombreBase) {
  const prefijo = limpiarNombre($('prefijo').value)
  let nombre = limpiarNombre(`${prefijo} ${nombreBase}`)
  let n = 2
  // si otra persona activa ya usa ese nombre, se numera
  while (estado.salidas.has(nombre) && estado.salidas.get(nombre).enUso) nombre = limpiarNombre(`${prefijo} ${nombreBase} ${n++}`)
  let salida = estado.salidas.get(nombre)
  if (!salida) {
    // las señales se conservan aunque la persona salga: si vuelve, TD sigue apuntando a la misma
    const senal = await ndi.crear(nombre)
    salida = { nombre, senal, completo: senal.nombreCompleto, enUso: false }
    estado.salidas.set(nombre, salida)
    log('NDI nueva:', salida.completo)
  }
  salida.enUso = true
  return salida
}

// ---------- fichas (una por cámara recibida) ----------
function crearFicha (pista, nombrePersona) {
  const ficha = document.createElement('section')
  ficha.className = 'ficha'
  ficha.innerHTML = `
    <div class="imagen"><video autoplay muted playsinline></video><span class="esq ar">—</span></div>
    <div class="datos"><span class="nombre"></span><span class="espacio"></span><span class="lectura fps">0 fps</span></div>
    <div class="medidor"><i></i></div>`
  $('vacio').hidden = true
  $('rejilla').appendChild(ficha)
  const p = {
    pista,
    persona: nombrePersona,
    el: ficha,
    video: ficha.querySelector('video'),
    lienzo: document.createElement('canvas'),
    salida: null,
    activo: true,
    ocupado: false,
    cuadros: 0,
    cuadrosSeg: 0,
    fps: 0
  }
  p.ctx = p.lienzo.getContext('2d', { willReadFrequently: true, alpha: false })
  ficha.querySelector('.nombre').textContent = nombrePersona
  return p
}

async function agregarPista (pista) {
  const id = pista.getParticipantId()
  const participante = estado.conferencia.getParticipantById(id)
  const nombrePersona = limpiarNombre(participante && participante.getDisplayName()) || `Participante ${estado.participantes.size + 1}`
  const clave = pista.getId ? pista.getId() : id + '-' + Date.now()
  const p = crearFicha(pista, nombrePersona)
  estado.participantes.set(clave, p)
  pista._jnClave = clave
  pista.attach(p.video)
  try {
    p.salida = await obtenerSalida(nombrePersona)
    p.el.querySelector('.nombre').textContent = p.salida.completo
    p.el.title = `Señal NDI: ${p.salida.completo}`
  } catch (e) {
    p.el.querySelector('.nombre').textContent = `${nombrePersona} · sin NDI`
    log('Error al crear la señal NDI:', e.message)
    return
  }
  bombear(p)
  actualizarResumen()
}

function quitarPista (pista) {
  const p = estado.participantes.get(pista._jnClave)
  if (!p) return
  p.activo = false
  try { pista.detach(p.video) } catch (e) { /* ya se fue */ }
  if (p.salida) p.salida.enUso = false
  p.el.remove()
  estado.participantes.delete(pista._jnClave)
  $('vacio').hidden = estado.participantes.size > 0
  actualizarResumen()
}

// Lee cada cuadro que llega del video y lo manda por NDI tal cual (respeta vertical u horizontal).
function bombear (p) {
  const v = p.video
  const paso = () => {
    if (!p.activo) return
    const w = v.videoWidth & ~1
    const h = v.videoHeight & ~1
    if (w > 0 && h > 0 && !p.ocupado) {
      if (p.lienzo.width !== w || p.lienzo.height !== h) { p.lienzo.width = w; p.lienzo.height = h }
      p.ctx.drawImage(v, 0, 0, w, h)
      const img = p.ctx.getImageData(0, 0, w, h)
      p.ocupado = true
      p.salida.senal.enviar(img.data, w, h).then(() => { p.cuadros++; p.cuadrosSeg++ })
        .catch((e) => log('Error al enviar cuadro:', e.message))
        .finally(() => { p.ocupado = false })
      p.res = `${w}×${h}`
    }
    v.requestVideoFrameCallback(paso)
  }
  v.requestVideoFrameCallback(paso)
}

setInterval(() => {
  for (const p of estado.participantes.values()) {
    p.fps = p.cuadrosSeg
    p.cuadrosSeg = 0
    p.el.querySelector('.fps').innerHTML = `<b>${p.fps}</b> fps`
    p.el.querySelector('.esq').textContent = p.res || '—'
    p.el.querySelector('.medidor i').style.width = Math.min(100, (p.fps / 30) * 100) + '%'
    p.el.classList.toggle('fuera', p.fps === 0)
  }
}, 1000)

function actualizarResumen () {
  const n = estado.participantes.size
  $('resumen').innerHTML = estado.conectado ? `<b>${n}</b> ${n === 1 ? 'señal' : 'señales'} NDI` : ''
}

// ---------- conexión ----------
async function conectar () {
  if (!ndi.disponible) throw new Error('El módulo NDI no cargó: ' + ndi.error)
  const servidor = $('servidor').value.trim().replace(/\/+$/, '')
  const sala = $('sala').value.trim().toLowerCase()
  if (!/^https:\/\//.test(servidor)) throw new Error('El servidor debe empezar con https://')
  if (!sala) throw new Error('Falta el nombre de la sala')
  guardar()

  if (estado.libDesde && estado.libDesde !== servidor) {
    // otra versión del servidor: se recarga la ventana para cargar su lib-jitsi-meet
    sessionStorage.setItem('jn.autoconectar', '1')
    location.reload()
    return
  }
  ponerEstado('cargando lib-jitsi-meet…')
  if (!estado.libDesde) {
    await cargarScript(`${servidor}/config.js?t=${Date.now()}`)
    await cargarScript(`${servidor}/libs/lib-jitsi-meet.min.js`)
    estado.libDesde = servidor
    window.JitsiMeetJS.init({ disableAudioLevels: true })
    window.JitsiMeetJS.setLogLevel(window.JitsiMeetJS.logLevels.ERROR)
  }
  const J = window.JitsiMeetJS
  const cfg = window.config || {}
  const host = new URL(servidor).host
  const ws = cfg.websocket || `wss://${host}/xmpp-websocket`

  ponerEstado('conectando…')
  const conexion = new J.JitsiConnection(null, null, {
    hosts: cfg.hosts,
    serviceUrl: `${ws}?room=${encodeURIComponent(sala)}`,
    websocketKeepAliveUrl: cfg.websocketKeepAliveUrl
  })
  estado.conexion = conexion
  conexion.addEventListener(J.events.connection.CONNECTION_ESTABLISHED, () => unirse(sala, cfg))
  conexion.addEventListener(J.events.connection.CONNECTION_FAILED, (err) => {
    ponerEstado('no se pudo conectar: ' + err, 'error'); estado.conexion = null; marcarConectado(false)
  })
  conexion.addEventListener(J.events.connection.CONNECTION_DISCONNECTED, () => {
    if (estado.conectado) ponerEstado('desconectado', ''); marcarConectado(false)
  })
  conexion.connect()
}

function unirse (sala, cfg) {
  const J = window.JitsiMeetJS
  const E = J.events.conference
  const conf = estado.conexion.initJitsiConference(sala, {
    ...cfg,
    p2p: { enabled: false }, // todo pasa por el bridge, también con 2 personas
    startSilent: true
  })
  estado.conferencia = conf
  conf.on(E.CONFERENCE_JOINED, () => {
    marcarConectado(true)
    ponerEstado(`en la sala «${sala}»`, 'vivo')
    conf.setReceiverConstraints({ lastN: -1, defaultConstraints: { maxHeight: Number($('altura').value) } })
  })
  conf.on(E.CONFERENCE_FAILED, (err) => {
    ponerEstado('la sala rechazó la conexión: ' + err, 'error')
    try { estado.conexion.disconnect() } catch (e) { /* nada */ }
    estado.conexion = null; estado.conferencia = null; marcarConectado(false)
  })
  conf.on(E.TRACK_ADDED, (pista) => {
    if (pista.isLocal() || pista.getType() !== 'video') return // el audio no se reproduce ni se envía
    agregarPista(pista).catch((e) => log('Error con la pista:', e.message))
  })
  conf.on(E.USER_JOINED, (id, u) => log('entró:', u.getDisplayName() || id))
  conf.on(E.USER_LEFT, (id, u) => log('salió:', (u && u.getDisplayName()) || id))
  conf.on(E.TRACK_REMOVED, (pista) => { if (!pista.isLocal()) quitarPista(pista) })
  conf.setDisplayName($('nombre').value.trim() || 'NDI')
  conf.join()
}

async function desconectar () {
  try { if (estado.conferencia) await estado.conferencia.leave() } catch (e) { /* nada */ }
  try { if (estado.conexion) estado.conexion.disconnect() } catch (e) { /* nada */ }
  for (const p of [...estado.participantes.values()]) quitarPista(p.pista)
  estado.conferencia = null
  estado.conexion = null
  marcarConectado(false)
  ponerEstado('desconectado')
}

function marcarConectado (si) {
  estado.conectado = si
  const b = $('btnConectar')
  b.textContent = si ? 'desconectar' : 'conectar'
  b.setAttribute('aria-pressed', String(si))
  for (const c of campos) $(c).disabled = si
  actualizarResumen()
}

// ---------- interfaz ----------
$('panel').addEventListener('submit', (e) => {
  e.preventDefault()
  if (estado.conectado || estado.conexion) desconectar()
  else conectar().catch((err) => { ponerEstado(err.message, 'error'); marcarConectado(false) })
})
$('btnInfo').addEventListener('click', () => { $('acerca').hidden = !$('acerca').hidden })
$('btnCerrarInfo').addEventListener('click', () => { $('acerca').hidden = true })
$('btnMostrar').addEventListener('click', () => alternarControles(false))
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return
  if (e.key === 'h') alternarControles()
  if (e.key === 'i') $('acerca').hidden = !$('acerca').hidden
  if (e.key === 'Escape') $('acerca').hidden = true
})
function alternarControles (ocultar) {
  const o = typeof ocultar === 'boolean' ? ocultar : !document.body.classList.contains('oculto')
  document.body.classList.toggle('oculto', o)
  $('btnMostrar').hidden = !o
}

$('version').textContent = 'v' + puente.version
$('ndiInfo').innerHTML = ndi.disponible
  ? `NDI <b>${String(ndi.version).split(' ').pop()}</b> · equipo <b>${puente.equipo}</b>`
  : 'NDI no disponible: revisa la instalación (npm install)'
cargar()
if (sessionStorage.getItem('jn.autoconectar') === '1' || prueba) {
  sessionStorage.removeItem('jn.autoconectar')
  conectar().catch((err) => { ponerEstado(err.message, 'error'); if (prueba) terminarPrueba(1, err.message) })
}

// ---------- prueba automática (CI) ----------
function terminarPrueba (codigo, motivo) {
  log(`RESULTADO ${codigo === 0 ? 'OK' : 'FALLA'}: ${motivo}`)
  puente.salir(codigo)
}
if (prueba) {
  const inicio = Date.now()
  const revisar = setInterval(async () => {
    const lista = [...estado.participantes.values()]
    log('revisión:', lista.map((p) => `${p.salida ? p.salida.nombre : p.persona} ${p.res || ''} ${p.fps}fps cuadros=${p.cuadros}`).join(' | ') || 'sin pistas')
    const lista60 = lista.filter((p) => p.cuadros >= 60 && (!prueba.esperado || (p.salida && p.salida.nombre.includes(prueba.esperado))))
    if (lista60.length) {
      clearInterval(revisar)
      const p = lista60[0]
      const r = await ndi.verificar(p.salida.completo)
      return terminarPrueba(r.ok ? 0 : 1, r.motivo)
    }
    if (Date.now() - inicio > prueba.segundos * 1000) { clearInterval(revisar); terminarPrueba(1, 'tiempo agotado sin video de participantes') }
  }, 2000)
}
