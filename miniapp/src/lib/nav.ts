import Taro from '@tarojs/taro'

/**
 * 返回上一个页面；如果当前是直接打开的（没有上一页，常见于 H5 直接访问），
 * 就回落到对应的 TabBar 页。
 *
 * 注意：微信小程序不允许 redirectTo / navigateTo 到 TabBar 页，
 * 因此回落必须用 switchTab，而不是 redirectTo。
 */
export async function backOrSwitchTab(tabUrl: string): Promise<void> {
  try {
    const pages = Taro.getCurrentPages()
    if (pages && pages.length > 1) {
      await Taro.navigateBack({ delta: 1 })
      return
    }
  } catch (e) {
    // 读取页面栈失败时继续走回落
  }
  await Taro.switchTab({ url: tabUrl })
}
