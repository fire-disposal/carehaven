import { PropsWithChildren } from 'react'
import { ReadAloudProvider } from '@/lib/readAloud'
import './app.scss'

// 兼容旧基础库：Promise.withResolvers 是 ES2024 才进入标准的能力。
// 朗读模块用它把回调式播放封装成 Promise，缺了会在启动前就失败。
const promiseCtor = Promise as unknown as {
  withResolvers?: <T>() => {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  }
}
if (typeof promiseCtor.withResolvers !== 'function') {
  promiseCtor.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// 应用入口：不做任何「演示模式」旁路，登录态一律由真实登录流程产生。
function App({ children }: PropsWithChildren) {
  return <ReadAloudProvider>{children}</ReadAloudProvider>
}

export default App
