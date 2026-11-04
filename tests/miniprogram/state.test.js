// tests/miniprogram/state.test.js
// 覆盖 models/state.js：RawState -> View Model 归一化、过期边界、报警组合、overallStatus。
'use strict'

const h = require('./harness')
const state = require(h.SM_ROOT + '/models/state')
const assert = h.assert

// 固定本地时间：2024-01-02 03:04:05
const NOW = new Date(2024, 0, 2, 3, 4, 5).getTime()

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function baseRaw() {
  return {
    deviceId: 'dev-1',
    online: true,
    bootId: 'boot-1',
    seq: 12,
    uptimeMs: 123456,
    receivedAt: NOW,
    sensor: { kind: 'air_rh', humidity: 45.15, temperature: 26.34, quality: 'ok', sampledAt: NOW },
    actuators: { fan: 'on', motor: 'forward' },
    mode: 'auto',
    alarm: { status: 'normal', id: null, since: null, muted: false },
    config: {
      sensorKind: 'air_rh',
      humidityLower: 30,
      humidityUpper: 40,
      flameTrip: 160,
      flameClear: 120,
      alarmEnabled: true,
      configRevision: 2,
      configStatus: 'ok',
      updatedAt: NOW - 60000
    },
    gas: { eco2: 430, tvoc: 16, combustibleRaw: null, quality: 'ok' },
    flame: { raw: 130, quality: 'ok' },
    capabilities: {
      board: 'FS-Hi3861 V4.2 (mock)',
      firmware: 'mock-0.1.0',
      supportsMotorReverse: true,
      gas: { eco2: true, tvoc: true, combustible: false },
      flame: { available: true, rawRange: [0, 4095], direction: 'up' },
      calibrated: { combustible: false }
    }
  }
}

function normalize(raw, options) {
  return state.normalizeState(raw, Object.assign({ now: NOW, staleAfterMs: 90000 }, options || {}))
}

h.describe('state.normalizeState normal data', function () {
  h.it('normalizes sensor, actuators, mode, alarm, config, gas, flame and capabilities', function () {
    const raw = baseRaw()
    const view = normalize(raw)

    assert.strictEqual(view.deviceId, 'dev-1')
    assert.strictEqual(view.online, true)
    assert.strictEqual(view.stale, false)
    assert.strictEqual(view.receivedAt, NOW)
    assert.strictEqual(view.receivedAtText, '03:04:05')
    assert.strictEqual(view.ageText, '刚刚')
    assert.strictEqual(view.bootId, 'boot-1')
    assert.strictEqual(view.seq, 12)

    assert.strictEqual(view.sensorKind, 'air_rh')
    assert.strictEqual(view.sensorKindText, '空气相对湿度')
    assert.strictEqual(view.sensorValid, true)
    assert.deepStrictEqual(view.humidity, {
      value: 45.15,
      text: '45.2',
      unit: '%RH',
      quality: 'ok',
      qualityText: '正常'
    })
    assert.deepStrictEqual(view.temperature, { value: 26.34, text: '26.3', unit: '℃', available: true })
    assert.strictEqual(view.sampledAt, NOW)
    assert.strictEqual(view.sampledAtText, '03:04:05')

    assert.deepStrictEqual(view.fan, { on: true, text: '开' })
    assert.deepStrictEqual(view.motor, { value: 'forward', text: '正转', available: true })
    assert.deepStrictEqual(view.mode, { value: 'auto', text: '自动', isAuto: true })

    assert.deepStrictEqual(view.alarm, {
      status: 'normal',
      active: false,
      text: '正常',
      id: '',
      sinceText: '--',
      canAcknowledge: true,
      muted: false
    })

    assert.strictEqual(view.config.sensorKind, 'air_rh')
    assert.strictEqual(view.config.humidityLower, 30)
    assert.strictEqual(view.config.humidityUpper, 40)
    assert.strictEqual(view.config.lowerText, '30')
    assert.strictEqual(view.config.upperText, '40')
    assert.strictEqual(view.config.flameTrip, 160)
    assert.strictEqual(view.config.flameClear, 120)
    assert.strictEqual(view.config.flameTripText, '160')
    assert.strictEqual(view.config.flameClearText, '120')
    assert.strictEqual(view.config.alarmEnabled, true)
    assert.strictEqual(view.config.configRevision, 2)
    assert.strictEqual(view.config.configStatus, 'ok')
    assert.strictEqual(view.config.configStatusText, '已保存')
    assert.strictEqual(view.config.updatedAt, NOW - 60000)
    assert.strictEqual(view.config.updatedAtText, '01-02 03:03')

    assert.strictEqual(view.gas.items.length, 3)
    assert.deepStrictEqual(view.gas.items[0], {
      key: 'eco2',
      label: 'eCO₂',
      available: true,
      value: 430,
      text: '430 ppm',
      unit: 'ppm'
    })
    assert.deepStrictEqual(view.gas.items[1], {
      key: 'tvoc',
      label: 'TVOC',
      available: true,
      value: 16,
      text: '16 ppb',
      unit: 'ppb'
    })
    assert.strictEqual(view.gas.items[2].key, 'combustible')
    assert.strictEqual(view.gas.items[2].label, '可燃气体')
    assert.strictEqual(view.gas.items[2].available, false)
    assert.strictEqual(view.gas.items[2].value, null)
    assert.strictEqual(view.gas.items[2].unit, '原始值')
    assert.strictEqual(view.gas.available, true)
    assert.strictEqual(view.gas.quality, 'ok')
    assert.strictEqual(view.gas.qualityText, '正常')

    assert.deepStrictEqual(view.flame, {
      available: true,
      raw: 130,
      text: '130',
      quality: 'ok',
      qualityText: '正常',
      direction: 'up'
    })
    assert.deepStrictEqual(view.capabilities, raw.capabilities)
  })

  h.it('uses soil-relative humidity label and unit', function () {
    const raw = baseRaw()
    raw.sensor.kind = 'soil_relative'
    raw.config.sensorKind = 'soil_relative'
    const view = normalize(raw)
    assert.strictEqual(view.sensorKind, 'soil_relative')
    assert.strictEqual(view.sensorKindText, '土壤湿度（标定相对值）')
    assert.strictEqual(view.humidity.unit, '%（标定相对值）')
  })

  h.it('tolerates an empty raw state', function () {
    const view = normalize({})
    assert.strictEqual(view.deviceId, '')
    assert.strictEqual(view.online, true)
    assert.strictEqual(view.stale, false)
    assert.strictEqual(view.seq, 0)
    assert.strictEqual(view.receivedAt, null)
    assert.strictEqual(view.ageText, '--')
    assert.strictEqual(view.sensorKind, 'air_rh')
    assert.strictEqual(view.sensorValid, false)
    assert.strictEqual(view.humidity.value, null)
    assert.strictEqual(view.humidity.quality, 'error')
    assert.strictEqual(view.humidity.qualityText, '故障')
    assert.strictEqual(view.temperature.value, null)
    assert.strictEqual(view.temperature.available, false)
    assert.strictEqual(view.fan.on, false)
    assert.strictEqual(view.motor.value, 'stopped')
    assert.strictEqual(view.motor.available, false)
    assert.strictEqual(view.mode.value, 'manual')
    assert.strictEqual(view.mode.isAuto, false)
    assert.strictEqual(view.alarm.status, 'normal')
    assert.strictEqual(view.alarm.canAcknowledge, true)
    assert.strictEqual(view.config.lowerText, '--')
    assert.strictEqual(view.config.upperText, '--')
    assert.strictEqual(view.config.configRevision, 0)
    assert.strictEqual(view.config.configStatus, 'ok')
    assert.strictEqual(view.gas.available, false)
    assert.strictEqual(view.gas.quality, 'not_configured')
    assert.strictEqual(view.gas.qualityText, '未配置')
    assert.strictEqual(view.flame.available, false)
    assert.strictEqual(view.flame.text, '--')
    assert.strictEqual(view.flame.direction, 'up')
    assert.deepStrictEqual(state.overallStatus(view), { level: 'warn', text: '传感器数据无效：故障' })
  })
})

h.describe('state.normalizeState stale / online boundaries', function () {
  h.it('is not stale at exactly staleAfterMs and stale one ms later', function () {
    const fresh = baseRaw()
    fresh.receivedAt = NOW - 90000
    fresh.sensor.sampledAt = NOW - 90000
    let view = normalize(fresh)
    assert.strictEqual(view.stale, false)
    assert.strictEqual(view.ageText, '1 分钟前')
    assert.strictEqual(view.sensorValid, true)
    assert.deepStrictEqual(state.overallStatus(view), { level: 'ok', text: '数据正常 · 1 分钟前' })

    const old = baseRaw()
    old.receivedAt = NOW - 90001
    old.sensor.sampledAt = NOW - 90001
    view = normalize(old)
    assert.strictEqual(view.stale, true)
    assert.strictEqual(view.sensorValid, false)
    assert.deepStrictEqual(state.overallStatus(view), {
      level: 'warn',
      text: '数据已过期（1 分钟前），请等待设备上报'
    })
  })

  h.it('honours an explicit raw.stale boolean in both directions', function () {
    const forcedStale = baseRaw()
    forcedStale.stale = true
    assert.strictEqual(normalize(forcedStale).stale, true)

    const forcedFresh = baseRaw()
    forcedFresh.stale = false
    forcedFresh.receivedAt = NOW - 10 * 90000
    forcedFresh.sensor.sampledAt = NOW - 10 * 90000
    const view = normalize(forcedFresh)
    assert.strictEqual(view.stale, false)
    assert.strictEqual(view.sensorValid, true)
  })

  h.it('marks offline devices and lets offline win over other conditions', function () {
    const raw = baseRaw()
    raw.online = false
    let view = normalize(raw)
    assert.strictEqual(view.online, false)
    assert.deepStrictEqual(state.overallStatus(view), {
      level: 'err',
      text: '设备离线，显示的是最后一次缓存状态'
    })

    raw.alarm.status = 'active'
    view = normalize(raw)
    assert.deepStrictEqual(state.overallStatus(view), {
      level: 'err',
      text: '设备离线，显示的是最后一次缓存状态'
    })
  })

  h.it('lets the caller override online via options', function () {
    const view = normalize(baseRaw(), { online: false })
    assert.strictEqual(view.online, false)
    assert.strictEqual(state.overallStatus(view).level, 'err')
  })
})

h.describe('state.normalizeState alarm combinations', function () {
  h.it('active alarm blocks acknowledgement and drives overallStatus to err', function () {
    const raw = baseRaw()
    raw.alarm = { status: 'active', id: 'alarm-1', since: NOW - 3600000, muted: true }
    const view = normalize(raw)
    assert.strictEqual(view.alarm.active, true)
    assert.strictEqual(view.alarm.status, 'active')
    assert.strictEqual(view.alarm.text, '报警中')
    assert.strictEqual(view.alarm.id, 'alarm-1')
    assert.strictEqual(view.alarm.sinceText, '01-02 02:04')
    assert.strictEqual(view.alarm.canAcknowledge, false)
    assert.strictEqual(view.alarm.muted, true)
    assert.deepStrictEqual(state.overallStatus(view), {
      level: 'err',
      text: '火焰报警中：已停止灌溉输出，请现场确认'
    })
  })

  h.it('clearing alarm is acknowledgeable and no longer err', function () {
    const raw = baseRaw()
    raw.alarm = { status: 'clearing', id: 'alarm-2', since: NOW, muted: false }
    const view = normalize(raw)
    assert.strictEqual(view.alarm.active, false)
    assert.strictEqual(view.alarm.text, '解除确认中')
    assert.strictEqual(view.alarm.canAcknowledge, true)
    assert.strictEqual(state.overallStatus(view).level, 'ok')
  })

  h.it('suspected alarm is shown but not acknowledgeable', function () {
    const raw = baseRaw()
    raw.alarm = { status: 'suspected', id: 'alarm-3', since: NOW, muted: false }
    const view = normalize(raw)
    assert.strictEqual(view.alarm.active, false)
    assert.strictEqual(view.alarm.text, '疑似')
    assert.strictEqual(view.alarm.canAcknowledge, false)
  })
})

h.describe('state.overallStatus levels', function () {
  h.it('returns ok / warn / err for the documented precedence', function () {
    const okView = normalize(baseRaw())
    assert.deepStrictEqual(state.overallStatus(okView), { level: 'ok', text: '数据正常 · 刚刚' })

    const staleRaw = baseRaw()
    staleRaw.receivedAt = NOW - 90001
    staleRaw.sensor.sampledAt = NOW - 90001
    assert.strictEqual(state.overallStatus(normalize(staleRaw)).level, 'warn')

    const invalidRaw = baseRaw()
    invalidRaw.sensor.quality = 'error'
    invalidRaw.sensor.humidity = null
    assert.deepStrictEqual(state.overallStatus(normalize(invalidRaw)), {
      level: 'warn',
      text: '传感器数据无效：故障'
    })

    const alarmRaw = baseRaw()
    alarmRaw.alarm.status = 'active'
    alarmRaw.alarm.id = 'a'
    alarmRaw.alarm.since = NOW
    assert.strictEqual(state.overallStatus(normalize(alarmRaw)).level, 'err')

    const offlineRaw = baseRaw()
    offlineRaw.online = false
    assert.strictEqual(state.overallStatus(normalize(offlineRaw)).level, 'err')

    // stale 优先于 sensor invalid
    const bothRaw = baseRaw()
    bothRaw.receivedAt = NOW - 90001
    bothRaw.sensor.sampledAt = NOW - 90001
    bothRaw.sensor.quality = 'error'
    bothRaw.sensor.humidity = null
    assert.deepStrictEqual(state.overallStatus(normalize(bothRaw)), {
      level: 'warn',
      text: '数据已过期（1 分钟前），请等待设备上报'
    })
  })
})

h.describe('state gas / flame capability handling', function () {
  h.it('marks every gas item unavailable when no gas capability exists', function () {
    const raw = baseRaw()
    raw.capabilities.gas = { eco2: false, tvoc: false, combustible: false }
    raw.gas = {}
    const view = normalize(raw)
    view.gas.items.forEach(function (item) {
      assert.strictEqual(item.available, false, item.key + ' should be unavailable')
      assert.strictEqual(item.text, '--', item.key + ' should show --')
    })
    assert.strictEqual(view.gas.available, false)
    assert.strictEqual(view.gas.quality, 'not_configured')
    assert.strictEqual(view.gas.qualityText, '未配置')
  })

  h.it('keeps the combustible slot visible but unavailable when not calibrated', function () {
    const view = normalize(baseRaw())
    const combustible = view.gas.items[2]
    assert.strictEqual(combustible.available, false)
    assert.strictEqual(combustible.value, null)
    assert.strictEqual(view.gas.available, true)
  })

  h.it('unavailable combustible raw null should render "--"', function () {
    const view = normalize(baseRaw())
    assert.strictEqual(view.gas.items[2].text, '--')
  })

  h.it('passes gas quality through', function () {
    const raw = baseRaw()
    raw.gas.quality = 'warming_up'
    const view = normalize(raw)
    assert.strictEqual(view.gas.quality, 'warming_up')
    assert.strictEqual(view.gas.qualityText, '预热中')
  })

  h.it('honours flame availability and direction from capabilities', function () {
    const raw = baseRaw()
    raw.capabilities.flame = { available: false, rawRange: [0, 4095], direction: 'down' }
    const view = normalize(raw)
    assert.strictEqual(view.flame.available, false)
    assert.strictEqual(view.flame.direction, 'down')
    assert.strictEqual(view.flame.raw, 130)

    const missing = baseRaw()
    delete missing.capabilities.flame
    const missingView = normalize(missing)
    assert.strictEqual(missingView.flame.available, false)
    assert.strictEqual(missingView.flame.direction, 'up')
  })

  h.it('exposes motor availability from supportsMotorReverse', function () {
    const raw = baseRaw()
    raw.capabilities.supportsMotorReverse = false
    const view = normalize(raw)
    assert.strictEqual(view.motor.available, false)
    assert.strictEqual(view.motor.text, '正转')
  })
})

h.describe('state config status text', function () {
  h.it('maps every documented configStatus', function () {
    const expected = {
      ok: '已保存',
      defaulted: '默认值',
      incompatible: '版本不兼容',
      write_failed: '保存失败'
    }
    Object.keys(expected).forEach(function (status) {
      const raw = baseRaw()
      raw.config.configStatus = status
      assert.strictEqual(normalize(raw).config.configStatusText, expected[status], status)
    })
  })

  h.it('missing configStatus should still render the default ok text, default', function () {
    const raw = baseRaw()
    delete raw.config.configStatus
    assert.strictEqual(normalize(raw).config.configStatusText, '已保存')
  })
})

h.describe('state exported helpers', function () {
  h.it('isSensorValid requires ok quality, a non-null humidity and fresh data', function () {
    assert.strictEqual(state.isSensorValid({ sensor: { quality: 'ok', humidity: 0 } }, false), true)
    assert.strictEqual(state.isSensorValid({ sensor: { quality: 'ok', humidity: 45 } }, true), false)
    assert.strictEqual(state.isSensorValid({ sensor: { quality: 'ok', humidity: null } }, false), false)
    assert.strictEqual(state.isSensorValid({ sensor: { quality: 'warming_up', humidity: 45 } }, false), false)
    assert.strictEqual(state.isSensorValid({}, false), false)
    assert.strictEqual(state.isSensorValid(null, false), false)
  })

  h.it('qualityText falls back for unknown / missing quality', function () {
    assert.strictEqual(state.qualityText('ok'), '正常')
    assert.strictEqual(state.qualityText('warming_up'), '预热中')
    assert.strictEqual(state.qualityText('not_configured'), '未配置')
    assert.strictEqual(state.qualityText('error'), '故障')
    assert.strictEqual(state.qualityText('stale'), '数据过期')
    assert.strictEqual(state.qualityText('weird'), '未知')
    assert.strictEqual(state.qualityText(undefined), '未知')
  })
})

h.main('state.test.js')
