/*
  jitsi-ndi · Prueba de señales NDI
  ---------------------------------
  Publica N señales NDI de prueba (por defecto 8), una por "participante",
  para comprobar que TouchDesigner (NDI In TOP) las recibe antes de conectar Jitsi.

  Cada señal tiene un color propio, su número en grande y una barra blanca
  que se mueve (así se nota si la imagen está viva o congelada).
  Por defecto la señal 3 es vertical (360×640), como un teléfono parado.

  Uso:
    node prueba/senales-prueba.js
    node prueba/senales-prueba.js --n 4 --w 640 --h 360 --fps 30 --verticales 3,5
    node prueba/senales-prueba.js --segundos 8 --verificar   (prueba automática)

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/

'use strict'

const grandiose = require('@stagetimerio/grandiose')

// ---------- opciones ----------
function leerOpciones (argv) {
  const op = { n: 8, w: 640, h: 360, fps: 30, verticales: [3], segundos: 0, verificar: false, prefijo: 'TCRV Prueba' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const sig = () => argv[++i]
    if (a === '--n') op.n = parseInt(sig(), 10)
    else if (a === '--w') op.w = parseInt(sig(), 10)
    else if (a === '--h') op.h = parseInt(sig(), 10)
    else if (a === '--fps') op.fps = parseInt(sig(), 10)
    else if (a === '--verticales') op.verticales = sig().split(',').filter(Boolean).map(Number)
    else if (a === '--segundos') op.segundos = parseFloat(sig())
    else if (a === '--prefijo') op.prefijo = sig()
    else if (a === '--verificar') op.verificar = true
    else if (a === '--ayuda' || a === '-h') {
      console.log('Opciones: --n 8  --w 640  --h 360  --fps 30  --verticales 3,5  --segundos 0  --prefijo "TCRV Prueba"  --verificar')
      process.exit(0)
    }
  }
  if (!(op.n >= 1 && op.n <= 16)) throw new Error('--n debe estar entre 1 y 16')
  // NDI prefiere dimensiones pares
  op.w -= op.w % 2
  op.h -= op.h % 2
  return op
}

// ---------- dibujo en un buffer BGRA ----------
// Fuente de 5×7 para los dígitos 0–9 (cada fila es un número de 5 bits).
const DIGITOS = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31],
  [31, 2, 4, 2, 1, 17, 14], [2, 6, 10, 18, 31, 2, 2], [31, 16, 30, 1, 1, 17, 14],
  [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8], [14, 17, 17, 14, 17, 17, 14],
  [14, 17, 17, 15, 1, 2, 12]
]

function hsvABgr (h, s, v) {
  const f = (k) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)) }
  return [Math.round(f(1) * 255), Math.round(f(3) * 255), Math.round(f(5) * 255)] // B, G, R
}

function rect (buf, w, h, x0, y0, rw, rh, b, g, r) {
  const x1 = Math.min(w, x0 + rw); const y1 = Math.min(h, y0 + rh)
  for (let y = Math.max(0, y0); y < y1; y++) {
    let p = (y * w + Math.max(0, x0)) * 4
    for (let x = Math.max(0, x0); x < x1; x++) {
      buf[p] = b; buf[p + 1] = g; buf[p + 2] = r; buf[p + 3] = 255; p += 4
    }
  }
}

function texto (buf, w, h, str, x0, y0, escala) {
  let x = x0
  for (const ch of String(str)) {
    const filas = DIGITOS[ch.charCodeAt(0) - 48]
    if (!filas) { x += 6 * escala; continue }
    for (let fy = 0; fy < 7; fy++) {
      for (let fx = 0; fx < 5; fx++) {
        if (filas[fy] & (16 >> fx)) rect(buf, w, h, x + fx * escala, y0 + fy * escala, escala, escala, 255, 255, 255)
      }
    }
    x += 6 * escala
  }
}

// Fondo fijo de cada señal: color propio, número grande y una marca en la esquina.
function fondo (indice, total, w, h) {
  const buf = Buffer.alloc(w * h * 4)
  const [b, g, r] = hsvABgr((360 * (indice - 1)) / total, 0.65, 0.55)
  rect(buf, w, h, 0, 0, w, h, b, g, r)
  // marco de 4 px para ver si TD recorta la imagen
  rect(buf, w, h, 0, 0, w, 4, 255, 255, 255); rect(buf, w, h, 0, h - 4, w, 4, 255, 255, 255)
  rect(buf, w, h, 0, 0, 4, h, 255, 255, 255); rect(buf, w, h, w - 4, 0, 4, h, 255, 255, 255)
  const digitos = String(indice)
  const escala = Math.max(4, Math.floor(Math.min(w / (digitos.length * 6 + 1), h / 9) * 0.6))
  const tw = digitos.length * 6 * escala - escala
  texto(buf, w, h, digitos, Math.floor((w - tw) / 2), Math.floor((h - 7 * escala) / 2), escala)
  return buf
}

// ---------- programa ----------
async function principal () {
  const op = leerOpciones(process.argv.slice(2))
  console.log(`NDI SDK ${grandiose.version()} · CPU compatible: ${grandiose.isSupportedCPU()}`)

  const senales = []
  for (let i = 1; i <= op.n; i++) {
    const vertical = op.verticales.includes(i)
    const w = vertical ? op.h : op.w
    const h = vertical ? op.w : op.h
    const sender = await grandiose.send({ name: `${op.prefijo} ${i}`, clockVideo: false, clockAudio: false })
    senales.push({ i, w, h, sender, base: fondo(i, op.n, w, h), cuadro: Buffer.alloc(w * h * 4) })
    console.log(`  · ${sender.sourcename()}  ${w}×${h}${vertical ? '  (vertical)' : ''}`)
  }

  let n = 0
  let enviando = false
  const intervalo = 1000 / op.fps
  const inicio = Date.now()

  async function enviar () {
    if (enviando) return // si un cuadro tarda, se salta el siguiente en vez de acumular
    enviando = true
    try {
      await Promise.all(senales.map((s) => {
        s.base.copy(s.cuadro)
        // barra blanca que recorre la imagen en 2 s
        const ancho = Math.max(6, Math.floor(s.w / 40))
        const x = Math.floor(((n % (op.fps * 2)) / (op.fps * 2)) * (s.w - ancho))
        rect(s.cuadro, s.w, s.h, x, 0, ancho, s.h, 255, 255, 255)
        return s.sender.video({
          xres: s.w,
          yres: s.h,
          frameRateN: op.fps * 1000,
          frameRateD: 1000,
          fourCC: grandiose.FOURCC_BGRA,
          pictureAspectRatio: s.w / s.h,
          frameFormatType: grandiose.FORMAT_TYPE_PROGRESSIVE,
          lineStrideBytes: s.w * 4,
          data: s.cuadro
        })
      }))
      n++
    } finally {
      enviando = false
    }
  }

  const reloj = setInterval(() => { enviar().catch((e) => { console.error('Error al enviar:', e); salir(1) }) }, intervalo)
  console.log(`\nEnviando ${op.n} señales a ${op.fps} fps. Ctrl+C para terminar.`)
  console.log('En TouchDesigner: NDI In TOP → elige la fuente por nombre.\n')

  let cerrando = false
  async function salir (codigo = 0) {
    if (cerrando) return
    cerrando = true
    clearInterval(reloj)
    for (const s of senales) await s.sender.destroy().catch(() => {})
    const seg = (Date.now() - inicio) / 1000
    console.log(`\nListo: ${n} cuadros por señal en ${seg.toFixed(1)} s (${(n / seg).toFixed(1)} fps).`)
    process.exit(codigo)
  }
  process.on('SIGINT', () => salir(0))
  process.on('SIGTERM', () => salir(0))

  if (op.verificar) {
    // Prueba automática: busca las señales en la red local y recibe un cuadro de la primera.
    await new Promise((r) => setTimeout(r, 1500))
    let codigo = 0
    const finder = await grandiose.find({ showLocalSources: true })
    let fuentes = []
    for (let t = 0; t < 6 && fuentes.filter((f) => f.name.includes(op.prefijo)).length < op.n; t++) {
      await finder.wait(1000)
      fuentes = finder.sources()
    }
    await finder.destroy()
    const propias = fuentes.filter((f) => f.name.includes(op.prefijo))
    console.log(`Verificación: ${propias.length}/${op.n} señales encontradas en la red.`)
    for (const f of propias) console.log(`  ✓ ${f.name}  ${f.urlAddress || ''}`)
    const primera = propias.find((f) => f.name.endsWith(`${op.prefijo} 1)`)) || propias[0]
    if (primera) {
      const receptor = await grandiose.receive({ source: primera, colorFormat: grandiose.COLOR_FORMAT_BGRX_BGRA })
      // Al conectar, NDI manda primero metadatos o cambios de estado: se ignoran hasta que llega video.
      let cuadro = null
      const limite = Date.now() + 8000
      while (!cuadro && Date.now() < limite) {
        try {
          const d = await receptor.data({}, 2000)
          if (d && d.type === 'video') cuadro = d
        } catch (e) { /* tiempo de espera sin datos: se reintenta */ }
      }
      if (cuadro) {
        console.log(`  ✓ Cuadro recibido de "${primera.name}": ${cuadro.xres}×${cuadro.yres}`)
      } else {
        console.log(`  ✗ No llegó ningún cuadro de video de "${primera.name}"`)
        codigo = 1
      }
    } else {
      console.log('  ✗ No se encontró ninguna señal (¿mDNS bloqueado en esta red?)')
      codigo = 1
    }
    if (op.segundos > 0) setTimeout(() => salir(codigo), Math.max(0, op.segundos * 1000 - (Date.now() - inicio)))
    else salir(codigo)
    return
  }

  if (op.segundos > 0) setTimeout(() => salir(0), op.segundos * 1000)
}

principal().catch((e) => {
  console.error('\nNo se pudo iniciar NDI:', e && e.message ? e.message : e)
  console.error('Revisa que el NDI Runtime (o NDI Tools) esté instalado y que la instalación con npm haya compilado sin errores.')
  process.exit(1)
})
