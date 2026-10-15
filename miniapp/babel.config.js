// Taro 4 使用 Vite 编译时保留 babel 配置（部分插件依赖）
module.exports = {
  presets: [
    [
      'taro',
      {
        framework: 'react',
        ts: true,
      },
    ],
  ],
}
