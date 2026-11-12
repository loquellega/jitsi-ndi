/*
  jitsi-ndi · participante falso para pruebas automáticas
  Entra a una sala de Jitsi con la cámara de prueba de Chromium.
  Uso: node prueba/participante-falso.js https://IP:8443/sala Nombre [segundos]
*/
'use strict'
const { chromium } = require('playwright')

async function principal () {
  const [url, nombre = 'Ana', segundos = '120'] = process.argv.slice(2)
  const navegador = await chromium.launch({
    headless: !process.env.DISPLAY, // con pantalla virtual (xvfb) se comporta como un navegador normal
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--ignore-certificate-errors']
  })
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  const pagina = await contexto.newPage()
  const hash = [
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(nombre))}`,
    'config.prejoinConfig.enabled=false',
    'config.startWithVideoMuted=false',
    'config.startWithAudioMuted=true'
  ].join('&')
  pagina.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' || /gum|getUserMedia|camera|video track|NotAllowed|NotFound/i.test(t)) console.log('[falso] consola:', t.slice(0, 220))
  })
  await pagina.goto(`${url}#${hash}`)
  console.log(`[falso] ${nombre} entró a ${url}`)
  await pagina.waitForTimeout(20000)
  try {
    const pistas = await pagina.evaluate(() => (window.APP && APP.store.getState()['features/base/tracks'] || [])
      .filter((t) => t.local).map((t) => `${t.mediaType} muted=${t.muted}`))
    console.log('[falso] pistas locales:', JSON.stringify(pistas))
    await pagina.screenshot({ path: 'participante-falso.png' })
  } catch (e) { console.log('[falso] no se pudo revisar:', e.message) }
  await pagina.waitForTimeout(Math.max(0, Number(segundos) * 1000 - 20000))
  await navegador.close()
}
principal().catch((e) => { console.error('[falso] error:', e); process.exit(1) })
