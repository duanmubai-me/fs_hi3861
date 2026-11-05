// tests/miniprogram/device.test.js
// 覆盖 services/device.js：客户端校验、resultSummary、saveThresholds 校验短路、mock 闭环与传输层异常。
'use strict'

const h = require('./harness')
const device = require(h.SM_ROOT + '/services/device')
const errors = require(h.SM_ROOT + '/models/errors')
const transportModule = require(h.SM_ROOT + '/services/transport')
const assert = h.assert

h.describe('device env / transport', function () {
  h.it('defaults to Huawei direct and explicitly selects mock for offline tests', function () {
    assert.strictEqual(device.getEnv().mode, 'gateway')
    assert.strictEqual(device.transportName(), 'gateway')
    assert.ok(device.transportDescribe().includes('华为云直连'))
    const storage = {}
    global.wx = {
      getStorageSync: function (key) { return storage[key] },
      setStorageSync: function (key, value) { storage[key] = value }
    }
    device.setEnv({
      mode: 'mock',
      baseUrl: 'http://127.0.0.1:8080',
      deviceId: 'mock-farm-001',
      pollIntervalMs: 5000,
      staleAfterMs: 90000,
      commandTimeoutMs: 9000
    })
    assert.strictEqual(device.transportName(), 'mock')
    assert.strictEqual(device.transportDescribe(), '应用内模拟设备（mock）')
  })
})

h.describe('device.validateThresholds', function () {
  h.it('accepts integers 0..100, including integer strings', function () {
    assert.deepStrictEqual(device.validateThresholds('30', '40'), { ok: true, value: { lower: 30, upper: 40 } })
    assert.deepStrictEqual(device.validateThresholds(0, 100), { ok: true, value: { lower: 0, upper: 100 } })
    assert.deepStrictEqual(device.validateThresholds(0, 1), { ok: true, value: { lower: 0, upper: 1 } })
    assert.deepStrictEqual(device.validateThresholds(99, 100), { ok: true, value: { lower: 99, upper: 100 } })
  })

  h.it('rejects equal / inverted ranges with INVALID_THRESHOLD_RANGE', function () {
    ;[
      [30, 30],
      [40, 30],
      [0, 0],
      [100, 100]
    ].forEach(function (pair) {
      const checked = device.validateThresholds(pair[0], pair[1])
      assert.strictEqual(checked.ok, false)
      assert.strictEqual(checked.error.code, 'INVALID_THRESHOLD_RANGE', pair.join('/'))
      assert.strictEqual(checked.error.retryable, false)
      assert.ok(checked.error.message)
      assert.ok(checked.error.hint)
    })
  })

  h.it('rejects fractional / out-of-range / missing input with OUT_OF_RANGE', function () {
    ;[
      [30.5, 40],
      [-1, 40],
      [0, 101],
      [null, 40],
      [undefined, 40],
      ['', 40],
      ['abc', 40],
      [40, null]
    ].forEach(function (pair) {
      const checked = device.validateThresholds(pair[0], pair[1])
      assert.strictEqual(checked.ok, false)
      assert.strictEqual(checked.error.code, 'OUT_OF_RANGE', String(pair[0]) + '/' + String(pair[1]))
      assert.strictEqual(checked.error.detail, '阈值需为 0–100 的整数')
    })
  })
})

h.describe('device.validateSecurityConfig', function () {
  h.it('accepts trip > clear inside 0..4095', function () {
    assert.deepStrictEqual(device.validateSecurityConfig({ flameTrip: 160, flameClear: 120 }), {
      ok: true,
      value: { flameTrip: 160, flameClear: 120 }
    })
    assert.deepStrictEqual(device.validateSecurityConfig({ flameTrip: 4095, flameClear: 0 }), {
      ok: true,
      value: { flameTrip: 4095, flameClear: 0 }
    })
    assert.deepStrictEqual(device.validateSecurityConfig({ flameTrip: '300', flameClear: '200' }), {
      ok: true,
      value: { flameTrip: 300, flameClear: 200 }
    })
  })

  h.it('rejects trip <= clear with INVALID_THRESHOLD_RANGE', function () {
    ;[
      [100, 200],
      [200, 200],
      [0, 100]
    ].forEach(function (pair) {
      const checked = device.validateSecurityConfig({ flameTrip: pair[0], flameClear: pair[1] })
      assert.strictEqual(checked.ok, false)
      assert.strictEqual(checked.error.code, 'INVALID_THRESHOLD_RANGE')
      assert.strictEqual(checked.error.detail, '触发阈值必须大于解除阈值（按强度升高触发）')
    })
  })

  h.it('rejects out-of-range / non-integer / missing values with OUT_OF_RANGE', function () {
    ;[
      { flameTrip: 4096, flameClear: 0 },
      { flameTrip: -1, flameClear: -2 },
      { flameTrip: 'abc', flameClear: 50 },
      { flameTrip: 100 },
      null
    ].forEach(function (input) {
      const checked = device.validateSecurityConfig(input)
      assert.strictEqual(checked.ok, false, JSON.stringify(input))
      assert.strictEqual(checked.error.code, 'OUT_OF_RANGE')
      assert.strictEqual(checked.error.detail, '火焰阈值需为 0–4095 的整数')
    })
  })

  // toInt() 会四舍五入，100.5 被当成 101 通过校验；契约要求 0–4095 整数。
  h.it('should reject fractional flameTrip instead of rounding it', function () {
    const checked = device.validateSecurityConfig({ flameTrip: 100.5, flameClear: 50 })
    assert.strictEqual(checked.ok, false)
    assert.strictEqual(checked.error.code, 'OUT_OF_RANGE')
  })
})

h.describe('device.resultSummary', function () {
  h.it('summarizes empty, applied+saved, applied and unknown results', function () {
    assert.deepStrictEqual(device.resultSummary(null), { level: 'muted', text: '暂无命令记录' })
    assert.deepStrictEqual(device.resultSummary({ result: { status: 'applied', saved: true, configRevision: 3 } }), {
      level: 'ok',
      text: '已保存到设备（revision 3）'
    })
    assert.deepStrictEqual(device.resultSummary({ result: { status: 'applied', saved: true } }), {
      level: 'ok',
      text: '已保存到设备（revision --）'
    })
    assert.deepStrictEqual(device.resultSummary({ result: { status: 'applied', saved: false } }), {
      level: 'ok',
      text: '设备已执行'
    })
    assert.deepStrictEqual(device.resultSummary({ result: { status: 'pending' } }), {
      level: 'warn',
      text: '结果未知，请刷新状态核对'
    })
    assert.deepStrictEqual(device.resultSummary({ result: { status: 'rejected' } }), {
      level: 'warn',
      text: '结果未知，请刷新状态核对'
    })
  })

  h.it('prints the error message and optional detail', function () {
    const plain = device.resultSummary({ error: errors.describeError({ code: 'ALARM_LOCKED' }) })
    assert.strictEqual(plain.level, 'err')
    assert.strictEqual(plain.text, '火焰报警锁定中，操作被拒绝')

    const detailed = device.resultSummary({
      error: errors.describeError({ code: 'REVISION_CONFLICT', message: '设备返回：revision 3' })
    })
    assert.strictEqual(detailed.level, 'err')
    assert.strictEqual(detailed.text, '配置已被其他操作修改（设备返回：revision 3）')
  })
})

h.describe('device.saveThresholds client validation', function () {
  h.it('returns invalid:true and does not send any command', async function () {
    assert.strictEqual(device.getLastCommand(), null)

    const inverted = await device.saveThresholds({ lower: 50, upper: 40 })
    assert.strictEqual(inverted.ok, false)
    assert.strictEqual(inverted.invalid, true)
    assert.strictEqual(inverted.requestId, null)
    assert.strictEqual(inverted.result, null)
    assert.strictEqual(inverted.error.code, 'INVALID_THRESHOLD_RANGE')
    assert.strictEqual(device.getLastCommand(), null)

    const fractional = await device.saveThresholds({ lower: 30.5, upper: 40 })
    assert.strictEqual(fractional.invalid, true)
    assert.strictEqual(fractional.error.code, 'OUT_OF_RANGE')
    assert.strictEqual(device.getLastCommand(), null)
  })
})

h.describe('device.saveThresholds against mock device', function () {
  h.it('applies, saves and exposes saved=true + new revision', async function () {
    await device.resetMock()
    const result = await device.saveThresholds({ lower: 50, upper: 60 }, { expectedRevision: 0 })
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.error, null)
    assert.strictEqual(result.result.status, 'applied')
    assert.strictEqual(result.result.saved, true)
    assert.strictEqual(result.result.configRevision, 1)
    assert.deepStrictEqual(result.result.params, { lower: 50, upper: 60 })

    const last = device.getLastCommand()
    assert.strictEqual(last.action, 'set_thresholds')
    assert.strictEqual(last.requestId, result.requestId)
    assert.strictEqual(last.status, 'applied')
    assert.strictEqual(last.saved, true)
    assert.strictEqual(last.error, null)

    const refreshed = await device.refresh()
    assert.strictEqual(refreshed.ok, true)
    assert.strictEqual(refreshed.error, null)
    assert.strictEqual(refreshed.transportName, 'mock')
    assert.strictEqual(refreshed.env.mode, 'mock')
    assert.strictEqual(refreshed.view.config.lowerText, '50')
    assert.strictEqual(refreshed.view.config.upperText, '60')
    assert.strictEqual(refreshed.view.config.configRevision, 1)
    assert.notStrictEqual(refreshed.view.config.updatedAtText, '--')
  })

  h.it('surfaces REVISION_CONFLICT and keeps the old config', async function () {
    await device.resetMock()
    await device.saveThresholds({ lower: 50, upper: 60 }, { expectedRevision: 0 })

    const conflict = await device.saveThresholds({ lower: 51, upper: 61 }, { expectedRevision: 0 })
    assert.strictEqual(conflict.ok, false)
    assert.strictEqual(conflict.error.code, 'REVISION_CONFLICT')
    assert.strictEqual(conflict.error.retryable, true)
    assert.strictEqual(conflict.result.status, 'rejected')
    assert.strictEqual(conflict.result.errorCode, 'REVISION_CONFLICT')

    const last = device.getLastCommand()
    assert.strictEqual(last.status, 'rejected')
    assert.strictEqual(last.saved, false)
    assert.strictEqual(last.error.code, 'REVISION_CONFLICT')

    const refreshed = await device.refresh()
    assert.strictEqual(refreshed.view.config.lowerText, '50')
    assert.strictEqual(refreshed.view.config.upperText, '60')
    assert.strictEqual(refreshed.view.config.configRevision, 1)
  })
})

h.describe('device.saveSecurityConfig', function () {
  h.it('skips the command on client validation failure', async function () {
    await device.resetMock()
    const before = device.getLastCommand()
    const result = await device.saveSecurityConfig({ flameTrip: 100, flameClear: 200 })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.invalid, true)
    assert.strictEqual(result.requestId, null)
    assert.strictEqual(result.error.code, 'INVALID_THRESHOLD_RANGE')
    assert.deepStrictEqual(device.getLastCommand(), before)
  })

  h.it('applies valid flame thresholds and alarmEnabled', async function () {
    await device.resetMock()
    const result = await device.saveSecurityConfig({ flameTrip: 300, flameClear: 200, alarmEnabled: false })
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.result.saved, true)
    assert.strictEqual(result.result.configRevision, 1)

    const refreshed = await device.refresh()
    assert.strictEqual(refreshed.view.config.flameTripText, '300')
    assert.strictEqual(refreshed.view.config.flameClearText, '200')
    assert.strictEqual(refreshed.view.config.alarmEnabled, false)
  })
})

h.describe('device.refresh / setFan / setAutoMode on mock', function () {
  h.it('returns a normalized view for the mock device', async function () {
    await device.resetMock()
    const result = await device.refresh()
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.view.deviceId, 'mock-farm-001')
    assert.strictEqual(result.view.online, true)
    assert.strictEqual(result.view.stale, false)
    assert.strictEqual(result.view.humidity.unit, '%RH')
    assert.strictEqual(result.view.mode.value, 'manual')
    assert.strictEqual(result.view.alarm.status, 'normal')
    assert.strictEqual(result.env.deviceId, 'mock-farm-001')
  })

  h.it('sets fan and auto mode through the facade', async function () {
    await device.resetMock()

    const fan = await device.setFan(true)
    assert.strictEqual(fan.ok, true)
    assert.strictEqual(fan.result.status, 'applied')
    assert.strictEqual(fan.result.saved, false)
    let view = (await device.refresh()).view
    assert.strictEqual(view.fan.on, true)
    assert.strictEqual(view.mode.value, 'manual')

    const auto = await device.setAutoMode(true)
    assert.strictEqual(auto.ok, true)
    assert.strictEqual(auto.result.saved, true)
    assert.strictEqual(auto.result.configRevision, 1)
    view = (await device.refresh()).view
    assert.strictEqual(view.mode.value, 'auto')
    assert.strictEqual(view.mode.isAuto, true)
  })
})

h.describe('device transport failures', function () {
  h.it('turns a rejected getState into a NETWORK_ERROR result', async function () {
    const original = transportModule.getTransport
    transportModule.getTransport = function () {
      return {
        name: 'stub',
        describe: function () {
          return 'stub transport'
        },
        getState: function () {
          return Promise.reject(errors.createError('NETWORK_ERROR', '连接被拒绝'))
        }
      }
    }
    try {
      const result = await device.refresh()
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.raw, null)
      assert.strictEqual(result.view, null)
      assert.strictEqual(result.transportName, 'stub')
      assert.strictEqual(result.env.mode, 'mock')
      assert.strictEqual(result.error.code, 'NETWORK_ERROR')
      assert.strictEqual(result.error.message, '无法访问华为云')
      assert.strictEqual(result.error.detail, '连接被拒绝')
      assert.strictEqual(result.error.retryable, true)
    } finally {
      transportModule.getTransport = original
      device.resetTransport()
    }
  })

  h.it('turns a rejected sendCommand into an error result and records it', async function () {
    const original = transportModule.getTransport
    transportModule.getTransport = function () {
      return {
        name: 'stub',
        sendCommand: function () {
          return Promise.reject(errors.createError('TIMEOUT', '等待设备结果超时'))
        }
      }
    }
    try {
      const result = await device.setFan(true)
      assert.strictEqual(result.ok, false)
      assert.strictEqual(result.result, null)
      assert.ok(result.requestId)
      assert.strictEqual(result.error.code, 'TIMEOUT')
      assert.strictEqual(result.error.message, '操作超时，结果未知')
      assert.strictEqual(result.error.detail, '等待设备结果超时')

      const last = device.getLastCommand()
      assert.strictEqual(last.action, 'set_fan')
      assert.strictEqual(last.requestId, result.requestId)
      assert.strictEqual(last.status, 'error')
      assert.strictEqual(last.saved, false)
      assert.strictEqual(last.error.code, 'TIMEOUT')
    } finally {
      transportModule.getTransport = original
      device.resetTransport()
    }
  })
})

h.main('device.test.js')
