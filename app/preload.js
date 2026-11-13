/*
  jitsi-ndi · puente entre la ventana y Node
  La página de la sala corre como un navegador normal (sin Node), porque
  lib-jitsi-meet cambia de comportamiento si detecta Node. Aquí se carga el
  módulo NDI y se le da a la página solo lo que necesita: window.puente.

  Diseño, investigación y desarrollo: Héctor Cruz Juárez — https://hectorcruz.com.mx
  Colección Alchemy of Meaning.
*/
'use strict'

const os = require('os')
const { ipcRenderer } = require('electron')
const pkg = require('../package.json')

let grandiose = null
let errorNdi = null
try { grandiose = require('@stagetimerio/grandiose') } catch (e) { errorNdi = e }

window.puente = {
  version: pkg.version,
  equipo: os.hostname(),
  ndi: {
    disponible: !!grandiose,
    error: errorNdi ? errorNdi.message : null,
    version: grandiose ? grandiose.version() : null,

    // Crea una señal NDI. Devuelve { nombreCompleto, enviar(datosRGBA, ancho, alto), cerrar() }
    async crear (nombre) {
      const sender = await grandiose.send({ name: nombre, clockVideo: false, clockAudio: false })
      return {
        nombreCompleto: sender.sourcename(),
        enviar (datos, ancho, alto) {
          return sender.video({
            xres: ancho,
            yres: alto,
            frameRateN: 30000,
            frameRateD: 1000,
            fourCC: grandiose.FOURCC_RGBX,
            pictureAspectRatio: ancho / alto,
            frameFormatType: grandiose.FORMAT_TYPE_PROGRESSIVE,
            lineStrideBytes: ancho * 4,
            data: Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength)
          })
        },
        // audio en float de 32 bits por canal separado (planar), como lo entrega WebRTC
        enviarAudio (datos, canales, muestras, frecuencia) {
          return sender.audio({
            sampleRate: frecuencia,
            noChannels: canales,
            noSamples: muestras,
            channelStrideBytes: muestras * 4,
            fourCC: grandiose.FOURCC_FLTp,
            data: Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength)
          })
        },
        cerrar () { return sender.destroy() }
      }
    },

    // Solo para la prueba automática: busca una señal en la red y recibe un cuadro.
    async verificar (nombreCompleto, segundos = 10, conAudio = false) {
      const finder = await grandiose.find({ showLocalSources: true })
      let fuente = null
      for (let t = 0; t < segundos && !fuente; t++) {
        await finder.wait(1000)
        fuente = finder.sources().find((f) => f.name === nombreCompleto)
      }
      await finder.destroy()
      if (!fuente) return { ok: false, motivo: `no apareció la señal ${nombreCompleto} en la red` }
      const rx = await grandiose.receive({ source: fuente, colorFormat: grandiose.COLOR_FORMAT_BGRX_BGRA })
      const limite = Date.now() + 10000
      let video = null
      let audio = null
      while (Date.now() < limite && !(video && (audio || !conAudio))) {
        try {
          const d = await rx.data({ audioFormat: grandiose.AUDIO_FORMAT_FLOAT_32_SEPARATE }, 2000)
          if (d && d.type === 'video') video = d
          if (d && d.type === 'audio') audio = d
        } catch (e) { /* reintenta */ }
      }
      if (!video) return { ok: false, motivo: 'la señal existe pero no llegó video' }
      if (conAudio && !audio) return { ok: false, motivo: 'llegó video pero no audio por NDI' }
      return { ok: true, motivo: `"${fuente.name}" llega por NDI a ${video.xres}×${video.yres}` + (audio ? ` con audio ${audio.sampleRate} Hz, ${audio.channels || audio.noChannels || '?'} canal(es)` : '') }
    }
  },
  salir (codigo) { ipcRenderer.send('salir', codigo) },
  ventana (accion) { ipcRenderer.send('ventana', accion) }
}
