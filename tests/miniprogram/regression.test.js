// tests/miniprogram/regression.test.js
// 回归用例：覆盖第二轮复核指出的缺陷修复，防止回退。
// 只依赖纯逻辑模块；transport-gateway 用最小 wx.request stub 验证错误码映射。
'use strict'

const path = require('node:path')
const h = require('./harness')
const { SM_ROOT } = h

const units = require(path.join(SM_ROOT, 'utils', 'units'))
const stateModel = require(path.join(SM_ROOT, 'models', 'state'))
const device = require(path.join(SM_ROOT, 'services', 'device'))
const { createMockDevice, createMemoryStorage } = require(path.join(SM_ROOT, 'services', 'mock-device'))
const { createGatewayTransport } = require(path.join(SM_ROOT, 'services', 'transport-gateway'))
const nfcCodec = require(path.join(SM_ROOT, 'utils', 'nfc-codec'))

h.describe('regression: units null/boolean safety', function () {
  h.it('round1(null|undefined|""|true) returns null', function () {
    h.assert.strictEqual(units.round1(null), null)
    h.assert.strictEqual(units.round1(undefined), null)
    h.assert.strictEqual(units.round1(''), null)
    h.assert.strictEqual(units.round1(true), null)
    h.assert.strictEqual(units.round1(0), 0)
  })

  h.it('toInt(null|true) returns null; toInt("12") returns 12', function () {
    h.assert.strictEqual(units.toInt(null), null)
    h.assert.strictEqual(units.toInt(true), null)
    h.assert.strictEqual(units.toInt('12'), 12)
  })

  h.it('formatters render "--" for null instead of 0', function () {
    h.assert.strictEqual(units.formatHumidity(null), '--')
    h.assert.strictEqual(units.formatTemperature(null), '--')
    h.assert.strictEqual(units.formatRaw(null), '--')
    h.assert.strictEqual(units.formatConcentration(null, 'ppm'), '--')
  })

  h.it('parsePercentInt rejects booleans/fraction/out-of-range', function () {
    h.assert.strictEqual(units.parsePercentInt(true), null)
    h.assert.strictEqual(units.parsePercentInt('30.5'), null)
    h.assert.strictEqual(units.parsePercentInt(101), null)
    h.assert.strictEqual(units.parsePercentInt('30'), 30)
  })
})

h.describe('regression: state view model', function () {
  function rawState(overrides) {
    return Object.assign(
      {
        deviceId: 'd1',
        online: true,
        sensor: { kind: 'air_rh', humidity: null, temperature: null, quality: 'error', sampledAt: 1000 },
        actuators: { fan: 'off', motor: 'stopped' },
        mode: 'manual',
        alarm: { status: 'normal' },
        config: { sensorKind: 'air_rh', humidityLower: 30, humidityUpper: 40, configRevision: 1 },
        gas: { eco2: null, tvoc: null, combustibleRaw: null },
        flame: { raw: null },
        capabilities: {
          supportsMotorReverse: false,
          gas: { eco2: true, tvoc: true, combustible: false },
          flame: { available: false, direction: 'up' }
        },
        receivedAt: 1000
      },
      overrides || {}
    )
  }

  h.it('null sensor/gas/flame never render as 0', function () {
    const view = stateModel.normalizeState(rawState(), { now: 1000, staleAfterMs: 90000 })
    h.assert.strictEqual(view.humidity.text, '--')
    h.assert.strictEqual(view.temperature.text, '--')
    h.assert.strictEqual(view.flame.text, '--')
    const eco2 = view.gas.items.filter(function (item) {
      return item.key === 'eco2'
    })[0]
    h.assert.strictEqual(eco2.text, '--')
  })

  h.it('missing configStatus falls back to ok text', function () {
    const view = stateModel.normalizeState(rawState(), { now: 1000, staleAfterMs: 90000 })
    h.assert.strictEqual(view.config.configStatus, 'ok')
    h.assert.strictEqual(view.config.configStatusText, '已保存')
  })

  h.it('overallStatus returns err/warn/ok', function () {
    const okView = stateModel.normalizeState(
      rawState({
        sensor: { kind: 'air_rh', humidity: 45, temperature: 26, quality: 'ok', sampledAt: 1000 }
      }),
      { now: 1000, staleAfterMs: 90000 }
    )
    h.assert.strictEqual(stateModel.overallStatus(okView).level, 'ok')

    const staleView = stateModel.normalizeState(rawState(), { now: 1000 + 120000, staleAfterMs: 90000 })
    h.assert.strictEqual(stateModel.overallStatus(staleView).level, 'warn')

    const alarmView = stateModel.normalizeState(
      rawState({ alarm: { status: 'active', id: 'a1', since: 1000 } }),
      { now: 1000, staleAfterMs: 90000 }
    )
    h.assert.strictEqual(stateModel.overallStatus(alarmView).level, 'err')
  })
})

h.describe('regression: mock-device command safety', function () {
  h.it('set_fan rejects on expectedRevision mismatch', async function () {
    const dev = createMockDevice({ latencyMs: 0, seed: 1, storage: createMemoryStorage() })
    const result = await dev.sendCommand(
      'set_fan',
      { value: 'ON' },
      { requestId: 'fan-rev-1', expectedRevision: 999 }
    )
    h.assert.strictEqual(result.status, 'rejected')
    h.assert.strictEqual(result.errorCode, 'REVISION_CONFLICT')
  })

  h.it('set_security_config rejects on nvVerifyError and marks configStatus', async function () {
    const dev = createMockDevice({ latencyMs: 0, seed: 1, storage: createMemoryStorage() })
    dev.setFaults({ nvVerifyError: true })
    const result = await dev.sendCommand(
      'set_security_config',
      { flameTrip: 200, flameClear: 150, alarmEnabled: true },
      { requestId: 'sec-verify-1', expectedRevision: 0 }
    )
    h.assert.strictEqual(result.status, 'rejected')
    h.assert.strictEqual(result.errorCode, 'NV_VERIFY_FAILED')
    h.assert.strictEqual(dev.getConfig().configStatus, 'write_failed')
  })

  h.it('manual mode is also ALARM_LOCKED during active alarm', async function () {
    const dev = createMockDevice({ latencyMs: 0, seed: 1, storage: createMemoryStorage() })
    await dev.sendCommand('mock_alarm', { status: 'active' }, { requestId: 'alarm-1' })
    const result = await dev.sendCommand('set_mode', { mode: 'manual' }, { requestId: 'mode-1' })
    h.assert.strictEqual(result.status, 'rejected')
    h.assert.strictEqual(result.errorCode, 'ALARM_LOCKED')
  })

  h.it('threshold NV failure marks configStatus write_failed', async function () {
    const dev = createMockDevice({ latencyMs: 0, seed: 1, storage: createMemoryStorage() })
    dev.setFaults({ nvWriteError: true })
    const result = await dev.sendCommand(
      'set_thresholds',
      { lower: 20, upper: 60 },
      { requestId: 'thr-nv-1', expectedRevision: 0 }
    )
    h.assert.strictEqual(result.status, 'rejected')
    h.assert.strictEqual(result.errorCode, 'NV_WRITE_FAILED')
    h.assert.strictEqual(dev.getConfig().configStatus, 'write_failed')
  })
})

h.describe('regression: client validation and transport mapping', function () {
  h.it('validateSecurityConfig rejects fractional values', function () {
    const checked = device.validateSecurityConfig({ flameTrip: 100.5, flameClear: 50 })
    h.assert.strictEqual(checked.ok, false)
    h.assert.strictEqual(checked.error.code, 'OUT_OF_RANGE')
  })

  h.it('gateway 404 with STALE_COMMAND maps to STALE_COMMAND, not DEVICE_OFFLINE', async function () {
    global.wx = {
      request: function (options) {
        options.success({ statusCode: 404, data: { error: { code: 'STALE_COMMAND', message: '命令不存在' } } })
      }
    }
    try {
      const transport = createGatewayTransport({ mode: 'gateway', baseUrl: 'http://127.0.0.1:1', deviceId: 'd1' })
      let caught = null
      try {
        await transport.getState()
      } catch (err) {
        caught = err
      }
      h.assert.ok(caught, 'should reject')
      h.assert.strictEqual(caught.code, 'STALE_COMMAND')
    } finally {
      delete global.wx
    }
  })

  h.it('NFC preview keeps既定 example-nfc-v1 layout', function () {
    const encoded = nfcCodec.encodeWifiRecord({ ssid: 'Lab24G', passwd: 'example-only' }, 1730000000000)
    h.assert.strictEqual(encoded.ok, true)
    h.assert.strictEqual(encoded.record.tnf, 2)
    h.assert.strictEqual(nfcCodec.toHex(encoded.record.type), '74')
    h.assert.strictEqual(encoded.texts.idText, '1730000000000')
    h.assert.strictEqual(encoded.texts.payloadText, '{"ssid":"Lab24G","passwd":"example-only"}')
  })
})

h.main('regression.test.js')
