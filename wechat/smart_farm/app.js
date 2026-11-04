// app.js
// 智慧农业小程序入口。所有环境参数统一走 config/index.js，页面不直接读写存储。
const config = require('./config/index')
const device = require('./services/device')

App({
  globalData: {
    appVersion: '0.1.0',
    bootId: '',
    env: null
  },

  onLaunch() {
    this.globalData.bootId = 'app-' + Date.now().toString(36)
    this.globalData.env = config.getEnv()
    // 只做本地初始化，不在这里发网络请求；页面 onShow 时自行刷新。
    console.info('[smart_farm] launch', this.globalData.env.mode, this.globalData.env.deviceId)
  },

  onShow() {
    this.globalData.env = config.getEnv()
  },

  onHide() {},

  /**
   * 页面切换环境（mock/gateway）后调用，保证 transport 单例重建。
   * @param {object} patch
   * @returns {object} 新的 env
   */
  applyEnv(patch) {
    const env = config.setEnv(patch || {})
    device.resetTransport()
    this.globalData.env = env
    return env
  }
})
