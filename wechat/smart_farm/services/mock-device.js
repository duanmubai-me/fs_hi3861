// services/mock-device.js
// 应用内模拟设备（纯逻辑，不依赖 wx / DOM），供小程序 mock 模式与 Node 测试/网关复用。
//
// 设计目标：
//  - 覆盖必选闭环：阈值保存（含 revision/幂等/回读语义）、手动开关、自动模式、状态上报；
//  - 覆盖可选功能：气体能力位、火焰报警/解除、电机方向能力位；
//  - 可注入故障（离线/传感器故障/NV 写失败/慢响应），用于演示 UI 的失败与保护状态；
//  - 命令语义与 doc/05（事务与 ACK）、doc/07（错误码/幂等/优先级）保持一致。
'use strict'

const CONFIG_STORAGE_KEY = 'smartfarm.mock.config.v1'

const CODES = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_THRESHOLD_RANGE: 'INVALID_THRESHOLD_RANGE',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  DUPLICATE_CONFLICT: 'DUPLICATE_CONFLICT',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  SENSOR_INVALID: 'SENSOR_INVALID',
  ALARM_LOCKED: 'ALARM_LOCKED',
  NV_WRITE_FAILED: 'NV_WRITE_FAILED',
  NV_VERIFY_FAILED: 'NV_VERIFY_FAILED',
  BUSY: 'BUSY'
}

const DEFAULT_CONFIG = {
  sensorKind: 'air_rh',
  humidityLower: 30,
  humidityUpper: 40,
  mode: 'manual',
  flameTrip: 160,
  flameClear: 120,
  alarmEnabled: true,
  configRevision: 0,
  configStatus: 'ok',
  updatedAt: null,
  lastConfigRequestId: null,
  lastConfigSignature: null
}

const CAPABILITIES = {
  board: 'FS-Hi3861 V4.2 (mock)',
  firmware: 'mock-0.1.0',
  supportsMotorReverse: true,
  gas: { eco2: true, tvoc: true, combustible: false },
  flame: { available: true, rawRange: [0, 4095], direction: 'up' },
  calibrated: { combustible: false }
}

function makeRng(seed) {
  if (!isFinite(seed)) return Math.random
  let value = Math.floor(seed) % 2147483647
  if (value <= 0) value += 2147483646
  return function next() {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function createMemoryStorage(initial) {
  const map = Object.assign({}, initial || {})
  return {
    get: function (key) {
      return map[key] === undefined ? null : map[key]
    },
    set: function (key, value) {
      map[key] = value
    }
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function isInt(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value
}

function signatureOf(action, params) {
  const keys = Object.keys(params || {}).sort()
  const normalized = {}
  keys.forEach(function (key) {
    normalized[key] = params[key]
  })
  return action + '|' + JSON.stringify(normalized)
}

function reject(requestId, action, code, params) {
  return {
    requestId: requestId,
    action: action,
    status: 'rejected',
    errorCode: code,
    message: '',
    saved: false,
    configRevision: null,
    params: clone(params || {}),
    appliedAt: null
  }
}

/**
 * 创建模拟设备实例。
 * @param {object} [options]
 * @param {number} [options.latencyMs] 命令模拟时延，默认 260ms；0 表示立即
 * @param {number} [options.seed] 随机种子（测试可复现）
 * @param {{get:Function,set:Function}} [options.storage] 配置持久化；默认内存
 * @param {string} [options.deviceId]
 * @param {number} [options.maxRunMs] 连续运行保护（默认 5 分钟，0 关闭）
 * @param {object} [options.faults] {offline,sensorError,nvWriteError,nvVerifyError,slowMs}
 * @param {Function} [options.now]
 */
function createMockDevice(options) {
  const opts = options || {}
  const now =
    typeof opts.now === 'function'
      ? opts.now
      : function () {
          return Date.now()
        }
  const latencyMs = typeof opts.latencyMs === 'number' ? Math.max(0, opts.latencyMs) : 260
  const random = makeRng(opts.seed)
  const storage = opts.storage || createMemoryStorage()
  const deviceId = opts.deviceId || 'mock-farm-001'
  const bootId = 'boot-' + now().toString(36) + '-' + Math.floor(random() * 1e6).toString(36)
  const bootAt = now()
  const maxRunMs = typeof opts.maxRunMs === 'number' ? opts.maxRunMs : 5 * 60 * 1000

  const faults = Object.assign(
    { offline: false, sensorError: false, nvWriteError: false, nvVerifyError: false, slowMs: 0 },
    opts.faults || {}
  )

  let config = loadConfig()
  let commandLog = Object.create(null)
  let seq = 0

  const runtime = {
    humidity: 46.2,
    temperature: 25.6,
    flameRaw: 130,
    eco2: 430,
    tvoc: 16,
    quality: 'ok',
    fan: false,
    motor: 'stopped',
    mode: config.mode,
    alarm: { status: 'normal', id: null, since: null, muted: false },
    fanOnSince: null,
    sampledAt: now()
  }

  // 恢复"最后一条配置命令"的幂等结果（重启后同 requestId 重发仍返回原结果）
  if (config.lastConfigRequestId && config.lastConfigSignature) {
    commandLog[config.lastConfigRequestId] = {
      signature: config.lastConfigSignature,
      result: {
        requestId: config.lastConfigRequestId,
        action: 'persisted',
        status: 'applied',
        errorCode: null,
        message: '',
        saved: true,
        configRevision: config.configRevision,
        params: {},
        appliedAt: config.updatedAt || now()
      },
      at: now()
    }
  }

  function loadConfig() {
    let stored = null
    try {
      const raw = storage.get(CONFIG_STORAGE_KEY)
      if (raw) stored = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch (e) {
      stored = null
    }
    const merged = Object.assign({}, DEFAULT_CONFIG, stored || {})
    const valid =
      isInt(merged.humidityLower) &&
      isInt(merged.humidityUpper) &&
      merged.humidityLower >= 0 &&
      merged.humidityUpper <= 100 &&
      merged.humidityLower < merged.humidityUpper &&
      isFinite(merged.configRevision)
    if (!valid) {
      merged.sensorKind = DEFAULT_CONFIG.sensorKind
      merged.humidityLower = DEFAULT_CONFIG.humidityLower
      merged.humidityUpper = DEFAULT_CONFIG.humidityUpper
      merged.flameTrip = DEFAULT_CONFIG.flameTrip
      merged.flameClear = DEFAULT_CONFIG.flameClear
      merged.alarmEnabled = DEFAULT_CONFIG.alarmEnabled
      merged.configRevision = 0
      merged.mode = 'manual'
      merged.configStatus = 'defaulted'
    }
    return merged
  }

  function persistConfig() {
    try {
      storage.set(CONFIG_STORAGE_KEY, JSON.stringify(config))
    } catch (e) {
      // 模拟存储写失败由 faults 控制；这里吞掉真实 JS 异常
    }
  }

  function sensorInvalid() {
    return faults.sensorError || runtime.quality === 'error'
  }

  function updateSample() {
    const drift = function (scale) {
      return (random() - 0.5) * scale
    }
    runtime.humidity = Math.min(80, Math.max(20, runtime.humidity + drift(1.6)))
    runtime.temperature = Math.min(34, Math.max(18, runtime.temperature + drift(0.4)))
    runtime.flameRaw = Math.max(0, Math.min(4095, Math.round(runtime.flameRaw + drift(60))))
    runtime.eco2 = Math.max(400, Math.round(runtime.eco2 + drift(40)))
    runtime.tvoc = Math.max(0, Math.round(runtime.tvoc + drift(6)))
    runtime.quality = sensorInvalid() ? 'error' : 'ok'
    runtime.sampledAt = now()

    if (runtime.mode === 'auto' && !sensorInvalid() && runtime.alarm.status !== 'active') {
      const humidity = runtime.humidity
      if (humidity <= config.humidityLower) {
        setFan(true)
      } else if (humidity >= config.humidityUpper) {
        setFan(false)
      }
      if (runtime.fan && !runtime.fanOnSince) runtime.fanOnSince = now()
      if (maxRunMs > 0 && runtime.fan && runtime.fanOnSince && now() - runtime.fanOnSince > maxRunMs) {
        // 连续运行保护：停止输出并置故障质量，等待人工确认（简化演示）
        setFan(false)
        runtime.fanOnSince = null
        runtime.quality = 'error'
      }
    } else if (runtime.alarm.status === 'active') {
      setFan(false)
    }
  }

  function setFan(on) {
    runtime.fan = !!on
    if (!runtime.fan) runtime.fanOnSince = null
    else if (!runtime.fanOnSince) runtime.fanOnSince = now()
  }

  function snapshot() {
    const online = !faults.offline
    seq += 1
    const latestRevision = config.configRevision
    return {
      deviceId: deviceId,
      online: online,
      bootId: bootId,
      seq: seq,
      uptimeMs: now() - bootAt,
      sensor: {
        kind: config.sensorKind,
        humidity: sensorInvalid() ? null : Math.round(runtime.humidity * 10) / 10,
        temperature: Math.round(runtime.temperature * 10) / 10,
        quality: sensorInvalid() ? 'error' : 'ok',
        sampledAt: runtime.sampledAt
      },
      actuators: {
        fan: runtime.fan ? 'on' : 'off',
        motor: runtime.motor
      },
      mode: runtime.mode,
      alarm: {
        status: runtime.alarm.status,
        id: runtime.alarm.id,
        since: runtime.alarm.since,
        muted: runtime.alarm.muted
      },
      config: {
        sensorKind: config.sensorKind,
        humidityLower: config.humidityLower,
        humidityUpper: config.humidityUpper,
        flameTrip: config.flameTrip,
        flameClear: config.flameClear,
        alarmEnabled: config.alarmEnabled,
        configRevision: latestRevision,
        configStatus: config.configStatus,
        updatedAt: config.updatedAt
      },
      gas: {
        eco2: CAPABILITIES.gas.eco2 ? runtime.eco2 : null,
        tvoc: CAPABILITIES.gas.tvoc ? runtime.tvoc : null,
        combustibleRaw: CAPABILITIES.gas.combustible ? null : null,
        quality: CAPABILITIES.gas.eco2 || CAPABILITIES.gas.tvoc ? 'ok' : 'not_configured'
      },
      flame: {
        raw: CAPABILITIES.flame.available ? runtime.flameRaw : null,
        quality: 'ok'
      },
      capabilities: clone(CAPABILITIES),
      receivedAt: now()
    }
  }

  function finish(requestId, action, result, latency) {
    const payload = Object.assign(
      {
        requestId: requestId,
        action: action,
        status: 'applied',
        errorCode: null,
        message: '',
        saved: false,
        configRevision: config.configRevision,
        params: {},
        appliedAt: now()
      },
      result || {}
    )
    return new Promise(function (resolve) {
      const wait = Math.max(0, latencyMs + (faults.slowMs || 0))
      if (wait === 0) resolve(payload)
      else setTimeout(function () { resolve(payload) }, wait)
    })
  }

  function recordCommand(requestId, action, params, result) {
    if (!requestId) return
    commandLog[requestId] = {
      signature: signatureOf(action, params),
      result: clone(result),
      at: now()
    }
    const ids = Object.keys(commandLog)
    if (ids.length > 50) delete commandLog[ids[0]]
  }

  function checkDuplicate(requestId, action, params) {
    if (!requestId || !commandLog[requestId]) return null
    const entry = commandLog[requestId]
    const signature = signatureOf(action, params)
    if (entry.signature === signature) {
      return finish(requestId, action, Object.assign({}, entry.result, { idempotent: true }), 0)
    }
    const conflict = reject(requestId, action, CODES.DUPLICATE_CONFLICT, params)
    return finish(requestId, action, conflict, 0)
  }

  function checkRevision(meta) {
    if (!meta || meta.expectedRevision === undefined || meta.expectedRevision === null) return null
    if (!isFinite(meta.expectedRevision)) return CODES.INVALID_PAYLOAD
    if (Number(meta.expectedRevision) !== config.configRevision) return CODES.REVISION_CONFLICT
    return null
  }

  /**
   * @param {string} action
   * @param {object} params
   * @param {{requestId:string, expectedRevision?:number}} [meta]
   * @returns {Promise<object>}
   */
  function sendCommand(action, params, meta) {
    const safeMeta = meta || {}
    const requestId = safeMeta.requestId || 'auto-' + now().toString(36)
    const safeParams = params || {}

    const duplicate = checkDuplicate(requestId, action, safeParams)
    if (duplicate) return duplicate

    if (faults.offline) {
      const result = reject(requestId, action, CODES.DEVICE_OFFLINE, safeParams)
      return finish(requestId, action, result, 0)
    }

    const revisionError = checkRevision(safeMeta)

    if (action === 'set_fan') {
      const value = safeParams.value
      if (value !== 'ON' && value !== 'OFF') {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_PAYLOAD, safeParams))
      }
      if (runtime.alarm.status === 'active') {
        return finish(requestId, action, reject(requestId, action, CODES.ALARM_LOCKED, safeParams))
      }
      if (revisionError) {
        return finish(requestId, action, reject(requestId, action, revisionError, safeParams))
      }
      runtime.mode = 'manual'
      config.mode = 'manual'
      persistConfig()
      setFan(value === 'ON')
      const result = {
        status: 'applied',
        saved: false,
        configRevision: config.configRevision,
        params: { value: value },
        device: { mode: runtime.mode, fan: runtime.fan ? 'on' : 'off' }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, latencyMs)
    }

    if (action === 'set_mode') {
      const mode = safeParams.mode
      if (mode !== 'auto' && mode !== 'manual') {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_PAYLOAD, safeParams))
      }
      if (mode === 'auto' && sensorInvalid()) {
        return finish(requestId, action, reject(requestId, action, CODES.SENSOR_INVALID, safeParams))
      }
      if (revisionError) {
        return finish(requestId, action, reject(requestId, action, revisionError, safeParams))
      }
      if (runtime.alarm.status === 'active') {
        return finish(requestId, action, reject(requestId, action, CODES.ALARM_LOCKED, safeParams))
      }
      if (mode === 'auto' && !(config.humidityLower < config.humidityUpper)) {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_THRESHOLD_RANGE, safeParams))
      }
      if (faults.nvWriteError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_WRITE_FAILED, safeParams))
      }
      if (faults.nvVerifyError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_VERIFY_FAILED, safeParams))
      }
      runtime.mode = mode
      config.mode = mode
      config.configRevision += 1
      config.updatedAt = now()
      config.lastConfigRequestId = requestId
      config.lastConfigSignature = signatureOf(action, safeParams)
      config.configStatus = 'ok'
      persistConfig()
      const result = {
        status: 'applied',
        saved: true,
        configRevision: config.configRevision,
        params: { mode: mode },
        device: { mode: runtime.mode, fan: runtime.fan ? 'on' : 'off' }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, latencyMs + 120)
    }

    if (action === 'set_thresholds') {
      const lower = safeParams.lower
      const upper = safeParams.upper
      if (!isInt(lower) || !isInt(upper)) {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_PAYLOAD, safeParams))
      }
      if (lower < 0 || upper > 100 || lower >= upper) {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_THRESHOLD_RANGE, safeParams))
      }
      if (revisionError) {
        return finish(requestId, action, reject(requestId, action, revisionError, safeParams))
      }
      if (faults.nvWriteError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_WRITE_FAILED, safeParams))
      }
      if (faults.nvVerifyError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_VERIFY_FAILED, safeParams))
      }
      const unchanged = config.humidityLower === lower && config.humidityUpper === upper
      if (!unchanged) {
        config.humidityLower = lower
        config.humidityUpper = upper
        if (safeParams.sensorKind === 'air_rh' || safeParams.sensorKind === 'soil_relative') {
          config.sensorKind = safeParams.sensorKind
        }
        config.configRevision += 1
        config.updatedAt = now()
        config.lastConfigRequestId = requestId
        config.lastConfigSignature = signatureOf(action, safeParams)
        config.configStatus = 'ok'
        persistConfig()
      }
      const result = {
        status: 'applied',
        saved: true,
        unchanged: unchanged,
        configRevision: config.configRevision,
        params: { lower: config.humidityLower, upper: config.humidityUpper },
        device: { mode: runtime.mode, fan: runtime.fan ? 'on' : 'off' }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, latencyMs + 180)
    }

    if (action === 'set_security_config') {
      const trip = safeParams.flameTrip
      const clear = safeParams.flameClear
      if (!isInt(trip) || !isInt(clear) || trip < 0 || trip > 4095 || clear < 0 || clear > 4095) {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_PAYLOAD, safeParams))
      }
      if (trip <= clear) {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_THRESHOLD_RANGE, safeParams))
      }
      if (revisionError) {
        return finish(requestId, action, reject(requestId, action, revisionError, safeParams))
      }
      if (faults.nvWriteError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_WRITE_FAILED, safeParams))
      }
      if (faults.nvVerifyError) {
        config.configStatus = 'write_failed'
        return finish(requestId, action, reject(requestId, action, CODES.NV_VERIFY_FAILED, safeParams))
      }
      config.flameTrip = trip
      config.flameClear = clear
      config.alarmEnabled = safeParams.alarmEnabled !== false
      config.configRevision += 1
      config.updatedAt = now()
      config.lastConfigRequestId = requestId
      config.lastConfigSignature = signatureOf(action, safeParams)
      persistConfig()
      const result = {
        status: 'applied',
        saved: true,
        configRevision: config.configRevision,
        params: { flameTrip: trip, flameClear: clear, alarmEnabled: config.alarmEnabled }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, latencyMs + 180)
    }

    if (action === 'acknowledge_alarm') {
      if (runtime.alarm.status === 'active') {
        return finish(requestId, action, reject(requestId, action, CODES.ALARM_LOCKED, safeParams))
      }
      if (runtime.alarm.status === 'clearing') {
        runtime.alarm.status = 'normal'
        runtime.alarm.id = null
        runtime.alarm.since = null
      }
      const result = {
        status: 'applied',
        saved: false,
        configRevision: config.configRevision,
        params: {},
        device: { alarm: runtime.alarm.status, fan: runtime.fan ? 'on' : 'off' }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, latencyMs)
    }

    if (action === 'mock_alarm') {
      const status = safeParams.status
      if (status !== 'active' && status !== 'clearing' && status !== 'normal') {
        return finish(requestId, action, reject(requestId, action, CODES.INVALID_PAYLOAD, safeParams))
      }
      runtime.alarm.status = status
      runtime.alarm.id = status === 'normal' ? null : 'alarm-' + now().toString(36)
      runtime.alarm.since = status === 'normal' ? null : now()
      if (status === 'active') setFan(false)
      const result = {
        status: 'applied',
        saved: false,
        configRevision: config.configRevision,
        params: { status: status },
        device: { alarm: status, fan: runtime.fan ? 'on' : 'off' }
      }
      recordCommand(requestId, action, safeParams, result)
      return finish(requestId, action, result, 80)
    }

    return finish(requestId, action, reject(requestId, action, CODES.UNSUPPORTED_CAPABILITY, safeParams))
  }

  function getState() {
    updateSample()
    return Promise.resolve(snapshot())
  }

  function health() {
    return Promise.resolve({
      ok: !faults.offline,
      provider: 'mock',
      version: 'mock-0.1.0',
      deviceId: deviceId,
      bootId: bootId,
      uptimeMs: now() - bootAt,
      serverTime: now()
    })
  }

  function setFaults(patch) {
    Object.assign(faults, patch || {})
    return clone(faults)
  }

  function getFaults() {
    return clone(faults)
  }

  function reset() {
    config = Object.assign({}, DEFAULT_CONFIG)
    commandLog = Object.create(null)
    runtime.mode = 'manual'
    runtime.fan = false
    runtime.motor = 'stopped'
    runtime.alarm = { status: 'normal', id: null, since: null, muted: false }
    runtime.quality = 'ok'
    runtime.humidity = 46.2
    persistConfig()
    return health()
  }

  return {
    getState: getState,
    sendCommand: sendCommand,
    health: health,
    setFaults: setFaults,
    getFaults: getFaults,
    reset: reset,
    getConfig: function () {
      return clone(config)
    },
    getBootId: function () {
      return bootId
    },
    CODES: CODES,
    CAPABILITIES: clone(CAPABILITIES)
  }
}

module.exports = {
  CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG,
  CAPABILITIES,
  CODES,
  createMockDevice,
  createMemoryStorage
}
