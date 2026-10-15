import path from 'node:path'
import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

// 智护忆站小程序端构建配置（Taro 4 + Vite）
// 同一套代码：build:h5 出网页版（用于验收与截图），build:weapp 出微信小程序版。
export default defineConfig<'vite'>(async (merge) => {
  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'zhihuyizhan',
    date: '2026-10-15',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {},
    },
    framework: 'react',
    compiler: { type: 'vite' },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      // hash 路由：静态托管（PocketBase 的 pb_public）下无需服务端 rewrite
      router: {
        mode: 'hash',
      },
      postcss: {
        // Taro 注入的缩放脚本按 clamp(40 × min(视口宽, 视口高) / 750, min, max) 设置根字号。
        // 默认 max=40：宽屏下 min 取到视口高度（如 800）→ 字号顶到 40px，
        // 相对手机竖屏（20.8px）整页放大近 2 倍，即「横屏/桌面过度变形」。
        // 把上限钉在手机竖屏档位（390 / 750 × 40 = 20.8），
        // 并放宽下限让小屏手机按比例缩小而不是硬撑 20px。
        pxtransform: {
          enable: true,
          config: {
            maxRootSize: 20.8,
            minRootSize: 12,
          },
        },
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
    },
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})
