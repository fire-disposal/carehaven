/// <reference types="@tarojs/taro" />

// Promise.withResolvers 是 ES2024；小程序的旧基础库没有，app.tsx 里补了等价的 polyfill。
interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  }
}

declare module '*.png'
declare module '*.gif'
declare module '*.jpg'
declare module '*.jpeg'
declare module '*.svg'
declare module '*.css'
declare module '*.less'
declare module '*.scss'
declare module '*.sass'
declare module '*.styl'

declare namespace NodeJS {
  interface ProcessEnv {
    /** 后端 API 基址；留空表示与页面同源（H5 构建产物由 PocketBase 托管时使用） */
    TARO_APP_API_BASE?: string
  }
}
