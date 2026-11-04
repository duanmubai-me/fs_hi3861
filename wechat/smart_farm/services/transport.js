// services/transport.js
// 传输层单例管理：根据当前 env 选择 mock / gateway 适配器。
// 页面不直接 new transport；统一走 services/device。

const config = require('../config/index')
const { createMockTransport } = require('./transport-mock')
const { createGatewayTransport } = require('./transport-gateway')

let current = null
let currentKey = ''

function keyOf(env) {
  return [env.mode, env.baseUrl, env.deviceId].join('|')
}

/**
 * 创建新 transport（不缓存）。
 * @param {object} env
 */
function createTransport(env) {
  if (env.mode === 'gateway') return createGatewayTransport(env)
  return createMockTransport(env)
}

/**
 * 获取与当前 env 匹配的 transport 单例。
 * @param {object} [env]
 */
function getTransport(env) {
  const target = env || config.getEnv()
  const key = keyOf(target)
  if (!current || key !== currentKey) {
    current = createTransport(target)
    currentKey = key
  }
  return current
}

/**
 * 环境切换后调用，强制重建 transport。
 */
function resetTransport() {
  current = null
  currentKey = ''
}

module.exports = {
  createTransport,
  getTransport,
  resetTransport
}
