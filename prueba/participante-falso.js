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
  await pagina.goto(`${url}#${hash}`)
  console.log(`[falso] ${nombre} entró a ${url}`)
  await pagina.waitForTimeout(Number(segundos) * 1000)
  await navegador.close()
}
principal().catch((e) => { console.error('[falso] error:', e); process.exit(1) })
