// models/state.js
// 设备原始状态 → 页面视图模型（统一单位、文案、过期判断）。
// 页面不直接读取传输层字段名，避免 mock/gateway/云端结构差异散落到 UI。

const units = require('../utils/units')
const time = require('../utils/time')

const QUALITY_TEXT = {
  ok: '正常',
  warming_up: '预热中',
  not_configured: '未配置',
  error: '故障',
  stale: '数据过期'
}

const ALARM_TEXT = {
  normal: '正常',
  suspected: '疑似',
  active: '报警中',
  clearing: '解除确认中'
}

const MODE_TEXT = {
  manual: '手动',
  auto: '自动'
}

const MOTOR_TEXT = {
  stopped: '停止',
  forward: '正转',
  reverse: '反转'
}

const CONFIG_STATUS_TEXT = {
  ok: '已保存',
  defaulted: '默认值',
  incompatible: '版本不兼容',
  write_failed: '保存失败'
}

function textOf(map, key, fallback) {
  return map[key] || fallback || key || '--'
}

function qualityText(quality) {
  return textOf(QUALITY_TEXT, quality, '未知')
}

/**
 * 判断传感器数据是否可参与自动控制/展示为有效值。
 * @param {object} raw
 * @param {boolean} stale
 * @returns {boolean}
 */
function isSensorValid(raw, stale) {
  const sensor = (raw && raw.sensor) || {}
  return sensor.quality === 'ok' && sensor.humidity !== null && sensor.humidity !== undefined && !stale
}

/**
 * @param {object} raw 设备原始状态
 * @param {object} options {now, staleAfterMs, online}
 * @returns {object} 视图模型
 */
function normalizeState(raw, options) {
  const opts = options || {}
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const staleAfterMs = typeof opts.staleAfterMs === 'number' ? opts.staleAfterMs : 90000
  const data = raw || {}

  const sensor = data.sensor || {}
  const actuators = data.actuators || {}
  const alarm = data.alarm || {}
  const config = data.config || {}
  const gas = data.gas || {}
  const flame = data.flame || {}
  const capabilities = data.capabilities || {}

  const receivedAt = data.receivedAt || sensor.sampledAt || null
  const explicitStale = data.stale
  const stale =
    typeof explicitStale === 'boolean'
      ? explicitStale
      : !!receivedAt && time.isStale(receivedAt, staleAfterMs, now)

  const online = opts.online !== undefined ? !!opts.online : data.online !== false
  const sensorKind = sensor.kind || config.sensorKind || 'air_rh'
  const sensorValid = isSensorValid(data, stale)
  const configStatus = config.configStatus || 'ok'

  const humidityValue = sensor.humidity === undefined ? null : sensor.humidity
  const temperatureValue = sensor.temperature === undefined ? null : sensor.temperature
  const alarmStatus = alarm.status || 'normal'

  const gasCapabilities = capabilities.gas || {}
  const gasItems = [
    {
      key: 'eco2',
      label: 'eCO₂',
      available: !!gasCapabilities.eco2,
      value: gas.eco2,
      text: units.formatConcentration(gas.eco2, 'ppm'),
      unit: 'ppm'
    },
    {
      key: 'tvoc',
      label: 'TVOC',
      available: !!gasCapabilities.tvoc,
      value: gas.tvoc,
      text: units.formatConcentration(gas.tvoc, 'ppb'),
      unit: 'ppb'
    },
    {
      key: 'combustible',
      label: '可燃气体',
      available: !!gasCapabilities.combustible,
      value: gas.combustibleRaw,
      text: units.formatRaw(gas.combustibleRaw),
      unit: '原始值'
    }
  ]

  const motor = actuators.motor || 'stopped'

  return {
    deviceId: data.deviceId || '',
    online: online,
    stale: stale,
    // 数据年龄与时间
    receivedAt: receivedAt,
    receivedAtText: time.formatTime(receivedAt),
    ageText: time.formatAge(receivedAt, now),
    bootId: data.bootId || '',
    seq: data.seq || 0,

    // 传感器
    sensorKind: sensorKind,
    sensorKindText: units.sensorKindText(sensorKind),
    sensorValid: sensorValid,
    humidity: {
      value: humidityValue,
      text: units.formatHumidity(humidityValue),
      unit: units.humidityUnit(sensorKind),
      quality: sensor.quality || 'error',
      qualityText: qualityText(sensor.quality || 'error')
    },
    temperature: {
      value: temperatureValue,
      text: units.formatTemperature(temperatureValue),
      unit: '℃',
      available: temperatureValue !== null && temperatureValue !== undefined
    },
    sampledAt: sensor.sampledAt || null,
    sampledAtText: time.formatTime(sensor.sampledAt),

    // 执行器与模式
    fan: {
      on: actuators.fan === 'on' || actuators.fan === true,
      text: actuators.fan === 'on' || actuators.fan === true ? '开' : '关'
    },
    motor: {
      value: motor,
      text: textOf(MOTOR_TEXT, motor, '--'),
      available: !!capabilities.supportsMotorReverse
    },
    mode: {
      value: data.mode || 'manual',
      text: textOf(MODE_TEXT, data.mode, '--'),
      isAuto: data.mode === 'auto'
    },

    // 报警
    alarm: {
      status: alarmStatus,
      active: alarmStatus === 'active',
      text: textOf(ALARM_TEXT, alarmStatus, '--'),
      id: alarm.id || '',
      sinceText: time.formatDateTime(alarm.since),
      canAcknowledge: alarmStatus === 'clearing' || alarmStatus === 'normal',
      muted: !!alarm.muted
    },

    // 配置
    config: {
      sensorKind: sensorKind,
      humidityLower: config.humidityLower,
      humidityUpper: config.humidityUpper,
      lowerText: config.humidityLower === undefined ? '--' : String(config.humidityLower),
      upperText: config.humidityUpper === undefined ? '--' : String(config.humidityUpper),
      flameTrip: config.flameTrip,
      flameClear: config.flameClear,
      flameTripText: config.flameTrip === undefined ? '--' : String(config.flameTrip),
      flameClearText: config.flameClear === undefined ? '--' : String(config.flameClear),
      alarmEnabled: config.alarmEnabled !== false,
      configRevision: config.configRevision || 0,
      configStatus: configStatus,
      configStatusText: textOf(CONFIG_STATUS_TEXT, configStatus, '--'),
      updatedAt: config.updatedAt || null,
      updatedAtText: time.formatDateTime(config.updatedAt)
    },

    // 可选模块
    gas: {
      items: gasItems,
      available: gasItems.some(function (item) {
        return item.available
      }),
      quality: gas.quality || (gasCapabilities.eco2 || gasCapabilities.tvoc ? 'ok' : 'not_configured'),
      qualityText: qualityText(gas.quality || (gasCapabilities.eco2 || gasCapabilities.tvoc ? 'ok' : 'not_configured'))
    },
    flame: {
      available: !!capabilities.flame && capabilities.flame.available !== false,
      raw: flame.raw,
      text: units.formatRaw(flame.raw),
      quality: flame.quality || 'ok',
      qualityText: qualityText(flame.quality || 'ok'),
      direction: (capabilities.flame && capabilities.flame.direction) || 'up'
    },
    capabilities: capabilities
  }
}

/**
 * 数据总体状态：用于首页顶部 banner。
 * @param {object} view
 * @returns {{level:string, text:string}}
 */
function overallStatus(view) {
  if (!view.online) return { level: 'err', text: '设备离线，显示的是最后一次缓存状态' }
  if (view.alarm.active) return { level: 'err', text: '火焰报警中：已停止灌溉输出，请现场确认' }
  if (view.stale) return { level: 'warn', text: '数据已过期（' + view.ageText + '），请等待设备上报' }
  if (!view.sensorValid) return { level: 'warn', text: '传感器数据无效：' + view.humidity.qualityText }
  return { level: 'ok', text: '数据正常 · ' + view.ageText }
}

module.exports = {
  QUALITY_TEXT,
  ALARM_TEXT,
  MODE_TEXT,
  MOTOR_TEXT,
  CONFIG_STATUS_TEXT,
  qualityText,
  isSensorValid,
  normalizeState,
  overallStatus
}
