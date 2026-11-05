// config/index.js
// 默认 gateway（华为云 HTTPS 直连），mock 仅用于主动选择的模拟演示。
// 页面通过 services/device 使用；不要在各页面里散落读写环境。
const cloudConfig = require('./huawei')
const publicCloud = cloudConfig.getPublicConfig()
const LEGACY_STORAGE_KEY = 'smartfarm.env.v1'
const STORAGE_KEY = 'smartfarm.env.v2.huawei-direct'

const MODES = ['mock', 'gateway']

const DEFAULTS = Object.freeze({
  mode: 'gateway',
  baseUrl: publicCloud.baseUrl,
  // 线上仓库（origin/master）硬件配置对应的华为云设备 ID；仅作默认值，可在诊断页覆盖
  deviceId: publicCloud.deviceId,
  pollIntervalMs: 5000,
  staleAfterMs: 90000,
  commandTimeoutMs: 25000
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
    const current = wx.getStorageSync(STORAGE_KEY)
    if (current) return current
    const legacy = wx.getStorageSync(LEGACY_STORAGE_KEY)
    if (legacy && typeof legacy === 'object') {
      // 旧模式的 localhost 指向已停用的电脑后端，不能沿用到云端请求。
      const migrated = Object.assign({}, legacy, {
        mode: 'gateway', baseUrl: DEFAULTS.baseUrl, deviceId: DEFAULTS.deviceId,
        commandTimeoutMs: DEFAULTS.commandTimeoutMs
      })
      if (typeof wx.setStorageSync === 'function') wx.setStorageSync(STORAGE_KEY, migrated)
      return migrated
    }
    return null
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
      wx.setStorageSync(STORAGE_KEY, clone(DEFAULTS))
    } catch (e) {}
  }
  return clone(DEFAULTS)
}

function summarize(env) {
  const e = env || getEnv()
  if (e.mode === 'mock') return 'mock · 应用内模拟设备'
  return 'gateway · 华为云直连 · ' + e.baseUrl
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
