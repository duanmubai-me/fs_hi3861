// gateway 模式现在表示小程序直接通过 HTTPS 访问华为云，不经过电脑后端。
const cloudConfig = require('../config/huawei')
const { createHuaweiProvider } = require('./huawei-client')
const errors = require('../models/errors')

function createWxFetch(timeoutMs) {
  return function (url, init) {
    return new Promise(function (resolve, reject) {
      if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
        reject(new Error('当前环境没有 wx.request'))
        return
      }
      const options = init || {}
      if (!/^https:\/\//i.test(String(url))) {
        reject(new Error('华为云直连只允许 HTTPS 地址'))
        return
      }
      let settled = false
      let task = null
      const signal = options.signal
      function cleanup() {
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort)
      }
      function fail(message) {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(message))
      }
      function abort() {
        fail('华为云请求已取消或超时，结果未知')
        if (task && typeof task.abort === 'function') task.abort()
      }
      if (signal && signal.aborted) { abort(); return }
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', abort)
      try {
        task = wx.request({
          url: String(url),
          method: options.method || 'GET',
          header: options.headers || {},
          data: options.body,
          timeout: timeoutMs || 25000,
          success: function (res) {
            if (settled) return
            settled = true
            cleanup()
            const headers = {}
            Object.keys(res.header || {}).forEach(function (key) { headers[key.toLowerCase()] = res.header[key] })
            const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data === undefined ? null : res.data)
            resolve({
              status: res.statusCode,
              headers: { get: function (name) { return headers[String(name).toLowerCase()] || null } },
              text: function () { return Promise.resolve(body) }
            })
          },
          // 不传播可能含请求内容的原始错误对象。
          fail: function () { fail('无法访问华为云，请检查网络、HTTPS 域名配置和真机调试设置') }
        })
      } catch (err) {
        fail('无法发起华为云请求')
      }
    })
  }
}

function createHuaweiTransport(env, deps) {
  const options = deps || {}
  const huawei = Object.assign({}, options.huaweiConfig || cloudConfig.getHuaweiConfig())
  if (env.baseUrl) huawei.iotdaEndpoint = env.baseUrl
  if (env.deviceId) huawei.deviceId = env.deviceId
  const provider = createHuaweiProvider({ huawei: huawei, deviceId: env.deviceId }, {
    fetchImpl: options.fetchImpl || createWxFetch(huawei.requestTimeoutMs),
    now: options.now,
    allowLegacyRevision: true
  })
  let pending = false

  async function getState() {
    const state = await provider.getState()
    // 影子读取时间不等于传感器采样时间，使用云端 reported 的时间判断数据年龄。
    if (state.sensor.sampledAt) state.receivedAt = state.sensor.sampledAt
    if (state.config.configRevision === null) state.config.configStatus = 'unconfirmed'
    return state
  }

  function rejectUnsupported(action, meta, message) {
    return {
      requestId: meta.requestId, action: action, status: 'rejected',
      errorCode: 'UNSUPPORTED_CAPABILITY', message: message,
      saved: false, configRevision: null, params: {}, appliedAt: Date.now()
    }
  }

  return {
    name: 'gateway',
    describe: function () { return '华为云直连（HTTPS，无需电脑后端）' },
    getState: getState,
    sendCommand: async function (action, params, meta) {
      if (pending) throw errors.createError('BUSY', '上一条设备命令尚未返回，请勿重复操作')
      pending = true
      try {
        const safeMeta = meta || {}
        if (action === 'set_security_config' || action === 'acknowledge_alarm') {
          // 旧固件对未知命令也可能返回 result_code=0，必须在下发前核对能力。
          const state = await getState()
          if (!state.capabilities.flame.available || state.config.configRevision === null ||
              (action === 'set_security_config' && (typeof state.config.flameTrip !== 'number' || typeof state.config.flameClear !== 'number'))) {
            return rejectUnsupported(action, safeMeta, '固件尚未上报火焰配置协议，未下发该命令')
          }
        }
        const result = await provider.sendCommand(action, params || {}, safeMeta)
        // 只有显式的 Flash 写入结果才可证明持久化；回传阈值或版本号不能替代。
        if (result.saved !== true && result.status === 'applied' && action !== 'set_fan') {
          result.message = result.message || '设备已执行，但未确认写入 Flash'
        }
        return result
      } finally { pending = false }
    },
    health: async function () {
      await getState()
      return { ok: true, configured: true, provider: 'huawei-direct', deviceId: huawei.deviceId, version: 'direct-1.0.0', note: 'IAM 鉴权及设备查询已通过；不代表设备在线或命令已执行' }
    }
  }
}

module.exports = { createHuaweiTransport, createWxFetch }
