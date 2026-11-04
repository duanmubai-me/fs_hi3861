// config/index.js
// 运行环境配置。默认 mock（应用内模拟设备），联调时可切 gateway（本机应用服务）。
// 页面通过 services/device 使用；不要在各页面里散落读写环境。
const STORAGE_KEY = 'smartfarm.env.v1'

const MODES = ['mock', 'gateway']

const DEFAULTS = Object.freeze({
  mode: 'mock',
  baseUrl: 'http://127.0.0.1:8080',
  deviceId: 'mock-farm-001',
  pollIntervalMs: 5000,
  staleAfterMs: 90000,
  commandTimeoutMs: 9000
})

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function hasStorage() {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function'
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!isFinite(n)) return fallback
  const i = Math.round(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

function sanitize(raw) {
  const out = clone(DEFAULTS)
  if (!raw || typeof raw !== 'object') return out
  if (MODES.indexOf(raw.mode) >= 0) out.mode = raw.mode
  if (typeof raw.baseUrl === 'string' && raw.baseUrl.length <= 200) out.baseUrl = raw.baseUrl.replace(/\/+$/, '')
  if (typeof raw.deviceId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.deviceId)) out.deviceId = raw.deviceId
  out.pollIntervalMs = clampInt(raw.pollIntervalMs, DEFAULTS.pollIntervalMs, 1000, 60000)
  out.staleAfterMs = clampInt(raw.staleAfterMs, DEFAULTS.staleAfterMs, 5000, 600000)
  out.commandTimeoutMs = clampInt(raw.commandTimeoutMs, DEFAULTS.commandTimeoutMs, 1000, 30000)
  return out
}

function readStored() {
  if (!hasStorage()) return null
  try {
    return wx.getStorageSync(STORAGE_KEY) || null
  } catch (e) {
    return null
  }
}

function getEnv() {
  return sanitize(readStored())
}

function setEnv(patch) {
  const next = sanitize(Object.assign(getEnv(), patch || {}))
  if (hasStorage()) {
    try {
      wx.setStorageSync(STORAGE_KEY, next)
    } catch (e) {
      // 存储失败不阻断使用，本次运行仍返回新配置
    }
  }
  return next
}

function resetEnv() {
  if (hasStorage()) {
    try {
      wx.removeStorageSync(STORAGE_KEY)
    } catch (e) {}
  }
  return clone(DEFAULTS)
}

function summarize(env) {
  const e = env || getEnv()
  if (e.mode === 'mock') return 'mock · 应用内模拟设备'
  return 'gateway · ' + e.baseUrl
}

module.exports = {
  STORAGE_KEY,
  DEFAULTS,
  MODES,
  getEnv,
  setEnv,
  resetEnv,
  summarize,
  sanitize
}
