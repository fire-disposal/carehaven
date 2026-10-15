import { PropsWithChildren } from 'react'
import './app.scss'

// 应用入口：不做任何「演示模式」旁路，登录态一律由真实登录流程产生。
function App({ children }: PropsWithChildren) {
  return <>{children}</>
}

export default App
