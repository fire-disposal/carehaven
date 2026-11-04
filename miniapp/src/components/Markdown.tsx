import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './Markdown.scss'

/**
 * 轻量 Markdown 渲染：标题、段落、列表、粗体、行内代码、链接。
 *
 * 只覆盖项目内文档用到的语法，不引入解析库。
 * 链接：H5 新窗口打开；小程序内复制链接并提示到浏览器打开（平台限制外链）。
 */

type Block =
  | { type: 'h2' | 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }

function parse(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let list: string[] = []

  const flush = () => {
    if (list.length > 0) {
      blocks.push({ type: 'ul', items: list })
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('## ')) {
      flush()
      blocks.push({ type: 'h2', text: line.slice(3) })
      continue
    }
    if (line.startsWith('### ')) {
      flush()
      blocks.push({ type: 'h3', text: line.slice(4) })
      continue
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      continue
    }
    flush()
    blocks.push({ type: 'p', text: line })
  }
  flush()
  return blocks
}

function openLink(url: string) {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  Taro.setClipboardData({ data: url })
    .then(() => Taro.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' }))
    .catch(() => {
      Taro.showToast({ title: '未能复制链接', icon: 'none' })
    })
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE).filter((part) => part !== '')
  return (
    <>
      {parts.map((part, index) => {
        const strong = /^\*\*([^*]+)\*\*$/.exec(part)
        if (strong) {
          return (
            <Text key={index} className="md-strong">
              {strong[1]}
            </Text>
          )
        }
        const code = /^`([^`]+)`$/.exec(part)
        if (code) {
          return (
            <Text key={index} className="md-code">
              {code[1]}
            </Text>
          )
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
        if (link) {
          return (
            <Text
              key={index}
              className="md-link"
              ariaRole="link"
              ariaLabel={`${link[1]}，外部链接`}
              onClick={() => openLink(link[2])}
            >
              {link[1]}
            </Text>
          )
        }
        return <Text key={index}>{part}</Text>
      })}
    </>
  )
}

export default function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = parse(source)
  return (
    <View className={`md ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.type === 'ul') {
          return (
            <View className="md-list" key={index}>
              {block.items.map((item, i) => (
                <View className="md-li" key={i}>
                  <View className="md-dot" />
                  <Text className="md-li-text">
                    <Inline text={item} />
                  </Text>
                </View>
              ))}
            </View>
          )
        }
        if (block.type === 'h2' || block.type === 'h3') {
          return (
            <Text className={`md-heading md-heading--${block.type}`} key={index}>
              <Inline text={block.text} />
            </Text>
          )
        }
        return (
          <Text className="md-p" key={index}>
            <Inline text={block.text} />
          </Text>
        )
      })}
    </View>
  )
}
