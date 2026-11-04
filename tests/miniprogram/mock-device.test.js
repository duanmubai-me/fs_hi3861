// tests/miniprogram/mock-device.test.js
// 覆盖 services/mock-device.js：配置事务、revision、幂等、故障注入、自动模式、报警锁、重启恢复。
'use strict'

const h = require('./harness')
const mock = require(h.SM_ROOT + '/services/mock-device')
const assert = h.assert

const NOW = 1700000000000

function make(extra) {
  return mock.createMockDevice(
    Object.assign(
      {
        latencyMs: 0,
        seed: 42,
        now: function () {
          return NOW
        }
      },
      extra || {}
    )
  )
}

function send(dev, action, params, requestId, expectedRevision) {
  const meta = { requestId: requestId }
  if (expectedRevision !== undefined) meta.expectedRevision = expectedRevision
  return dev.sendCommand(action, params || {}, meta)
}

h.describe('mock-device default state', function () {
  h.it('starts from the documented default config', function () {
    const dev = make()
    const config = dev.getConfig()
    assert.strictEqual(config.sensorKind, 'air_rh')
    assert.strictEqual(config.humidityLower, 30)
    assert.strictEqual(config.humidityUpper, 40)
    assert.strictEqual(config.mode, 'manual')
    assert.strictEqual(config.flameTrip, 160)
    assert.strictEqual(config.flameClear, 120)
    assert.strictEqual(config.alarmEnabled, true)
    assert.strictEqual(config.configRevision, 0)
    assert.strictEqual(config.configStatus, 'ok')
    assert.strictEqual(config.updatedAt, null)
  })

  h.it('reports a complete RawState with capabilities', async function () {
    const dev = make()
    const state = await dev.getState()

    assert.strictEqual(state.deviceId, 'mock-farm-001')
    assert.strictEqual(state.online, true)
    assert.match(state.bootId, /^boot-/)
    assert.strictEqual(state.seq, 1)
    assert.strictEqual(state.uptimeMs, 0)
    assert.strictEqual(state.receivedAt, NOW)

    assert.strictEqual(state.sensor.kind, 'air_rh')
    assert.ok(state.sensor.humidity >= 20 && state.sensor.humidity <= 80)
    assert.ok(state.sensor.temperature >= 18 && state.sensor.temperature <= 34)
    assert.strictEqual(state.sensor.quality, 'ok')
    assert.strictEqual(state.sensor.sampledAt, NOW)

    assert.deepStrictEqual(state.actuators, { fan: 'off', motor: 'stopped' })
    assert.strictEqual(state.mode, 'manual')
    assert.deepStrictEqual(state.alarm, { status: 'normal', id: null, since: null, muted: false })
    assert.strictEqual(state.config.configRevision, 0)
    assert.strictEqual(state.config.configStatus, 'ok')
    assert.strictEqual(state.config.updatedAt, null)

    assert.ok(state.gas.eco2 >= 400)
    assert.ok(state.gas.tvoc >= 0)
    assert.strictEqual(state.gas.combustibleRaw, null)
    assert.strictEqual(state.gas.quality, 'ok')
    assert.ok(state.flame.raw >= 0 && state.flame.raw <= 4095)
    assert.strictEqual(state.flame.quality, 'ok')
    assert.deepStrictEqual(state.capabilities, mock.CAPABILITIES)
  })

  h.it('increments seq on every state read but keeps bootId stable', async function () {
    const dev = make()
    const first = await dev.getState()
    const second = await dev.getState()
    assert.strictEqual(first.seq, 1)
    assert.strictEqual(second.seq, 2)
    assert.strictEqual(first.bootId, second.bootId)
  })
})

h.describe('mock-device set_thresholds', function () {
  h.it('applies, persists and bumps revision once', async function () {
    const dev = make()
    const result = await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'r1')

    assert.strictEqual(result.status, 'applied')
    assert.strictEqual(result.errorCode, null)
    assert.strictEqual(result.saved, true)
    assert.strictEqual(result.configRevision, 1)
    assert.deepStrictEqual(result.params, { lower: 35, upper: 45 })
    assert.deepStrictEqual(result.device, { mode: 'manual', fan: 'off' })

    const state = await dev.getState()
    assert.strictEqual(state.config.humidityLower, 35)
    assert.strictEqual(state.config.humidityUpper, 45)
    assert.strictEqual(state.config.configRevision, 1)
    assert.strictEqual(state.config.configStatus, 'ok')
    assert.strictEqual(state.config.updatedAt, NOW)
    assert.strictEqual(dev.getConfig().humidityLower, 35)
  })

  h.it('accepts a valid sensorKind and reports it in state', async function () {
    const dev = make()
    const result = await send(
      dev,
      'set_thresholds',
      { lower: 35, upper: 45, sensorKind: 'soil_relative' },
      'r1'
    )
    assert.strictEqual(result.status, 'applied')
    const state = await dev.getState()
    assert.strictEqual(state.sensor.kind, 'soil_relative')
    assert.strictEqual(state.config.sensorKind, 'soil_relative')
  })

  h.it('rejects invalid ranges and non-integers without changing config', async function () {
    const dev = make()

    const inverted = await send(dev, 'set_thresholds', { lower: 40, upper: 30 }, 'bad1')
    assert.strictEqual(inverted.status, 'rejected')
    assert.strictEqual(inverted.errorCode, 'INVALID_THRESHOLD_RANGE')
    assert.strictEqual(inverted.saved, false)
    assert.strictEqual(inverted.configRevision, null)

    const fractional = await send(dev, 'set_thresholds', { lower: 30.5, upper: 40 }, 'bad2')
    assert.strictEqual(fractional.errorCode, 'INVALID_PAYLOAD')

    const negative = await send(dev, 'set_thresholds', { lower: -1, upper: 40 }, 'bad3')
    assert.strictEqual(negative.errorCode, 'INVALID_THRESHOLD_RANGE')

    const tooHigh = await send(dev, 'set_thresholds', { lower: 0, upper: 101 }, 'bad4')
    assert.strictEqual(tooHigh.errorCode, 'INVALID_THRESHOLD_RANGE')

    const stringy = await send(dev, 'set_thresholds', { lower: '30', upper: '40' }, 'bad5')
    assert.strictEqual(stringy.errorCode, 'INVALID_PAYLOAD')

    const config = dev.getConfig()
    assert.strictEqual(config.humidityLower, 30)
    assert.strictEqual(config.humidityUpper, 40)
    assert.strictEqual(config.configRevision, 0)
  })

  h.it('does not bump revision when the thresholds are unchanged', async function () {
    const dev = make()
    await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'r1')
    const again = await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'r2')
    assert.strictEqual(again.status, 'applied')
    assert.strictEqual(again.unchanged, true)
    assert.strictEqual(again.saved, true)
    assert.strictEqual(again.configRevision, 1)
    assert.strictEqual((await dev.getState()).config.configRevision, 1)
  })

  h.it('is idempotent for the same requestId+params and rejects conflicting params', async function () {
    const dev = make()
    const first = await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'dup-1')
    assert.strictEqual(first.configRevision, 1)

    const replay = await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'dup-1')
    assert.strictEqual(replay.status, 'applied')
    assert.strictEqual(replay.idempotent, true)
    assert.strictEqual(replay.configRevision, 1)
    assert.strictEqual(replay.saved, true)

    const conflict = await send(dev, 'set_thresholds', { lower: 36, upper: 46 }, 'dup-1')
    assert.strictEqual(conflict.status, 'rejected')
    assert.strictEqual(conflict.errorCode, 'DUPLICATE_CONFLICT')

    const config = dev.getConfig()
    assert.strictEqual(config.humidityLower, 35)
    assert.strictEqual(config.humidityUpper, 45)
    assert.strictEqual(config.configRevision, 1)
  })

  h.it('rejects on expectedRevision mismatch and accepts the current revision', async function () {
    const dev = make()
    await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'rev-1')
    assert.strictEqual(dev.getConfig().configRevision, 1)

    const stale = await send(dev, 'set_thresholds', { lower: 36, upper: 46 }, 'rev-2', 0)
    assert.strictEqual(stale.status, 'rejected')
    assert.strictEqual(stale.errorCode, 'REVISION_CONFLICT')
    assert.strictEqual(dev.getConfig().configRevision, 1)
    assert.strictEqual(dev.getConfig().humidityLower, 35)

    const current = await send(dev, 'set_thresholds', { lower: 36, upper: 46 }, 'rev-3', 1)
    assert.strictEqual(current.status, 'applied')
    assert.strictEqual(current.configRevision, 2)
    assert.strictEqual(dev.getConfig().humidityLower, 36)
  })

  h.it('rejects NV write / verify faults without changing config', async function () {
    const dev = make()

    dev.setFaults({ nvWriteError: true })
    const writeFailed = await send(dev, 'set_thresholds', { lower: 20, upper: 30 }, 'nv-1')
    assert.strictEqual(writeFailed.status, 'rejected')
    assert.strictEqual(writeFailed.errorCode, 'NV_WRITE_FAILED')
    assert.strictEqual(dev.getConfig().configRevision, 0)
    assert.strictEqual(dev.getConfig().humidityLower, 30)

    dev.setFaults({ nvWriteError: false, nvVerifyError: true })
    const verifyFailed = await send(dev, 'set_thresholds', { lower: 20, upper: 30 }, 'nv-2')
    assert.strictEqual(verifyFailed.status, 'rejected')
    assert.strictEqual(verifyFailed.errorCode, 'NV_VERIFY_FAILED')

    dev.setFaults({ nvVerifyError: false })
    const applied = await send(dev, 'set_thresholds', { lower: 20, upper: 30 }, 'nv-3')
    assert.strictEqual(applied.status, 'applied')
    assert.strictEqual(applied.configRevision, 1)
    assert.strictEqual(dev.getConfig().humidityLower, 20)
  })
})

h.describe('mock-device set_security_config', function () {
  h.it('applies flame thresholds and alarmEnabled, bumping revision', async function () {
    const dev = make()
    const result = await send(
      dev,
      'set_security_config',
      { flameTrip: 300, flameClear: 200, alarmEnabled: false },
      'sec-1'
    )
    assert.strictEqual(result.status, 'applied')
    assert.strictEqual(result.saved, true)
    assert.strictEqual(result.configRevision, 1)
    const state = await dev.getState()
    assert.strictEqual(state.config.flameTrip, 300)
    assert.strictEqual(state.config.flameClear, 200)
    assert.strictEqual(state.config.alarmEnabled, false)
  })

  h.it('rejects inverted and out-of-range flame thresholds', async function () {
    const dev = make()
    const inverted = await send(dev, 'set_security_config', { flameTrip: 100, flameClear: 200 }, 'sec-bad1')
    assert.strictEqual(inverted.status, 'rejected')
    assert.strictEqual(inverted.errorCode, 'INVALID_THRESHOLD_RANGE')

    const outOfRange = await send(dev, 'set_security_config', { flameTrip: 5000, flameClear: 200 }, 'sec-bad2')
    assert.strictEqual(outOfRange.status, 'rejected')
    assert.strictEqual(outOfRange.errorCode, 'INVALID_PAYLOAD')
    assert.strictEqual(dev.getConfig().configRevision, 0)
  })

  // set_security_config 只检查 nvWriteError，漏了 nvVerifyError（set_mode/set_thresholds 都检查了）。
  h.it('set_security_config should reject NV_VERIFY_FAILED', async function () {
    const dev = make()
    dev.setFaults({ nvVerifyError: true })
    const result = await send(dev, 'set_security_config', { flameTrip: 300, flameClear: 200 }, 'sec-nv')
    assert.strictEqual(result.status, 'rejected')
    assert.strictEqual(result.errorCode, 'NV_VERIFY_FAILED')
  })
})

h.describe('mock-device set_fan / set_mode', function () {
  h.it('sets fan output and forces manual mode', async function () {
    const dev = make()
    const result = await send(dev, 'set_fan', { value: 'ON' }, 'fan-1')
    assert.strictEqual(result.status, 'applied')
    assert.strictEqual(result.saved, false)
    assert.deepStrictEqual(result.device, { mode: 'manual', fan: 'on' })

    const state = await dev.getState()
    assert.strictEqual(state.actuators.fan, 'on')
    assert.strictEqual(state.mode, 'manual')

    const invalid = await send(dev, 'set_fan', { value: 'on' }, 'fan-2')
    assert.strictEqual(invalid.status, 'rejected')
    assert.strictEqual(invalid.errorCode, 'INVALID_PAYLOAD')
  })

  h.it('switches mode, persists it and bumps revision', async function () {
    const dev = make()
    const auto = await send(dev, 'set_mode', { mode: 'auto' }, 'mode-1')
    assert.strictEqual(auto.status, 'applied')
    assert.strictEqual(auto.saved, true)
    assert.strictEqual(auto.configRevision, 1)
    assert.deepStrictEqual(auto.device, { mode: 'auto', fan: 'off' })

    const state = await dev.getState()
    assert.strictEqual(state.mode, 'auto')
    assert.strictEqual(dev.getConfig().mode, 'auto')

    const invalid = await send(dev, 'set_mode', { mode: 'bogus' }, 'mode-2')
    assert.strictEqual(invalid.status, 'rejected')
    assert.strictEqual(invalid.errorCode, 'INVALID_PAYLOAD')
  })

  h.it('drives the fan in auto mode according to threshold direction', async function () {
    const dev = make()

    // 湿度被 mock 限制在 20–80：99/100 必然低于下限 -> 开；0/1 必然高于上限 -> 关。
    assert.strictEqual((await send(dev, 'set_thresholds', { lower: 99, upper: 100 }, 'auto-1')).status, 'applied')
    assert.strictEqual((await send(dev, 'set_mode', { mode: 'auto' }, 'auto-2')).status, 'applied')
    let state = await dev.getState()
    assert.strictEqual(state.mode, 'auto')
    assert.strictEqual(state.actuators.fan, 'on')

    assert.strictEqual((await send(dev, 'set_thresholds', { lower: 0, upper: 1 }, 'auto-3')).status, 'applied')
    state = await dev.getState()
    assert.strictEqual(state.mode, 'auto')
    assert.strictEqual(state.actuators.fan, 'off')

    // 19/100：湿度必然落在区间内，保持当前输出（off）。
    assert.strictEqual((await send(dev, 'set_thresholds', { lower: 19, upper: 100 }, 'auto-4')).status, 'applied')
    state = await dev.getState()
    assert.strictEqual(state.actuators.fan, 'off')
  })

  // set_fan 计算了 revisionError 但没有使用，expectedRevision 被忽略。
  h.it('set_fan should reject on expectedRevision mismatch', async function () {
    const dev = make()
    await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'rev-setup')
    const result = await send(dev, 'set_fan', { value: 'ON' }, 'fan-rev', 0)
    assert.strictEqual(result.status, 'rejected')
    assert.strictEqual(result.errorCode, 'REVISION_CONFLICT')
  })
})

h.describe('mock-device alarm lock', function () {
  h.it('rejects fan / auto mode / acknowledge while active, and stops the fan', async function () {
    const dev = make()
    const triggered = await send(dev, 'mock_alarm', { status: 'active' }, 'alarm-1')
    assert.strictEqual(triggered.status, 'applied')
    assert.strictEqual(triggered.saved, false)

    const state = await dev.getState()
    assert.strictEqual(state.alarm.status, 'active')
    assert.strictEqual(state.alarm.id.indexOf('alarm-'), 0)
    assert.strictEqual(state.alarm.since, NOW)
    assert.strictEqual(state.actuators.fan, 'off')

    const fan = await send(dev, 'set_fan', { value: 'ON' }, 'alarm-2')
    assert.strictEqual(fan.status, 'rejected')
    assert.strictEqual(fan.errorCode, 'ALARM_LOCKED')

    const mode = await send(dev, 'set_mode', { mode: 'auto' }, 'alarm-3')
    assert.strictEqual(mode.status, 'rejected')
    assert.strictEqual(mode.errorCode, 'ALARM_LOCKED')

    const ack = await send(dev, 'acknowledge_alarm', {}, 'alarm-4')
    assert.strictEqual(ack.status, 'rejected')
    assert.strictEqual(ack.errorCode, 'ALARM_LOCKED')

    const invalid = await send(dev, 'mock_alarm', { status: 'boom' }, 'alarm-5')
    assert.strictEqual(invalid.status, 'rejected')
    assert.strictEqual(invalid.errorCode, 'INVALID_PAYLOAD')
  })

  h.it('acknowledges a clearing alarm, clears the lock and allows commands again', async function () {
    const dev = make()
    await send(dev, 'mock_alarm', { status: 'clearing' }, 'ack-1')
    let state = await dev.getState()
    assert.strictEqual(state.alarm.status, 'clearing')
    assert.strictEqual(state.alarm.since, NOW)

    const ack = await send(dev, 'acknowledge_alarm', {}, 'ack-2')
    assert.strictEqual(ack.status, 'applied')
    assert.strictEqual(ack.saved, false)
    assert.strictEqual(ack.device.alarm, 'normal')

    state = await dev.getState()
    assert.deepStrictEqual(state.alarm, { status: 'normal', id: null, since: null, muted: false })

    const fan = await send(dev, 'set_fan', { value: 'ON' }, 'ack-3')
    assert.strictEqual(fan.status, 'applied')
    assert.strictEqual((await dev.getState()).actuators.fan, 'on')
  })

  // 源码只在 mode === 'auto' 分支检查 ALARM_LOCKED，切到 manual 仍会成功。
  h.it('set_mode manual during active alarm should also be ALARM_LOCKED', async function () {
    const dev = make()
    await send(dev, 'mock_alarm', { status: 'active' }, 'lock-1')
    const result = await send(dev, 'set_mode', { mode: 'manual' }, 'lock-2')
    assert.strictEqual(result.status, 'rejected')
    assert.strictEqual(result.errorCode, 'ALARM_LOCKED')
  })
})

h.describe('mock-device faults', function () {
  h.it('rejects commands and reports offline state while offline', async function () {
    const dev = make()
    dev.setFaults({ offline: true })

    const result = await send(dev, 'set_fan', { value: 'ON' }, 'off-1')
    assert.strictEqual(result.status, 'rejected')
    assert.strictEqual(result.errorCode, 'DEVICE_OFFLINE')

    const state = await dev.getState()
    assert.strictEqual(state.online, false)
    assert.ok(state.sensor.humidity !== undefined)

    const health = await dev.health()
    assert.strictEqual(health.ok, false)
    assert.strictEqual(health.provider, 'mock')

    dev.setFaults({ offline: false })
    const recovered = await send(dev, 'set_fan', { value: 'ON' }, 'off-2')
    assert.strictEqual(recovered.status, 'applied')
  })

  h.it('reports sensor error quality with null humidity', async function () {
    const dev = make()
    dev.setFaults({ sensorError: true })
    const state = await dev.getState()
    assert.strictEqual(state.sensor.quality, 'error')
    assert.strictEqual(state.sensor.humidity, null)

    const auto = await send(dev, 'set_mode', { mode: 'auto' }, 'sensor-1')
    assert.strictEqual(auto.status, 'rejected')
    assert.strictEqual(auto.errorCode, 'SENSOR_INVALID')
  })

  h.it('exposes and clears the fault map', function () {
    const dev = make()
    const patched = dev.setFaults({ nvWriteError: true })
    assert.strictEqual(patched.nvWriteError, true)
    assert.deepStrictEqual(dev.getFaults(), {
      offline: false,
      sensorError: false,
      nvWriteError: true,
      nvVerifyError: false,
      slowMs: 0
    })
  })
})

h.describe('mock-device restart / reset', function () {
  h.it('restores config and revision from the same storage and keeps last request id idempotent', async function () {
    const storage = mock.createMemoryStorage()
    const first = make({ storage })
    await send(first, 'set_thresholds', { lower: 33, upper: 44 }, 'persist-1')
    await send(first, 'set_mode', { mode: 'auto' }, 'persist-2')

    const second = make({ storage })
    const config = second.getConfig()
    assert.strictEqual(config.humidityLower, 33)
    assert.strictEqual(config.humidityUpper, 44)
    assert.strictEqual(config.mode, 'auto')
    assert.strictEqual(config.configRevision, 2)

    const state = await second.getState()
    assert.strictEqual(state.mode, 'auto')
    assert.strictEqual(state.config.configRevision, 2)
    assert.strictEqual(state.config.humidityLower, 33)

    const replay = await send(second, 'set_mode', { mode: 'auto' }, 'persist-2')
    assert.strictEqual(replay.status, 'applied')
    assert.strictEqual(replay.idempotent, true)
    assert.strictEqual(replay.configRevision, 2)
    assert.strictEqual(second.getConfig().configRevision, 2)
  })

  h.it('reset restores defaults and writes them to storage', async function () {
    const storage = mock.createMemoryStorage()
    const dev = make({ storage })
    await send(dev, 'set_thresholds', { lower: 35, upper: 45 }, 'reset-1')
    assert.strictEqual(dev.getConfig().configRevision, 1)

    const health = await dev.reset()
    assert.strictEqual(health.ok, true)
    assert.strictEqual(dev.getConfig().configRevision, 0)
    assert.strictEqual(dev.getConfig().humidityLower, 30)

    const state = await dev.getState()
    assert.strictEqual(state.alarm.status, 'normal')
    assert.strictEqual(state.actuators.fan, 'off')
    assert.strictEqual(state.config.configRevision, 0)

    const fresh = make({ storage })
    assert.strictEqual(fresh.getConfig().humidityLower, 30)
    assert.strictEqual(fresh.getConfig().configRevision, 0)
  })
})

h.main('mock-device.test.js')
