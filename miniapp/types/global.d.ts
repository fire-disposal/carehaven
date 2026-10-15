/// <reference types="@tarojs/taro" />

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
