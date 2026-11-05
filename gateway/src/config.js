'use strict'

// 配置加载顺序：config/default.json < 可选 config/local.json < GATEWAY_* 环境变量。
// local.json 只用于本机联调，不应提交；这里会把 huawei 段原样透传给 provider，
// 但既不校验凭据内容，也不打印或输出其中的任何字段值。

const fs = require('node:fs')
const path = require('node:path')

const PROVIDERS = ['mock', 'huawei', 'local']
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

function readJson(filePath, required) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    if (!required && err && err.code === 'ENOENT') return null
    throw new Error('无法读取配置文件 ' + filePath + '：' + (err && err.message ? err.message : String(err)))
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error('配置文件不是合法 JSON：' + filePath)
  }
}

function isInteger(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value
}

function parsePort(value, source) {
  const port = Number(value)
  if (!isInteger(port) || port < 0 || port > 65535) {
    throw new Error(source + ' 的 port 必须是 0–65535 的整数')
  }
  return port
}

function normalize(raw, source) {
  const input = raw || {}
  const host = input.host
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) {
    throw new Error(source + ' 的 host 必须是非空字符串')
  }
  const provider = input.provider
  if (PROVIDERS.indexOf(provider) < 0) {
    throw new Error(source + ' 的 provider 必须是 ' + PROVIDERS.join('/') + ' 之一')
  }
  if (typeof input.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.deviceId)) {
    throw new Error(source + ' 的 deviceId 不合法（1–64 位字母、数字、点、下划线、冒号或连字符）')
  }
  if (!isInteger(input.staleAfterMs) || input.staleAfterMs <= 0) {
    throw new Error(source + ' 的 staleAfterMs 必须是正整数')
  }
  if (!isInteger(input.commandTimeoutMs) || input.commandTimeoutMs <= 0) {
    throw new Error(source + ' 的 commandTimeoutMs 必须是正整数')
  }

  // huawei 段只在 huawei provider 内使用。这里做浅拷贝透传，避免 provider 意外修改
  // 原始配置；凭据值不做任何校验/格式化，也绝不写日志。
  const huawei = input.huawei && typeof input.huawei === 'object' && !Array.isArray(input.huawei)
    ? Object.assign({}, input.huawei)
    : null

  return {
    host: host,
    port: parsePort(input.port, source),
    provider: provider,
    deviceId: input.deviceId,
    staleAfterMs: input.staleAfterMs,
    commandTimeoutMs: input.commandTimeoutMs,
    huawei: huawei
  }
}

function applyEnvOverrides(config, env) {
  if (env.GATEWAY_PORT !== undefined && String(env.GATEWAY_PORT).trim() !== '') {
    config.port = parsePort(String(env.GATEWAY_PORT).trim(), '环境变量 GATEWAY_PORT')
  }
  if (env.GATEWAY_HOST !== undefined && String(env.GATEWAY_HOST).trim() !== '') {
    config.host = String(env.GATEWAY_HOST).trim()
  }
  if (env.GATEWAY_PROVIDER !== undefined && String(env.GATEWAY_PROVIDER).trim() !== '') {
    config.provider = String(env.GATEWAY_PROVIDER).trim().toLowerCase()
  }
  return config
}

/**
 * 读取并校验 gateway 配置。
 * @param {{env?:object, rootDir?:string}} [options]
 * @returns {{host:string,port:number,provider:string,deviceId:string,staleAfterMs:number,commandTimeoutMs:number}}
 */
function loadConfig(options) {
  const opts = options || {}
  const rootDir = opts.rootDir || path.resolve(__dirname, '..')
  const configDir = path.join(rootDir, 'config')
  const defaults = readJson(path.join(configDir, 'default.json'), true)
  const local = readJson(path.join(configDir, 'local.json'), false)
  const merged = Object.assign({}, defaults, local || {})
  const config = normalize(applyEnvOverrides(merged, opts.env || process.env), '配置')
  return config
}

module.exports = {
  PROVIDERS,
  loadConfig
}
