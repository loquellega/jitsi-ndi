/*
  jitsi-ndi · participante falso para pruebas automáticas
  Entra a una sala de Jitsi con la cámara de prueba de Chromium, usando
  lib-jitsi-meet directamente (sin la interfaz web de Jitsi).
  Uso: node prueba/participante-falso.js https://IP:8443 sala Nombre [segundos]
*/
'use strict'
const { chromium } = require('playwright')

async function principal () {
  const [base, sala = 'tcrv-prueba', nombre = 'Ana', segundos = '120'] = process.argv.slice(2)
  const navegador = await chromium.launch({
    headless: !process.env.DISPLAY,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--ignore-certificate-errors']
  })
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => { if (m.type() === 'error') console.log('[falso] consola:', m.text().slice(0, 220)) })

  await pagina.goto(`${base}/config.js`) // misma procedencia que el servidor
  await pagina.addScriptTag({ url: `${base}/config.js` })
  await pagina.addScriptTag({ url: `${base}/libs/lib-jitsi-meet.min.js` })
  const pistas = await pagina.evaluate(async ({ sala, nombre }) => {
    const J = window.JitsiMeetJS
    J.init({})
    J.setLogLevel(J.logLevels.ERROR)
    const locales = await J.createLocalTracks({ devices: ['audio', 'video'], resolution: 360 })
    const cfg = window.config
    const conexion = new J.JitsiConnection(null, null, { hosts: cfg.hosts, serviceUrl: `${cfg.websocket}?room=${sala}` })
    await new Promise((resolve, reject) => {
      conexion.addEventListener(J.events.connection.CONNECTION_ESTABLISHED, resolve)
      conexion.addEventListener(J.events.connection.CONNECTION_FAILED, reject)
      conexion.connect()
    })
    const conf = conexion.initJitsiConference(sala, { ...cfg, p2p: { enabled: false } })
    conf.setDisplayName(nombre)
    for (const t of locales) await conf.addTrack(t)
    conf.join()
    window._conf = conf
    return locales.map((t) => t.getType())
  }, { sala, nombre })
  console.log(`[falso] ${nombre} entró a ${base}/${sala} con pistas: ${pistas.join(', ')}`)
  // como un iPhone que se bloquea y vuelve: a los N segundos cambia su cámara por una nueva
  const reemplazo = Number(process.env.REEMPLAZAR_A || 0)
  if (reemplazo) {
    await pagina.waitForTimeout(reemplazo * 1000)
    await pagina.evaluate(async () => {
      const J = window.JitsiMeetJS
      const vieja = window._conf.getLocalVideoTrack()
      const [nueva] = await J.createLocalTracks({ devices: ['video'], resolution: 360 })
      await window._conf.replaceTrack(vieja, nueva)
      await vieja.dispose()
    })
    console.log('[falso] cámara reemplazada')
  }
  await pagina.waitForTimeout(Math.max(0, Number(segundos) - reemplazo) * 1000)
  await navegador.close()
}
principal().catch((e) => { console.error('[falso] error:', e); process.exit(1) })
