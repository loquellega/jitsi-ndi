/*
  jitsi-ndi · proceso principal (Electron)
  Abre la ventana del receptor y ajusta lo necesario para conectarse a un
  servidor Jitsi propio: certificado de prueba en la red local, cabecera
  Origin del servidor y video sin pausas aunque la ventana quede atrás.

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/
'use strict'

const path = require('path')
const { app, BrowserWindow, session, ipcMain } = require('electron')

// Video sin gesto del usuario y sin bajar el ritmo cuando la ventana no tiene foco
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// Modo de prueba automática: --prueba-e2e servidor=https://… sala=… segundos=60
const argsPrueba = process.argv.includes('--prueba-e2e')
  ? Object.fromEntries(process.argv.filter((a) => a.includes('=')).map((a) => a.split(/=(.*)/s).slice(0, 2)))
  : null

// Certificados de prueba: solo se aceptan para la red local (IP privadas, localhost y .local).
function esLocal (host) {
  const h = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) ||
    /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1'
}
app.on('certificate-error', (evento, _wc, url, _error, _cert, callback) => {
  try {
    if (esLocal(new URL(url).host)) { evento.preventDefault(); callback(true); return }
  } catch (e) { /* URL inválida: se rechaza */ }
  callback(false)
})

function crearVentana () {
  // Prosody y el bridge esperan que las conexiones vengan del propio servidor
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'wss://*/*'] }, (det, cb) => {
    try {
      const u = new URL(det.url)
      det.requestHeaders.Origin = `https://${u.host}`
    } catch (e) { /* se deja igual */ }
    cb({ requestHeaders: det.requestHeaders })
  })

  const ventana = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    title: 'jitsi-ndi',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // el módulo NDI vive aquí (window.puente)
      nodeIntegration: false, // la sala corre como navegador normal: lib-jitsi-meet falla si detecta Node
      contextIsolation: false, // comparte window con el preload, sin copiar cada cuadro
      sandbox: false,
      webSecurity: false, // carga config.js y lib-jitsi-meet desde tu servidor Jitsi
      backgroundThrottling: false
    }
  })
  ventana.loadFile(path.join(__dirname, 'index.html'), argsPrueba ? { query: argsPrueba } : undefined)
  if (argsPrueba) {
    ventana.webContents.on('console-message', (...a) => {
      const e = a[0] && a[0].message !== undefined ? a[0] : { message: a[2] }
      console.log('[ventana]', e.message)
    })
  }
}

ipcMain.on('salir', (_e, codigo) => { app.exit(Number(codigo) || 0) })

app.whenReady().then(crearVentana)
app.on('window-all-closed', () => app.quit())
