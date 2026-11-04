// services/transport-mock.js
// mock 传输层：把 services/mock-device.js 适配成统一 transport 接口。
// 统一 transport 接口（mock/gateway 必须一致）：
//   name: string
//   describe(): string
//   getState(): Promise<RawState>
//   sendCommand(action, params, meta): Promise<CommandResult>
//   health(): Promise<object>
//   setFaults(patch) / getFaults() / reset()   —— 仅 mock 有

const mockDevice = require('./mock-device')
const idUtil = require('../utils/id')

function createWxStorage() {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
    return {
      get: function (key) {
        try {
          return wx.getStorageSync(key) || null
        } catch (e) {
          return null
        }
      },
      set: function (key, value) {
        try {
          wx.setStorageSync(key, value)
        } catch (e) {}
      }
    }
  }
  return mockDevice.createMemoryStorage()
}

/**
 * @param {object} env config/index.js 的环境
 * @param {{storage?:object, latencyMs?:number, seed?:number}} [options]
 */
function createMockTransport(env, options) {
  const opts = options || {}
  const device = mockDevice.createMockDevice({
    deviceId: (env && env.deviceId) || 'mock-farm-001',
    storage: opts.storage || createWxStorage(),
    latencyMs: typeof opts.latencyMs === 'number' ? opts.latencyMs : 260,
    seed: opts.seed
  })

  return {
    name: 'mock',
    describe: function () {
      return '应用内模拟设备（mock）'
    },
    getState: function () {
      return device.getState()
    },
    sendCommand: function (action, params, meta) {
      const safeMeta = meta || {}
      return device.sendCommand(action, params, {
        requestId: safeMeta.requestId || idUtil.createRequestId(action),
        expectedRevision: safeMeta.expectedRevision
      })
    },
    health: function () {
      return device.health()
    },
    setFaults: function (patch) {
      return device.setFaults(patch)
    },
    getFaults: function () {
      return device.getFaults()
    },
    reset: function () {
      return device.reset()
    },
    // 便于测试/诊断读取底层对象
    _device: device
  }
}

module.exports = {
  createMockTransport
}
