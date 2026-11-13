/*
  jitsi-ndi · receptor
  Entra a la sala de Jitsi sin cámara ni micrófono, recibe el video de cada
  participante y lo publica como una señal NDI con el nombre de la persona.

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/
'use strict'

// window.puente lo crea preload.js: da acceso al módulo NDI sin exponer Node a la página
const puente = window.puente || { version: '?', equipo: '?', ndi: { disponible: false, error: 'sin preload' }, salir () {}, ventana () {} }
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

// ---------- fichas (una por persona y tipo de video) ----------
// La ficha y su señal NDI pertenecen a la PERSONA, no a su cámara: si el teléfono se
// bloquea y vuelve con una cámara nueva, la misma señal NDI sigue recibiendo video.
function crearFicha (clave, nombrePersona) {
  const ficha = document.createElement('section')
  ficha.className = 'ficha'
  ficha.innerHTML = `
    <div class="imagen"><video autoplay muted playsinline></video><span class="esq ar">—</span></div>
    <div class="datos"><span class="nombre"></span><span class="lectura fps">0 fps</span></div>
    <div class="medidor"><i></i></div>`
  $('vacio').hidden = true
  $('rejilla').appendChild(ficha)
  const p = {
    clave,
    pista: null,
    mst: null, // MediaStreamTrack que se está leyendo
    persona: nombrePersona,
    el: ficha,
    video: ficha.querySelector('video'),
    salida: null,
    activo: true,
    ocupado: false,
    gen: 0, // cada reinicio de lectura incrementa la generación
    lector: null,
    modo: '',
    cuadros: 0,
    cuadrosSeg: 0,
    fps: 0,
    segSinCuadros: 0,
    buf: null,
    bufRot: null
  }
  ficha.querySelector('.nombre').textContent = nombrePersona
  return p
}

function claveDe (pista) {
  return `${pista.getParticipantId()}:${(pista.getVideoType && pista.getVideoType()) || 'camera'}`
}

async function agregarPista (pista) {
  const id = pista.getParticipantId()
  const clave = claveDe(pista)
  let p = estado.participantes.get(clave)
  if (p) {
    // misma persona, cámara nueva (desbloqueo, cambio de cámara, reconexión del video)
    log('cámara nueva de', p.persona)
    p.reemplazos = (p.reemplazos || 0) + 1
    usarPista(p, pista)
    return
  }
  const participante = estado.conferencia.getParticipantById(id)
  let nombrePersona = limpiarNombre(participante && participante.getDisplayName()) || `Participante ${estado.participantes.size + 1}`
  if (clave.endsWith(':desktop')) nombrePersona += ' pantalla'
  p = crearFicha(clave, nombrePersona)
  estado.participantes.set(clave, p)
  try {
    p.salida = await obtenerSalida(nombrePersona)
    p.el.querySelector('.nombre').textContent = p.salida.nombre
    p.el.title = `Señal NDI: ${p.salida.completo}`
  } catch (e) {
    p.el.querySelector('.nombre').textContent = `${nombrePersona} · sin NDI`
    log('Error al crear la señal NDI:', e.message)
    return
  }
  usarPista(p, pista)
  actualizarResumen()
}

function usarPista (p, pista) {
  if (p.pista && p.pista !== pista) { try { p.pista.detach(p.video) } catch (e) { /* nada */ } }
  p.pista = pista
  pista.attach(p.video) // solo para la vista previa de la ficha
  if (p.salida) bombear(p)
}

function quitarPista (pista) {
  const p = estado.participantes.get(claveDe(pista))
  if (!p || p.pista !== pista) return // ya la reemplazó una cámara nueva de la misma persona
  p.activo = false
  p.gen++
  if (p.lector) p.lector.cancel().catch(() => {})
  try { pista.detach(p.video) } catch (e) { /* ya se fue */ }
  if (p.salida) p.salida.enUso = false
  p.el.remove()
  estado.participantes.delete(p.clave)
  $('vacio').hidden = estado.participantes.size > 0
  actualizarResumen()
}

// ---------- lectura de cuadros ----------
// Se leen directo del flujo de WebRTC (MediaStreamTrackProcessor), sin depender de que
// la ventana se dibuje: así sigue a velocidad normal aunque esté minimizada o tapada.
function bombear (p) {
  const gen = ++p.gen
  if (p.lector) { p.lector.cancel().catch(() => {}); p.lector = null }
  p.ocupado = false
  p.segSinCuadros = 0
  const mst = p.pista && p.pista.getTrack()
  p.mst = mst
  if (!mst) return
  if (typeof window.MediaStreamTrackProcessor !== 'function') { p.modo = 'video'; return bombearVideo(p, gen) }
  p.modo = 'procesador'
  const lector = new window.MediaStreamTrackProcessor({ track: mst }).readable.getReader()
  p.lector = lector
  ;(async () => {
    while (p.activo && gen === p.gen) {
      let r
      try { r = await lector.read() } catch (e) { break }
      if (r.done) break
      const cuadro = r.value
      if (p.ocupado || gen !== p.gen) { cuadro.close(); continue } // si NDI va atrasado, se salta el cuadro
      p.ocupado = true
      convertir(p, cuadro)
        .then(({ datos, w, h }) => p.salida.senal.enviar(datos, w, h).then(() => { p.cuadros++; p.cuadrosSeg++; p.res = `${w}×${h}` }))
        .catch((e) => log('Error con un cuadro de', p.persona + ':', e.message))
        .finally(() => { p.ocupado = false })
    }
  })()
}

// VideoFrame → RGBX en memoria, con la orientación aplicada (los iPhone mandan la rotación aparte).
async function convertir (p, cuadro) {
  try {
    const w = cuadro.visibleRect.width
    const h = cuadro.visibleRect.height
    const tam = w * h * 4
    if (!p.buf || p.buf.byteLength !== tam) p.buf = new Uint8Array(tam)
    await cuadro.copyTo(p.buf, { format: 'RGBX' })
    let rot = Number(cuadro.rotation) || 0
    if (cuadro.rotation === undefined) {
      // navegador sin VideoFrame.rotation: se deduce de la vista previa
      const vw = p.video.videoWidth; const vh = p.video.videoHeight
      if (vw && vh && (vw > vh) !== (w > h)) rot = 90
    }
    if (!rot) return { datos: p.buf, w, h }
    if (!p.bufRot || p.bufRot.byteLength !== tam) p.bufRot = new Uint8Array(tam)
    rotar(p.buf, p.bufRot, w, h, rot)
    return rot === 180 ? { datos: p.bufRot, w, h } : { datos: p.bufRot, w: h, h: w }
  } finally {
    cuadro.close()
  }
}

// Rota una imagen RGBX en sentido horario (90, 180 o 270 grados).
function rotar (origen, destino, w, h, grados) {
  const s = new Uint32Array(origen.buffer, origen.byteOffset, w * h)
  const d = new Uint32Array(destino.buffer, destino.byteOffset, w * h)
  for (let y = 0; y < h; y++) {
    const fila = y * w
    for (let x = 0; x < w; x++) {
      const px = s[fila + x]
      if (grados === 90) d[x * h + (h - 1 - y)] = px
      else if (grados === 270) d[(w - 1 - x) * h + y] = px
      else d[(h - 1 - y) * w + (w - 1 - x)] = px
    }
  }
}

// Respaldo para navegadores sin MediaStreamTrackProcessor: lee de la vista previa.
function bombearVideo (p, gen) {
  const v = p.video
  const lienzo = document.createElement('canvas')
  const ctx = lienzo.getContext('2d', { willReadFrequently: true, alpha: false })
  const paso = () => {
    if (!p.activo || gen !== p.gen) return
    const w = v.videoWidth & ~1
    const h = v.videoHeight & ~1
    if (w > 0 && h > 0 && !p.ocupado) {
      if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h }
      ctx.drawImage(v, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      p.ocupado = true
      p.salida.senal.enviar(img.data, w, h).then(() => { p.cuadros++; p.cuadrosSeg++; p.res = `${w}×${h}` })
        .catch((e) => log('Error al enviar cuadro:', e.message))
        .finally(() => { p.ocupado = false })
    }
    v.requestVideoFrameCallback(paso)
  }
  v.requestVideoFrameCallback(paso)
}

// Cada segundo: lecturas de la ficha y vigilancia. Si la cámara cambió por dentro o
// lleva 3 s sin cuadros sin estar en pausa, se vuelve a enganchar sola.
setInterval(() => {
  for (const p of estado.participantes.values()) {
    p.fps = p.cuadrosSeg
    p.cuadrosSeg = 0
    p.el.querySelector('.fps').innerHTML = `<b>${p.fps}</b> fps`
    p.el.querySelector('.esq').textContent = p.res || '—'
    p.el.querySelector('.medidor i').style.width = Math.min(100, (p.fps / 30) * 100) + '%'
    p.el.classList.toggle('fuera', p.fps === 0)
    if (!p.pista || !p.salida) continue
    const enPausa = p.pista.isMuted && p.pista.isMuted()
    p.segSinCuadros = p.fps === 0 && !enPausa ? p.segSinCuadros + 1 : 0
    if (p.pista.getTrack() !== p.mst) { log('re-enganche (cámara cambió):', p.persona); bombear(p) } else if (p.segSinCuadros >= 3) { log('re-enganche (sin cuadros):', p.persona); bombear(p) }
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
  for (const p of [...estado.participantes.values()]) {
    if (p.pista) quitarPista(p.pista)
    else { p.activo = false; p.el.remove(); estado.participantes.delete(p.clave) }
  }
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
      log('modo de lectura:', p.modo)
      const r = await ndi.verificar(p.salida.completo)
      if (!r.ok) return terminarPrueba(1, r.motivo)
      // con la ventana oculta (como minimizada) los cuadros deben seguir llegando
      puente.ventana('ocultar')
      const antes = p.cuadros
      await new Promise((resolve) => setTimeout(resolve, 6000))
      const fpsOculta = (p.cuadros - antes) / 6
      puente.ventana('mostrar')
      if (fpsOculta < 10) return terminarPrueba(1, `con la ventana oculta bajó a ${fpsOculta.toFixed(1)} fps`)
      let resumen = `${r.motivo}; con la ventana oculta siguió a ${fpsOculta.toFixed(1)} fps (modo ${p.modo})`
      if (params.get('reemplazo') === '1') {
        // el participante cambia de cámara: debe seguir saliendo por la MISMA señal NDI
        const limite = Date.now() + 60000
        while (Date.now() < limite && !(p.reemplazos > 0 || p.pista.getTrack() !== p.mst)) await new Promise((resolve) => setTimeout(resolve, 500))
        await new Promise((resolve) => setTimeout(resolve, 6000))
        const c0 = p.cuadros
        await new Promise((resolve) => setTimeout(resolve, 5000))
        const fpsDespues = (p.cuadros - c0) / 5
        const senales = estado.salidas.size
        log('tras el cambio de cámara:', fpsDespues, 'fps,', senales, 'señal(es), reemplazos', p.reemplazos || 0)
        if (estado.participantes.get(p.clave) !== p || senales !== 1 || fpsDespues < 10) {
          return terminarPrueba(1, `tras cambiar de cámara: ${fpsDespues.toFixed(1)} fps, ${senales} señales NDI`)
        }
        resumen += `; tras cambiar de cámara siguió en la misma señal a ${fpsDespues.toFixed(1)} fps`
      }
      return terminarPrueba(0, resumen)
    }
    if (Date.now() - inicio > prueba.segundos * 1000) { clearInterval(revisar); terminarPrueba(1, 'tiempo agotado sin video de participantes') }
  }, 2000)
}

// ---------- autoprueba del módulo NDI (jitsi-ndi.exe --autoprueba) ----------
if (params.has('autoprueba')) {
  (async () => {
    if (!ndi.disponible) return terminarPrueba(1, 'el módulo NDI no cargó: ' + ndi.error)
    const s = await ndi.crear('TCRV autoprueba')
    const w = 640; const h = 360
    const datos = new Uint8Array(w * h * 4).fill(128)
    const reloj = setInterval(() => s.enviar(datos, w, h).catch(() => {}), 33)
    const r = await ndi.verificar(s.nombreCompleto, 15)
    clearInterval(reloj)
    terminarPrueba(r.ok ? 0 : 1, r.motivo)
  })().catch((e) => terminarPrueba(1, e.message))
}
