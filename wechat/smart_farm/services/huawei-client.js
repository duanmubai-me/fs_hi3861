// 华为云 HTTPS 协议核心，由本仓库 gateway/src/providers/huawei.js 移植。
// 不使用 Node API；小程序通过依赖注入 wx.request 适配器调用。

const PROVIDER = 'huawei'
const VERSION = 'huawei-0.1.0'
const COMMAND_SERVICE_ID = 'control'
const DEFAULT_TIMEOUT_MS = 8000
const TOKEN_SKEW_MS = 60 * 1000
const TOKEN_FALLBACK_TTL_MS = 10 * 60 * 1000
const MAX_UPSTREAM_DETAIL = 200

const REQUIRED_FIELDS = [
  'iotdaEndpoint',
  'projectId',
  'iamEndpoint',
  'iamDomain',
  'iamUserName',
  'iamPassword'
]

// 属性名容错：比较时忽略大小写、下划线、连字符和空格，
// 因此 humi_down / humiDown / HIMI_DOWN 都等价。顺序即优先级。
const KEYS = {
  humidity: ['humidity', 'humi', 'humidityValue', 'airHumidity', 'soilHumidity', 'rh'],
  temperature: ['temperature', 'temp', 'temperatureValue', 'airTemperature'],
  sensorKind: ['sensorKind', 'sensorType'],
  fan: ['fan', 'fanStatus', 'fanState', 'fanSwitch'],
  motor: ['motor', 'motorStatus', 'motorState', 'motorDirection'],
  autoMode: ['autoMode', 'mode', 'workMode'],
  humidityLower: ['humiDown', 'humidityLower', 'humiLower', 'lower'],
  humidityUpper: ['humiUp', 'humidityUpper', 'humiUpper', 'upper'],
  flameTrip: ['flameTrip', 'flameThreshold'],
  flameClear: ['flameClear', 'flameClearThreshold'],
  alarmEnabled: ['alarmEnabled'],
  configRevision: ['configRevision', 'cfgRevision', 'revision'],
  configStatus: ['configStatus'],
  updatedAt: ['updatedAt', 'configUpdatedAt'],
  eco2: ['eco2', 'co2', 'equivalentCo2'],
  tvoc: ['tvoc', 'voc'],
  sgpValid: ['sgpValid'],
  gasValid: ['gasValid'],
  flameValid: ['flameValid'],
  flameDetected: ['flameDetected'],
  combustible: ['combustibleRaw', 'combustible', 'gasRaw'],
  flameRaw: ['flameRaw', 'flame', 'flameValue', 'flameAdc'],
  alarmStatus: ['alarmStatus', 'alarmState', 'alarm'],
  alarmId: ['alarmId'],
  alarmSince: ['alarmSince', 'alarmStart'],
  alarmMuted: ['alarmMuted', 'muted'],
  sampledAt: ['sampledAt', 'sampleTime', 'timestamp', 'ts'],
  bootId: ['bootId'],
  seq: ['seq', 'sequence', 'packetSeq'],
  uptimeMs: ['uptimeMs', 'uptime'],
  board: ['board', 'boardName', 'boardModel'],
  firmware: ['firmware', 'firmwareVersion', 'fwVersion', 'swVersion'],
  supportsMotorReverse: ['supportsMotorReverse', 'motorReverseSupported'],
  flameAvailable: ['flameAvailable', 'flameSupported'],
  calibratedCombustible: ['calibratedCombustible'],
  capabilities: ['capabilities']
}

const ACTION_SPECS = {
  set_fan: { command: 'fan', build: buildFanParas },
  set_mode: { command: 'autoMode', build: buildModeParas },
  set_thresholds: { command: 'humidity', build: buildThresholdsParas },
  set_security_config: { command: 'securityConfig', build: buildSecurityParas },
  acknowledge_alarm: { command: 'acknowledgeAlarm', build: buildAcknowledgeParas }
}

function createError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function readString(input, key) {
  const value = input[key]
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '')
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  return 'https://' + text
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

function toInteger(value) {
  const number = toFiniteNumber(value)
  return number !== null && Number.isInteger(number) ? number : null
}

function strictBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on', 'enable', 'enabled'].indexOf(text) >= 0) return true
    if (['false', '0', 'no', 'off', 'disable', 'disabled'].indexOf(text) >= 0) return false
  }
  return null
}

// 开关类属性比 strictBoolean 多接受 open/close/auto/manual 等设备常见写法。
function parseSwitch(value) {
  const bool = strictBoolean(value)
  if (bool !== null) return bool
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['open', 'opened', 'auto'].indexOf(text) >= 0) return true
    if (['close', 'closed', 'manual'].indexOf(text) >= 0) return false
  }
  return null
}

function normalizeOnOff(value) {
  const bool = parseSwitch(value)
  if (bool === null) return null
  return bool ? 'on' : 'off'
}

function normalizeUpperOnOff(value) {
  const bool = parseSwitch(value)
  if (bool === null) return null
  return bool ? 'ON' : 'OFF'
}

function normalizeMode(value) {
  const bool = parseSwitch(value)
  if (bool === null) return null
  return bool ? 'auto' : 'manual'
}

function normalizeSensorKind(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (['air_rh', 'airrh', 'air-rh', 'air', 'rh'].indexOf(text) >= 0) return 'air_rh'
  if (['soil_relative', 'soilrelative', 'soil-relative', 'soil'].indexOf(text) >= 0) return 'soil_relative'
  return null
}

function normalizeMotor(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (value === 0) return 'stopped'
    if (value === 1) return 'forward'
    if (value === 2) return 'reverse'
    return null
  }
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (['stopped', 'stop', 'idle', '0'].indexOf(text) >= 0) return 'stopped'
  if (['forward', 'fwd', 'cw', '1'].indexOf(text) >= 0) return 'forward'
  if (['reverse', 'rev', 'back', 'ccw', '2'].indexOf(text) >= 0) return 'reverse'
  return null
}

function normalizeAlarmStatus(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (['normal', 'ok', 'idle'].indexOf(text) >= 0) return 'normal'
  if (['suspected', 'warning', 'warn'].indexOf(text) >= 0) return 'suspected'
  if (['active', 'alarm', 'alert', 'firing'].indexOf(text) >= 0) return 'active'
  if (['clearing', 'clear', 'recovering'].indexOf(text) >= 0) return 'clearing'
  return null
}

function stringOrNull(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? text : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

// 兼容 IoTDA 的 20240101T120000Z 与标准 ISO/RFC3339 时间。
function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  if (compact) {
    return Date.UTC(
      Number(compact[1]),
      Number(compact[2]) - 1,
      Number(compact[3]),
      Number(compact[4]),
      Number(compact[5]),
      Number(compact[6])
    )
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text || (text.charAt(0) !== '{' && text.charAt(0) !== '[')) return value
  try {
    return JSON.parse(text)
  } catch (err) {
    return value
  }
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// 把 properties 摊平成“归一化键 -> 值”。顶层属性优先于嵌套对象里的同名属性，
// 这样既支持扁平上报，也支持 { sensor: { humidity }, config: { ... } } 的形状。
function buildPropertyIndex(properties) {
  const index = Object.create(null)
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return
    Object.keys(value).forEach(function (key) {
      const normalized = normalizeKey(key)
      if (normalized && !(normalized in index)) index[normalized] = value[key]
      if (depth < 2) visit(value[key], depth + 1)
    })
  }
  visit(properties, 0)
  return index
}

function propertyHas(index, names) {
  for (let i = 0; i < names.length; i += 1) {
    if (normalizeKey(names[i]) in index) return true
  }
  return false
}

function propertyGet(index, names) {
  for (let i = 0; i < names.length; i += 1) {
    const key = normalizeKey(names[i])
    if (key in index) return index[key]
  }
  return undefined
}

function firstFromObject(object, names) {
  if (!object || typeof object !== 'object') return undefined
  return propertyGet(buildPropertyIndex(object), names)
}

function firstBoolean() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (typeof arguments[i] === 'boolean') return arguments[i]
  }
  return null
}

function assignNumber(target, key, value) {
  if (value !== null) target[key] = value
  return target
}

// 属性存在与否决定能力位；如果设备/固件显式声明了 boolean，则以声明为准。
function capabilityAvailability(declared, present) {
  if (typeof declared === 'boolean') return declared
  return present
}

function readHuaweiSection(config, deps) {
  if (deps && deps.huaweiConfig !== undefined) return deps.huaweiConfig
  if (deps && deps.huawei !== undefined) return deps.huawei
  if (config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'huawei')) {
    return config.huawei
  }
  // 允许 createHuaweiProvider(huaweiSection) 这种直接用 huawei 段调用的写法。
  if (config && typeof config === 'object' &&
      (config.iotdaEndpoint !== undefined || config.iamEndpoint !== undefined)) {
    return config
  }
  return null
}

function normalizeHuaweiConfig(section, gatewayConfig) {
  const input = section && typeof section === 'object' && !Array.isArray(section) ? section : {}
  const missing = []

  const iotdaEndpoint = normalizeBaseUrl(readString(input, 'iotdaEndpoint'))
  if (!iotdaEndpoint) missing.push('iotdaEndpoint')

  const projectId = readString(input, 'projectId')
  if (!projectId) missing.push('projectId')

  const iamEndpoint = normalizeBaseUrl(readString(input, 'iamEndpoint'))
  if (!iamEndpoint) missing.push('iamEndpoint')

  const iamDomain = readString(input, 'iamDomain')
  if (!iamDomain) missing.push('iamDomain')

  const iamUserName = readString(input, 'iamUserName')
  if (!iamUserName) missing.push('iamUserName')

  // 密码不做 trim 后使用（保留首尾可能存在的空格），只检查是否为空。
  const iamPassword = typeof input.iamPassword === 'string' ? input.iamPassword : ''
  if (!iamPassword.trim()) missing.push('iamPassword')

  const gatewayDeviceId = gatewayConfig && typeof gatewayConfig.deviceId === 'string'
    ? gatewayConfig.deviceId.trim()
    : ''
  const deviceId = readString(input, 'deviceId') || gatewayDeviceId
  if (!deviceId) missing.push('deviceId')

  const projectName = readString(input, 'projectName') || readString(input, 'iamProjectName')
  const verifyTls = input.verifyTls !== false

  const configuredTimeout = toFiniteNumber(
    input.requestTimeoutMs !== undefined ? input.requestTimeoutMs : input.timeoutMs
  )
  const gatewayTimeout = toFiniteNumber(gatewayConfig && gatewayConfig.commandTimeoutMs)
  const timeoutMs = configuredTimeout !== null && configuredTimeout > 0
    ? Math.floor(configuredTimeout)
    : (gatewayTimeout !== null && gatewayTimeout > 0 ? Math.floor(gatewayTimeout) : DEFAULT_TIMEOUT_MS)

  return {
    configured: missing.length === 0,
    missing: missing,
    iotdaBase: iotdaEndpoint,
    iamBase: iamEndpoint,
    projectId: projectId,
    projectName: projectName,
    iamDomain: iamDomain,
    iamUserName: iamUserName,
    iamPassword: iamPassword,
    deviceId: deviceId,
    verifyTls: verifyTls,
    timeoutMs: timeoutMs
  }
}

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value === null || value === undefined ? null : String(value)
  }
  if (typeof headers !== 'object') return null
  const wanted = String(name).toLowerCase()
  const keys = Object.keys(headers)
  for (let i = 0; i < keys.length; i += 1) {
    if (String(keys[i]).toLowerCase() === wanted) return String(headers[keys[i]])
  }
  return null
}

async function readResponseJson(response) {
  if (!response) return null
  if (typeof response.text === 'function') {
    let text = ''
    try {
      text = await response.text()
    } catch (err) {
      return null
    }
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (err) {
      return text
    }
  }
  if (typeof response.json === 'function') {
    try {
      return await response.json()
    } catch (err) {
      return null
    }
  }
  return null
}

function describeUpstreamError(payload) {
  if (!payload) return ''
  let code = null
  let message = null
  if (typeof payload === 'string') {
    return payload.slice(0, MAX_UPSTREAM_DETAIL)
  }
  if (typeof payload === 'object') {
    const error = payload.error && typeof payload.error === 'object' ? payload.error : null
    code = payload.error_code || payload.errorCode || payload.code ||
      (error && (error.code || error.error_code)) || null
    message = payload.error_msg || payload.errorMessage || payload.message ||
      payload.error_description || (error && (error.message || error.error_msg)) || null
  }
  const parts = []
  if (code) parts.push(String(code))
  if (message) parts.push(String(message))
  return parts.join(' ').slice(0, MAX_UPSTREAM_DETAIL)
}

function mapHttpError(status, payload, operation, context) {
  const detail = describeUpstreamError(payload)
  const suffix = detail ? '：' + detail : ''
  const label = operation || '华为云请求'
  if (status === 401) {
    return createError('PROVIDER_UNAVAILABLE', label + '鉴权失败（401，已尝试刷新 token）' + suffix)
  }
  if (status === 403) {
    return createError('PROVIDER_UNAVAILABLE', label + '被拒绝（403，请检查 IAM 用户权限与 IoTDA 授权）' + suffix)
  }
  if (status === 404) {
    const code = context && context.notFoundCode ? context.notFoundCode : 'PROVIDER_UNAVAILABLE'
    return createError(code, label + '失败（404 资源不存在）' + suffix)
  }
  if (status === 429) {
    return createError('BUSY', label + '触发平台限流（429），请稍后重试' + suffix)
  }
  if (status >= 500) {
    return createError('PROVIDER_UNAVAILABLE', label + '平台服务异常（' + status + '）' + suffix)
  }
  return createError('PROVIDER_UNAVAILABLE', label + '失败（' + status + '）' + suffix)
}

function isControlService(service) {
  if (!service || typeof service !== 'object') return false
  const id = service.service_id || service.serviceId
  return typeof id === 'string' && id.trim().toLowerCase() === 'control'
}

// 解析设备影子，返回 { properties, eventTime }；没有 reported 时返回 null。
// 兼容 shadow 为数组/对象、properties 为 JSON 字符串、reported 直接平铺等形状。
function extractReportedShadow(payload) {
  if (!payload || typeof payload !== 'object') return null
  let services = null
  if (Array.isArray(payload)) {
    services = payload.slice()
  } else if (Array.isArray(payload.shadow)) {
    services = payload.shadow.slice()
  } else if (payload.shadow && typeof payload.shadow === 'object') {
    services = [payload.shadow]
  } else if (payload.reported) {
    services = [payload]
  } else {
    return null
  }
  if (services.length === 0) return null

  // control 服务最后合并，多服务同名属性时 control 优先。
  services.sort(function (a, b) {
    return (isControlService(a) ? 1 : 0) - (isControlService(b) ? 1 : 0)
  })

  const merged = {}
  let found = false
  let eventTime = null
  services.forEach(function (service) {
    if (!service || typeof service !== 'object') return
    const reported = service.reported
    if (!reported || typeof reported !== 'object') return

    let properties = reported.properties
    if (properties === undefined) {
      properties = {}
      Object.keys(reported).forEach(function (key) {
        if (normalizeKey(key) === 'eventtime') return
        properties[key] = reported[key]
      })
    }
    properties = parseMaybeJson(properties)
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return

    found = true
    Object.assign(merged, properties)
    if (!eventTime) {
      eventTime = parseTime(reported.event_time || reported.eventTime || service.event_time)
    }
  })

  return found ? { properties: merged, eventTime: eventTime } : null
}

function resolveOnline(device) {
  if (!device || typeof device !== 'object') return false
  if (typeof device.online === 'boolean') return device.online
  const status = device.status !== undefined ? device.status : device.deviceStatus
  if (typeof status === 'boolean') return status
  if (typeof status === 'string') return status.trim().toUpperCase() === 'ONLINE'
  return false
}

function unwrapDevice(payload) {
  if (payload && typeof payload === 'object' && payload.device &&
      typeof payload.device === 'object' && !Array.isArray(payload.device)) {
    return payload.device
  }
  return payload && typeof payload === 'object' ? payload : {}
}

/**
 * 把 IoTDA 设备详情 + 影子归一化为 contract.md §2.1 的 RawState。
 * 离线/影子缺失时仍然返回完整 RawState：online=false、sensor.quality=error，
 * 数值字段保持 null 或省略，绝不补 0。
 */
function buildRawState(device, shadowPayload, config, now) {
  const info = device || {}
  const online = resolveOnline(info)
  const shadow = extractReportedShadow(shadowPayload)
  const properties = shadow ? shadow.properties : null
  const hasShadow = !!shadow
  const index = buildPropertyIndex(properties || {})
  const get = function (names) {
    return propertyGet(index, names)
  }
  const has = function (names) {
    return propertyHas(index, names)
  }

  const reportedCapabilities = parseMaybeJson(get(KEYS.capabilities))
  const caps = reportedCapabilities && typeof reportedCapabilities === 'object' &&
    !Array.isArray(reportedCapabilities)
    ? reportedCapabilities
    : {}

  const sensorKind = normalizeSensorKind(get(KEYS.sensorKind))
  const humidity = toFiniteNumber(get(KEYS.humidity))
  const temperature = toFiniteNumber(get(KEYS.temperature))
  const sensorReported = humidity !== null || temperature !== null
  let sensorQuality = 'ok'
  if (!online) sensorQuality = 'error'
  else if (!hasShadow) sensorQuality = 'error'
  else if (!sensorReported) sensorQuality = 'not_configured'

  const sampledAt = parseTime(get(KEYS.sampledAt)) || (shadow ? shadow.eventTime : null)

  const configState = { sensorKind: sensorKind }
  assignNumber(configState, 'humidityLower', toInteger(get(KEYS.humidityLower)))
  assignNumber(configState, 'humidityUpper', toInteger(get(KEYS.humidityUpper)))
  assignNumber(configState, 'flameTrip', toInteger(get(KEYS.flameTrip)))
  assignNumber(configState, 'flameClear', toInteger(get(KEYS.flameClear)))
  const alarmEnabled = strictBoolean(get(KEYS.alarmEnabled))
  if (alarmEnabled !== null) configState.alarmEnabled = alarmEnabled
  configState.configRevision = toInteger(get(KEYS.configRevision))
  configState.configStatus = stringOrNull(get(KEYS.configStatus)) || 'ok'
  configState.updatedAt = parseTime(get(KEYS.updatedAt))

  const fan = normalizeOnOff(get(KEYS.fan))
  const motor = normalizeMotor(get(KEYS.motor))
  const mode = normalizeMode(get(KEYS.autoMode))

  // 报警也兼容设备把 alarm 作为对象上报：{ alarm: { status, id, since, muted } }。
  const alarmValue = parseMaybeJson(get(['alarm']))
  const alarmObject = alarmValue && typeof alarmValue === 'object' && !Array.isArray(alarmValue)
    ? alarmValue
    : null
  const alarmStatus = normalizeAlarmStatus(get(KEYS.alarmStatus)) ||
    normalizeAlarmStatus(alarmObject && alarmObject.status) || 'normal'
  const alarmId = stringOrNull(get(KEYS.alarmId)) || stringOrNull(alarmObject && alarmObject.id)
  const alarmSince = parseTime(get(KEYS.alarmSince)) || parseTime(alarmObject && alarmObject.since)
  const alarmMutedRaw = strictBoolean(get(KEYS.alarmMuted))
  const alarmMuted = alarmMutedRaw !== null
    ? alarmMutedRaw
    : strictBoolean(alarmObject && alarmObject.muted)
  const alarm = {
    status: alarmStatus,
    id: alarmId,
    since: alarmSince,
    muted: alarmMuted === null ? false : alarmMuted
  }

  const sgpValid = strictBoolean(get(KEYS.sgpValid))
  const gasValid = strictBoolean(get(KEYS.gasValid))
  const eco2 = sgpValid === false ? null : toFiniteNumber(get(KEYS.eco2))
  const tvoc = sgpValid === false ? null : toFiniteNumber(get(KEYS.tvoc))
  const combustibleRaw = gasValid === false ? null : toFiniteNumber(get(KEYS.combustible))
  const gasReported = has(KEYS.eco2) || has(KEYS.tvoc) || has(KEYS.combustible)
  const gas = {
    eco2: eco2,
    tvoc: tvoc,
    combustibleRaw: combustibleRaw,
    quality: gasReported || has(KEYS.sgpValid) || has(KEYS.gasValid)
      ? (online && hasShadow && sgpValid !== false && gasValid !== false ? 'ok' : 'error') : 'not_configured'
  }

  const flameReported = has(KEYS.flameRaw)
  const flameValid = strictBoolean(get(KEYS.flameValid))
  const flameDetected = flameValid === false ? null : strictBoolean(get(KEYS.flameDetected))
  const flameRaw = flameReported && flameValid !== false ? toFiniteNumber(get(KEYS.flameRaw)) : null
  const flameQuality = online && flameValid !== false ? 'ok' : 'error'

  const reportedGas = caps.gas && typeof caps.gas === 'object' ? caps.gas : {}
  const gasEco2 = capabilityAvailability(reportedGas.eco2, has(KEYS.eco2) || has(KEYS.sgpValid))
  const gasTvoc = capabilityAvailability(reportedGas.tvoc, has(KEYS.tvoc) || has(KEYS.sgpValid))
  const gasCombustible = capabilityAvailability(reportedGas.combustible, has(KEYS.combustible) || has(KEYS.gasValid))

  const reportedFlame = caps.flame && typeof caps.flame === 'object' ? caps.flame : {}
  const declaredFlameAvailable = reportedFlame.available !== undefined
    ? reportedFlame.available
    : strictBoolean(get(KEYS.flameAvailable))
  const flameAvailable = capabilityAvailability(declaredFlameAvailable, flameReported || has(KEYS.flameDetected) || has(KEYS.flameValid))
  const rawRangeReported = Array.isArray(reportedFlame.rawRange) ? reportedFlame.rawRange : null
  const rawRange = rawRangeReported && rawRangeReported.length === 2
    ? rawRangeReported.map(function (item) {
      const number = toFiniteNumber(item)
      return number === null ? 0 : number
    })
    : [0, 4095]
  const direction = reportedFlame.direction === 'down' ? 'down' : 'up'

  const reportedMotorReverse = typeof caps.supportsMotorReverse === 'boolean'
    ? caps.supportsMotorReverse
    : null
  const declaredMotorReverse = firstBoolean(reportedMotorReverse, strictBoolean(get(KEYS.supportsMotorReverse)))
  const supportsMotorReverse = declaredMotorReverse === null ? motor !== null : declaredMotorReverse

  const reportedCalibrated = caps.calibrated && typeof caps.calibrated === 'object' ? caps.calibrated : {}
  const calibratedCombustible = firstBoolean(
    reportedCalibrated.combustible,
    strictBoolean(get(KEYS.calibratedCombustible))
  ) === true

  const board = stringOrNull(get(KEYS.board)) || stringOrNull(caps.board)
  const firmware = stringOrNull(get(KEYS.firmware)) || stringOrNull(caps.firmware)

  return {
    deviceId: config.deviceId,
    online: online,
    bootId: stringOrNull(get(KEYS.bootId)),
    seq: toInteger(get(KEYS.seq)),
    uptimeMs: toFiniteNumber(get(KEYS.uptimeMs)),
    sensor: {
      kind: sensorKind,
      humidity: humidity,
      temperature: temperature,
      quality: sensorQuality,
      sampledAt: sampledAt
    },
    actuators: {
      fan: fan === null ? 'off' : fan,
      motor: motor
    },
    mode: mode === null ? 'manual' : mode,
    alarm: alarm,
    config: configState,
    gas: gas,
    flame: {
      raw: flameRaw,
      detected: flameDetected,
      digital: !flameReported && (has(KEYS.flameDetected) || has(KEYS.flameValid)),
      quality: flameQuality
    },
    capabilities: {
      board: board,
      firmware: firmware,
      supportsMotorReverse: supportsMotorReverse,
      gas: {
        eco2: gasEco2,
        tvoc: gasTvoc,
        combustible: gasCombustible
      },
      flame: {
        available: flameAvailable,
        rawRange: rawRange,
        direction: direction
      },
      calibrated: {
        combustible: calibratedCombustible
      }
    },
    receivedAt: now()
  }
}

function buildFanParas(params) {
  const value = params && params.value
  if (value !== 'ON' && value !== 'OFF') {
    return { errorCode: 'INVALID_PAYLOAD', message: 'set_fan.value 必须是 ON 或 OFF' }
  }
  return { paras: { value: value } }
}

function buildModeParas(params) {
  const mode = params && params.mode
  if (mode !== 'auto' && mode !== 'manual') {
    return { errorCode: 'INVALID_PAYLOAD', message: 'set_mode.mode 必须是 auto 或 manual' }
  }
  return { paras: { value: mode === 'auto' ? 'ON' : 'OFF' } }
}

function buildThresholdsParas(params) {
  const lower = toInteger(params && params.lower)
  const upper = toInteger(params && params.upper)
  if (lower === null || upper === null || lower < 0 || upper > 100 || lower >= upper) {
    return { errorCode: 'INVALID_THRESHOLD_RANGE', message: '湿度阈值必须是 0–100 的整数，且 lower < upper' }
  }
  return { paras: { up: upper, down: lower } }
}

function buildSecurityParas(params) {
  const trip = toInteger(params && params.flameTrip)
  const clear = toInteger(params && params.flameClear)
  if (trip === null || clear === null || trip < 0 || trip > 4095 || clear < 0 || clear > 4095) {
    return { errorCode: 'INVALID_THRESHOLD_RANGE', message: '火焰阈值必须是 0–4095 的整数' }
  }
  if (trip <= clear) {
    return { errorCode: 'INVALID_THRESHOLD_RANGE', message: '火焰触发阈值必须大于解除阈值' }
  }
  if (params.alarmEnabled !== undefined && typeof params.alarmEnabled !== 'boolean') {
    return { errorCode: 'INVALID_PAYLOAD', message: 'alarmEnabled 必须是布尔值' }
  }
  return {
    paras: {
      flameTrip: trip,
      flameClear: clear,
      alarmEnabled: params.alarmEnabled !== false
    }
  }
}

function buildAcknowledgeParas() {
  return { paras: {} }
}

function makeResult(action, meta, fields) {
  const status = fields.status || 'rejected'
  return Object.assign({
    requestId: meta && meta.requestId ? meta.requestId : null,
    action: action,
    status: status,
    errorCode: null,
    message: '',
    saved: false,
    configRevision: null,
    params: {},
    appliedAt: null
  }, fields)
}

function rejectedResult(action, meta, params, errorCode, message, extra) {
  return makeResult(action, meta, Object.assign({
    status: 'rejected',
    errorCode: errorCode,
    message: message,
    saved: false,
    configRevision: null,
    params: clone(params || {}),
    appliedAt: null
  }, extra || {}))
}

function parseCommandResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    return { commandId: null, response: null, resultCode: null, paras: {}, responseName: null }
  }
  const commandId = stringOrNull(
    payload.command_id !== undefined
      ? payload.command_id
      : (payload.commandId !== undefined ? payload.commandId : payload.id)
  )
  let response = payload.response
  if (typeof response === 'string') response = parseMaybeJson(response)
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { commandId: commandId, response: null, resultCode: null, paras: {}, responseName: null }
  }
  const resultCode = toInteger(firstFromObject(response, ['result_code', 'resultCode']))
  const rawParas = firstFromObject(response, ['paras', 'parameters'])
  const parsedParas = parseMaybeJson(rawParas)
  const paras = parsedParas && typeof parsedParas === 'object' && !Array.isArray(parsedParas)
    ? parsedParas
    : {}
  return {
    commandId: commandId,
    response: response,
    resultCode: resultCode,
    paras: paras,
    responseName: stringOrNull(firstFromObject(response, ['response_name', 'responseName']))
  }
}

function mapResultParams(action, requested, paras) {
  const safeRequested = requested || {}
  const safeParas = paras && typeof paras === 'object' ? paras : {}
  if (action === 'set_fan') {
    const value = normalizeUpperOnOff(firstFromObject(safeParas, ['value', 'fan', 'fanStatus']))
    return { value: value === null ? safeRequested.value : value }
  }
  if (action === 'set_mode') {
    const mode = normalizeMode(firstFromObject(safeParas, ['value', 'mode', 'autoMode']))
    return { mode: mode === null ? safeRequested.mode : mode }
  }
  if (action === 'set_thresholds') {
    const lower = toInteger(firstFromObject(safeParas, ['lower', 'down', 'humiDown']))
    const upper = toInteger(firstFromObject(safeParas, ['upper', 'up', 'humiUp']))
    return {
      lower: lower === null ? safeRequested.lower : lower,
      upper: upper === null ? safeRequested.upper : upper
    }
  }
  if (action === 'set_security_config') {
    const trip = toInteger(firstFromObject(safeParas, ['flameTrip', 'trip']))
    const clear = toInteger(firstFromObject(safeParas, ['flameClear', 'clear']))
    const enabled = strictBoolean(firstFromObject(safeParas, ['alarmEnabled']))
    return {
      flameTrip: trip === null ? safeRequested.flameTrip : trip,
      flameClear: clear === null ? safeRequested.flameClear : clear,
      alarmEnabled: enabled === null ? safeRequested.alarmEnabled !== false : enabled
    }
  }
  return {}
}

// 只有设备回执显式 saved=true 才确认落盘。
// result_code=0、configRevision 或阈值回显都不单独证明 Flash 写入成功。
function resolveSaved(action, paras) {
  const safeParas = paras && typeof paras === 'object' ? paras : {}
  const explicit = strictBoolean(firstFromObject(safeParas, ['saved']))
  if (explicit !== null) return explicit
  // 仅显式 saved=true 能确认落盘；阈值回显或 revision 不等于 Flash 写成功。
  return false
}

function mapCommandResponse(action, meta, requestedParas, payload) {
  const parsed = parseCommandResponse(payload)
  const finalParams = mapResultParams(action, requestedParas, parsed.paras)
  const platformInfo = {
    platformCommandId: parsed.commandId,
    platformResultCode: parsed.resultCode
  }

  if (!parsed.response) {
    return makeResult(action, meta, Object.assign({
      status: 'unknown',
      errorCode: 'TIMEOUT',
      message: 'IoTDA 未返回设备命令响应（设备可能离线或响应超时），结果未知，请先刷新状态核对',
      saved: false,
      configRevision: null,
      params: finalParams,
      appliedAt: null
    }, platformInfo))
  }

  if (parsed.resultCode === null) {
    return rejectedResult(action, meta, finalParams, 'HARDWARE_ERROR',
      '设备命令响应缺少 result_code，无法判定执行结果', platformInfo)
  }

  if (parsed.resultCode !== 0) {
    const upstreamCode = stringOrNull(firstFromObject(parsed.paras, ['errorCode', 'code']))
    const upstreamMessage = stringOrNull(firstFromObject(parsed.paras, ['message', 'errorMessage', 'msg']))
    let message = '设备拒绝命令（result_code=' + parsed.resultCode + '）'
    if (upstreamMessage) message += '：' + upstreamMessage
    return rejectedResult(action, meta, finalParams, upstreamCode || 'HARDWARE_ERROR', message, Object.assign({
      platformResponseName: parsed.responseName
    }, platformInfo))
  }

  return makeResult(action, meta, Object.assign({
    status: 'applied',
    errorCode: null,
    message: '',
    saved: resolveSaved(action, parsed.paras),
    configRevision: toInteger(firstFromObject(parsed.paras, KEYS.configRevision)),
    params: finalParams,
    appliedAt: null,
    platformResponseName: parsed.responseName
  }, platformInfo))
}

/**
 * @param {object} config gateway 配置（含 huawei 段），或直接传 huawei 段
 * @param {{fetchImpl?:Function, now?:Function, dispatcher?:object,
 *          huaweiConfig?:object|null, huawei?:object|null}} [deps]
 */
function createHuaweiProvider(config, deps) {
  const opts = deps || {}
  const gatewayConfig = config && typeof config === 'object' ? config : {}
  const cfg = normalizeHuaweiConfig(readHuaweiSection(gatewayConfig, opts), gatewayConfig)
  const fetchImpl = typeof opts.fetchImpl === 'function'
    ? opts.fetchImpl
    : (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function' ? globalThis.fetch : null)
  const nowFn = typeof opts.now === 'function' ? opts.now : function () { return Date.now() }
  const dispatcher = opts.dispatcher || null

  let tokenCache = null
  let tokenPromise = null

  function ensureConfigured(operation) {
    if (!cfg.configured) {
      throw createError('NOT_IMPLEMENTED',
        '华为云 IoTDA provider 未完成应用侧配置，无法执行 ' + operation +
        '；缺少字段：' + cfg.missing.join('、') +
        '。请检查小程序 config/local.js 的 huawei 配置。')
    }
    if (!fetchImpl) {
      throw createError('PROVIDER_UNAVAILABLE', '当前环境没有可用的华为云请求适配器')
    }
  }

  async function httpFetch(url, init, operation) {
    if (!fetchImpl) {
      throw createError('PROVIDER_UNAVAILABLE', '当前环境没有可用的华为云请求适配器')
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer = null
    const requestInit = Object.assign({ method: 'GET' }, init || {})
    if (controller) {
      requestInit.signal = controller.signal
      timer = setTimeout(function () {
        controller.abort()
      }, cfg.timeoutMs)
    }
    if (dispatcher) requestInit.dispatcher = dispatcher

    try {
      return await fetchImpl(url, requestInit)
    } catch (err) {
      const timedOut = controller && controller.signal && controller.signal.aborted
      const label = operation || '华为云请求'
      if (timedOut) {
        throw createError('PROVIDER_UNAVAILABLE', label + '超时（' + cfg.timeoutMs + 'ms），结果未知')
      }
      const reason = err && err.message ? String(err.message).slice(0, MAX_UPSTREAM_DETAIL) : '未知网络错误'
      throw createError('PROVIDER_UNAVAILABLE', label + '网络错误：' + reason)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function parseTokenExpiry(payload) {
    const token = payload && typeof payload === 'object' ? payload.token : null
    return parseTime(token && token.expires_at)
  }

  async function requestToken() {
    const requestBody = {
      auth: {
        identity: {
          methods: ['password'],
          password: {
            user: {
              name: cfg.iamUserName,
              password: cfg.iamPassword,
              domain: { name: cfg.iamDomain }
            }
          }
        },
        scope: {
          project: cfg.projectName ? { name: cfg.projectName } : { id: cfg.projectId }
        }
      }
    }

    const response = await httpFetch(cfg.iamBase + '/v3/auth/tokens?nocatalog=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf8' },
      body: JSON.stringify(requestBody)
    }, 'IAM 鉴权')

    const payload = await readResponseJson(response)
    if (response.status < 200 || response.status >= 300) {
      throw mapHttpError(response.status, payload, 'IAM 鉴权', null)
    }
    const token = getHeader(response.headers, 'x-subject-token')
    if (!token) {
      throw createError('PROVIDER_UNAVAILABLE', 'IAM 鉴权响应缺少 X-Subject-Token 响应头')
    }
    return {
      token: token,
      expiresAt: parseTokenExpiry(payload) || (nowFn() + TOKEN_FALLBACK_TTL_MS)
    }
  }

  function getToken(force) {
    if (!force && tokenCache && tokenCache.expiresAt - TOKEN_SKEW_MS > nowFn()) {
      return Promise.resolve(tokenCache.token)
    }
    if (!force && tokenPromise) return tokenPromise

    const pending = requestToken().then(function (next) {
      if (tokenPromise === pending) {
        tokenCache = next
        tokenPromise = null
      }
      return next.token
    }, function (err) {
      if (tokenPromise === pending) tokenPromise = null
      throw err
    })
    tokenPromise = pending
    return pending
  }

  async function apiRequest(method, path, body, context) {
    const url = cfg.iotdaBase + path
    const requestContext = context || {}
    let token = await getToken(false)
    let refreshed = false

    while (true) {
      const init = {
        method: method,
        headers: {
          'content-type': 'application/json;charset=utf8',
          'x-auth-token': token
        }
      }
      if (body !== undefined) init.body = JSON.stringify(body)

      const response = await httpFetch(url, init, requestContext.operation)
      const payload = await readResponseJson(response)

      if (response.status === 401 && !refreshed) {
        refreshed = true
        // 平台可能已提前吊销 token：先丢弃缓存再强制重新鉴权。
        tokenCache = null
        token = await getToken(true)
        continue
      }
      if (response.status >= 200 && response.status < 300) return payload
      throw mapHttpError(response.status, payload, requestContext.operation, requestContext)
    }
  }

  function deviceApiPath() {
    return '/v5/iot/' + encodeURIComponent(cfg.projectId) +
      '/devices/' + encodeURIComponent(cfg.deviceId)
  }

  async function readShadowConfigRevision() {
    let payload
    try {
      payload = await apiRequest('GET', deviceApiPath() + '/shadow', undefined, {
        operation: '读取设备影子',
        notFoundCode: 'DEVICE_OFFLINE'
      })
    } catch (err) {
      // 影子不存在（404）时无法校验版本，返回 null 交给上层按 REVISION_CONFLICT 处理。
      if (err && err.code === 'DEVICE_OFFLINE') return null
      throw err
    }
    const shadow = extractReportedShadow(payload)
    if (!shadow) return null
    const index = buildPropertyIndex(shadow.properties)
    return toInteger(propertyGet(index, KEYS.configRevision))
  }

  async function getState() {
    ensureConfigured('getState')
    const path = deviceApiPath()
    const devicePayload = await apiRequest('GET', path, undefined, {
      operation: '查询设备详情',
      notFoundCode: 'DEVICE_OFFLINE'
    })

    let shadowPayload = null
    try {
      shadowPayload = await apiRequest('GET', path + '/shadow', undefined, {
        operation: '查询设备影子',
        notFoundCode: 'DEVICE_OFFLINE'
      })
    } catch (err) {
      // 设备存在但影子尚未创建/已过期时，平台可能返回 404；此时仍返回在线状态。
      if (err && err.code === 'DEVICE_OFFLINE') shadowPayload = null
      else throw err
    }

    return buildRawState(unwrapDevice(devicePayload), shadowPayload, cfg, nowFn)
  }

  // applied/rejected 由 provider 盖上本地完成时间；unknown 保持 appliedAt=null。
  // gateway 的 commandStore 看到非 null 值会原样保留，结果因此符合 CommandResult 契约。
  function stampResult(result) {
    if (result && result.status !== 'unknown' && result.appliedAt === null) {
      result.appliedAt = nowFn()
    }
    return result
  }

  async function sendCommand(action, params, meta) {
    ensureConfigured('sendCommand')
    const safeParams = params && typeof params === 'object' && !Array.isArray(params) ? params : {}
    const spec = ACTION_SPECS[action]
    if (!spec) {
      return stampResult(rejectedResult(action, meta, safeParams, 'UNSUPPORTED_CAPABILITY',
        '华为云 provider 不支持动作：' + String(action) + '（支持：' + Object.keys(ACTION_SPECS).join('、') + '）'))
    }

    const built = spec.build(safeParams)
    if (built.errorCode) {
      return stampResult(rejectedResult(action, meta, safeParams, built.errorCode, built.message))
    }

    const expectedRevision = meta ? meta.expectedRevision : undefined
    if (expectedRevision !== undefined && expectedRevision !== null) {
      const currentRevision = await readShadowConfigRevision()
      if (currentRevision === null && !opts.allowLegacyRevision) {
        return stampResult(rejectedResult(action, meta, safeParams, 'REVISION_CONFLICT',
          '设备影子缺少 configRevision，无法校验 expectedRevision=' + expectedRevision + '，命令未下发'))
      }
      // 老师固件没有 revision，允许基础命令兼容；已有 revision 时仍严格校验。
      if (currentRevision !== null && Number(expectedRevision) !== currentRevision) {
        return stampResult(rejectedResult(action, meta, safeParams, 'REVISION_CONFLICT',
          '配置版本冲突：期望 ' + expectedRevision + '，当前 ' + currentRevision + '，命令未下发'))
      }
    }

    const commandBody = {
      service_id: COMMAND_SERVICE_ID,
      command_name: spec.command,
      paras: built.paras
    }
    const payload = await apiRequest('POST', deviceApiPath() + '/commands', commandBody, {
      operation: '下发设备命令',
      notFoundCode: 'DEVICE_OFFLINE'
    })
    return stampResult(mapCommandResponse(action, meta, built.paras, payload))
  }

  function health() {
    if (!cfg.configured) {
      return Promise.resolve({
        ok: false,
        provider: PROVIDER,
        version: VERSION,
        deviceId: cfg.deviceId,
        configured: false,
        missing: cfg.missing.slice(),
        note: '华为云 IoTDA 未配置：缺少应用侧字段 ' + cfg.missing.join('、') +
          '。请复制 config/local.example.json 为 config/local.json 并填写 huawei 段；' +
          'local.json 与其中凭据不要提交。'
      })
    }

    const notes = [
      '华为云 IoTDA 已配置（IAM scope=' + (cfg.projectName ? 'project.name' : 'project.id') +
      '）；health 只做本机配置检查，不探测云端连通性。'
    ]
    if (!cfg.verifyTls) {
      notes.push('verifyTls=false：内置 fetch 默认仍会校验证书；如需真正关闭，请注入 deps.dispatcher ' +
        '（undici Agent）或在本机使用 NODE_TLS_REJECT_UNAUTHORIZED=0 并自行承担风险。')
    }
    if (!fetchImpl) {
      notes.push('当前 Node 运行时没有全局 fetch，设备/命令接口不可用。')
    }

    return Promise.resolve({
      ok: !!fetchImpl,
      provider: PROVIDER,
      version: VERSION,
      deviceId: cfg.deviceId,
      configured: true,
      note: notes.join(' ')
    })
  }

  return {
    provider: PROVIDER,
    implemented: true,
    configured: cfg.configured,
    getState: getState,
    sendCommand: sendCommand,
    health: health
  }
}

module.exports = {
  createHuaweiProvider
}
