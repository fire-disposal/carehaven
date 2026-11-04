import type { Plugin } from 'vite'

/** 语音等媒体不内联成 base64：CDN 可缓存，InnerAudioContext 也能按 URL 播放 */
export default function keepAssetsExternal(): Plugin {
  return {
    name: 'carehaven:keep-assets-external',
    config(config) {
      config.build = config.build ?? {}
      config.build.assetsInlineLimit = 0
    },
  }
}
