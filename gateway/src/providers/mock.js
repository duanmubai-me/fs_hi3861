'use strict'

// mock provider：直接复用小程序侧的 services/mock-device.js，
// 保证 gateway 与小程序内置 mock 的配置/revision/幂等/报警语义一致。
// 只在这里创建一个内存 storage 和一个 createMockDevice 实例。

const path = require('node:path')

const mockDevicePath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'wechat',
  'smart_farm',
  'services',
  'mock-device.js'
)
const mockDeviceModule = require(mockDevicePath)

function createMockProvider(options) {
  const opts = options || {}
  const deviceId = typeof opts.deviceId === 'string' && opts.deviceId
    ? opts.deviceId
    : 'mock-farm-001'
  const latencyMs = typeof opts.latencyMs === 'number' && opts.latencyMs >= 0
    ? opts.latencyMs
    : 300

  const storage = opts.storage || mockDeviceModule.createMemoryStorage()
  const device = mockDeviceModule.createMockDevice({
    deviceId: deviceId,
    latencyMs: latencyMs,
    storage: storage,
    seed: opts.seed,
    faults: opts.faults
  })

  return {
    provider: 'mock',
    implemented: true,
    getState: function () {
      return device.getState()
    },
    sendCommand: function (action, params, meta) {
      return device.sendCommand(action, params, meta)
    },
    health: function () {
      return device.health()
    }
  }
}

module.exports = {
  createMockProvider
}
