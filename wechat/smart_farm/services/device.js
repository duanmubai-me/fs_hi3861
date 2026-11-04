// services/device.js
// 设备业务门面：页面只调用这里，不直接碰 transport/协议字段。
// 统一返回形状：
//   refresh() -> {ok, raw, view, error, env, transportName}
//   send()/业务方法 -> {ok, requestId, result, error}
// error 为 models/errors.js describeError() 产出的可展示对象。

const config = require('../config/index')
const transportModule = require('./transport')
const stateModel = require('../models/state')
const errors = require('../models/errors')
const units = require('../utils/units')
const idUtil = require('../utils/id')

let lastCommand = null

function getEnv() {
  return config.getEnv()
}

/**
 * 修改运行环境（模式/地址/设备 ID），并重建 transport。
 * @param {object} patch
 * @returns {object} 新 env
 */
function setEnv(patch) {
  const env = config.setEnv(patch || {})
  transportModule.resetTransport()
  return env
}

function resetTransport() {
  transportModule.resetTransport()
}

function getTransport() {
  return transportModule.getTransport(config.getEnv())
}

function transportName() {
  return getTransport().name || ''
}

function transportDescribe() {
  const transport = getTransport()
  return typeof transport.describe === 'function' ? transport.describe() : transport.name || ''
}

function record(action, requestId, result, error) {
  lastCommand = {
    action: action,
    requestId: requestId,
    result: result || null,
    error: error || null,
    at: Date.now()
  }
  return lastCommand
}

/**
 * 拉取设备状态并归一化。
 * @returns {Promise<object>}
 */
async function refresh() {
  const env = config.getEnv()
  let raw = null
  try {
    raw = await getTransport().getState()
  } catch (e) {
    const error = errors.describeError(e)
    record('refresh', null, null, error)
    return { ok: false, raw: null, view: null, error: error, env: env, transportName: transportName() }
  }
  const view = stateModel.normalizeState(raw, {
    now: Date.now(),
    staleAfterMs: env.staleAfterMs,
    online: raw.online !== false
  })
  return { ok: true, raw: raw, view: view, error: null, env: env, transportName: transportName() }
}

/**
 * 发一条设备命令并等待结果。
 * @param {string} action
 * @param {object} params
 * @param {{expectedRevision?:number, requestId?:string}} [options]
 * @returns {Promise<object>}
 */
async function send(action, params, options) {
  const opts = options || {}
  const env = config.getEnv()
  const transport = getTransport()
  const requestId = opts.requestId || idUtil.createRequestId(action)
  try {
    const result = await transport.sendCommand(action, params || {}, {
      requestId: requestId,
      expectedRevision: opts.expectedRevision
    })
    const ok = !!result && result.status === 'applied'
    const error = ok
      ? null
      : errors.describeError({
          code: (result && result.errorCode) || 'UNKNOWN',
          message: (result && result.message) || ''
        })
    record(action, requestId, result, error)
    return { ok: ok, requestId: requestId, result: result, error: error }
  } catch (e) {
    const error = errors.describeError(e)
    record(action, requestId, null, error)
    return { ok: false, requestId: requestId, result: null, error: error }
  }
}

/**
 * 客户端阈值校验（与设备端一致：0–100 整数、下限<上限）。
 * @param {*} lower
 * @param {*} upper
 * @returns {{ok:boolean, value?:{lower:number,upper:number}, error?:object}}
 */
function validateThresholds(lower, upper) {
  const low = units.parsePercentInt(lower)
  const high = units.parsePercentInt(upper)
  if (low === null || high === null) {
    return { ok: false, error: errors.describeError({ code: 'OUT_OF_RANGE', message: '阈值需为 0–100 的整数' }) }
  }
  if (low >= high) {
    return {
      ok: false,
      error: errors.describeError({ code: 'INVALID_THRESHOLD_RANGE', message: '下限必须小于上限' })
    }
  }
  return { ok: true, value: { lower: low, upper: high } }
}

/**
 * 保存湿度阈值（完整 up/down，原子命令）。
 * @param {{lower:*, upper:*, sensorKind?:string}} input
 * @param {{expectedRevision?:number}} [options]
 */
function saveThresholds(input, options) {
  const data = input || {}
  const checked = validateThresholds(data.lower, data.upper)
  if (!checked.ok) {
    return Promise.resolve({ ok: false, requestId: null, result: null, error: checked.error, invalid: true })
  }
  const params = { lower: checked.value.lower, upper: checked.value.upper }
  if (data.sensorKind === 'air_rh' || data.sensorKind === 'soil_relative') params.sensorKind = data.sensorKind
  return send('set_thresholds', params, options)
}

/**
 * 手动开关风扇/水泵（原子：退出自动并设置目标）。
 * @param {boolean} on
 * @param {{expectedRevision?:number}} [options]
 */
function setFan(on, options) {
  return send('set_fan', { value: on ? 'ON' : 'OFF' }, options)
}

/**
 * 开启/关闭自动控制。
 * @param {boolean} on
 * @param {{expectedRevision?:number}} [options]
 */
function setAutoMode(on, options) {
  return send('set_mode', { mode: on ? 'auto' : 'manual' }, options)
}

function strictInt(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!isFinite(n) || Math.floor(n) !== n) return null
  return n
}

/**
 * 火焰阈值配置校验。
 * @param {{flameTrip:*, flameClear:*}} input
 */
function validateSecurityConfig(input) {
  const trip = strictInt((input || {}).flameTrip)
  const clear = strictInt((input || {}).flameClear)
  if (trip === null || clear === null || trip < 0 || trip > 4095 || clear < 0 || clear > 4095) {
    return {
      ok: false,
      error: errors.describeError({ code: 'OUT_OF_RANGE', message: '火焰阈值需为 0–4095 的整数' })
    }
  }
  if (trip <= clear) {
    return {
      ok: false,
      error: errors.describeError({ code: 'INVALID_THRESHOLD_RANGE', message: '触发阈值必须大于解除阈值（按强度升高触发）' })
    }
  }
  return { ok: true, value: { flameTrip: trip, flameClear: clear } }
}

/**
 * 保存火焰阈值（设备端走同一配置事务，成功后掉电保存）。
 * @param {{flameTrip:*, flameClear:*, alarmEnabled?:boolean}} input
 * @param {{expectedRevision?:number}} [options]
 */
function saveSecurityConfig(input, options) {
  const checked = validateSecurityConfig(input)
  if (!checked.ok) {
    return Promise.resolve({ ok: false, requestId: null, result: null, error: checked.error, invalid: true })
  }
  const data = input || {}
  return send(
    'set_security_config',
    {
      flameTrip: checked.value.flameTrip,
      flameClear: checked.value.flameClear,
      alarmEnabled: data.alarmEnabled !== false
    },
    options
  )
}

/**
 * 确认解除报警（仅在已满足解除条件时可清锁；不恢复输出）。
 * @param {object} [options]
 */
function acknowledgeAlarm(options) {
  return send('acknowledge_alarm', {}, options)
}

/**
 * mock 专用：演示火焰报警状态（真实模式不应存在该入口）。
 * @param {'active'|'clearing'|'normal'} status
 */
function mockTriggerAlarm(status) {
  return send('mock_alarm', { status: status })
}

/**
 * 应用服务/设备健康检查。
 */
async function health() {
  try {
    const data = await getTransport().health()
    return { ok: true, health: data, error: null }
  } catch (e) {
    return { ok: false, health: null, error: errors.describeError(e) }
  }
}

/**
 * mock 故障注入（仅 mock transport 支持）。
 * @param {object} patch {offline,sensorError,nvWriteError,nvVerifyError,slowMs}
 */
function setFaults(patch) {
  const transport = getTransport()
  if (typeof transport.setFaults !== 'function') return null
  return transport.setFaults(patch || {})
}

function getFaults() {
  const transport = getTransport()
  if (typeof transport.getFaults !== 'function') return null
  return transport.getFaults()
}

/**
 * 重置 mock 设备（配置回到默认、报警清除）。
 */
function resetMock() {
  const transport = getTransport()
  if (typeof transport.reset !== 'function') return Promise.resolve(null)
  return transport.reset()
}

/**
 * 最近一次命令（页面展示"最近回执"用）。
 * @returns {object|null}
 */
function getLastCommand() {
  if (!lastCommand) return null
  return {
    action: lastCommand.action,
    requestId: lastCommand.requestId,
    result: lastCommand.result,
    error: lastCommand.error,
    at: lastCommand.at,
    saved: !!(lastCommand.result && lastCommand.result.status === 'applied' && lastCommand.result.saved),
    status: lastCommand.result ? lastCommand.result.status : 'error'
  }
}

/**
 * 把命令结果转成页面可展示的一句话。
 * @param {object|null} command output of getLastCommand()
 * @returns {{level:string, text:string}}
 */
function resultSummary(command) {
  if (!command) return { level: 'muted', text: '暂无命令记录' }
  if (command.error) {
    return { level: 'err', text: command.error.message + (command.error.detail ? '（' + command.error.detail + '）' : '') }
  }
  if (command.result && command.result.status === 'applied') {
    if (command.result.saved) {
      return {
        level: 'ok',
        text: '已保存到设备（revision ' + (command.result.configRevision === undefined ? '--' : command.result.configRevision) + '）'
      }
    }
    return { level: 'ok', text: '设备已执行' }
  }
  return { level: 'warn', text: '结果未知，请刷新状态核对' }
}

module.exports = {
  getEnv,
  setEnv,
  resetTransport,
  transportName,
  transportDescribe,
  refresh,
  send,
  validateThresholds,
  saveThresholds,
  setFan,
  setAutoMode,
  validateSecurityConfig,
  saveSecurityConfig,
  acknowledgeAlarm,
  mockTriggerAlarm,
  health,
  setFaults,
  getFaults,
  resetMock,
  getLastCommand,
  resultSummary
}
