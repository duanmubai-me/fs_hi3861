'use strict'

// 单设备注册表：当前一个 gateway 进程只承载 config.deviceId 这一个设备。
// provider 实例在启动时创建并注册，路由通过 deviceId 精确查找，未知设备返回 null。

function createRegistry() {
  const devices = new Map()

  function register(descriptor) {
    if (!descriptor || typeof descriptor.deviceId !== 'string' || descriptor.deviceId.length === 0) {
      throw new Error('registry.register 需要非空 deviceId')
    }
    if (!descriptor.provider || typeof descriptor.provider.getState !== 'function' ||
        typeof descriptor.provider.sendCommand !== 'function') {
      throw new Error('registry.register 需要提供 getState/sendCommand 的 provider')
    }
    const entry = {
      deviceId: descriptor.deviceId,
      provider: descriptor.provider
    }
    devices.set(entry.deviceId, entry)
    return entry
  }

  function get(deviceId) {
    return devices.get(deviceId) || null
  }

  return {
    register: register,
    get: get,
    has: function (deviceId) {
      return devices.has(deviceId)
    },
    list: function () {
      return Array.from(devices.values())
    }
  }
}

module.exports = {
  createRegistry
}
