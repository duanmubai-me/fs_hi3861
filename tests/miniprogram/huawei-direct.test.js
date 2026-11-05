'use strict'
// 只使用保留域名和伪造 wx.request；不读取真实账号，不访问云端，不控制实物。
const assert = require('node:assert/strict')
const path = require('node:path')
const h = require('./harness')
const { createHuaweiTransport, createWxFetch } = require(path.join(h.SM_ROOT, 'services/transport-huawei'))
const { normalizeState } = require(path.join(h.SM_ROOT, 'models/state'))
const config = require(path.join(h.SM_ROOT, 'config/index'))

const NOW = Date.UTC(2026, 10, 5)
const cloud = {
  iamEndpoint: 'iam.example.test', iotdaEndpoint: 'iotda.example.test',
  iamDomain: 'test-domain', iamUserName: 'test-user', iamPassword: 'test-password',
  projectId: 'test-project', deviceId: 'test-device', requestTimeoutMs: 25000
}
const env = { mode: 'gateway', baseUrl: 'https://iotda.example.test', deviceId: 'test-device', commandTimeoutMs: 25000 }

function setup(properties, options) {
  const opts = options || {}
  const calls = []
  let revoked = false
  global.wx = { request: function (request) {
    assert.match(request.url, /^https:\/\/[a-z]+\.example\.test\//, '离线测试禁止真实域名')
    calls.push(request)
    let data
    let statusCode = 200
    let header = {}
    if (request.url.includes('/auth/tokens')) {
      statusCode = 201
      header = { 'X-Subject-Token': 'fake-token' }
      data = { token: { expires_at: '2027-01-01T00:00:00Z' } }
    } else if (opts.revokeOnce && !revoked) {
      revoked = true
      statusCode = 401
      data = {}
    } else if (request.url.endsWith('/shadow')) {
      data = { shadow: [{ service_id: 'base', reported: { properties: properties, event_time: '20261105T000000Z' } }] }
    } else if (request.url.endsWith('/commands')) {
      data = opts.commandResult || { command_id: 'cloud-command', response: { result_code: 0 } }
    } else {
      data = { status: 'ONLINE' }
    }
    setImmediate(function () { request.success({ statusCode, header, data }) })
    return { abort: function () {} }
  } }
  const transport = createHuaweiTransport(env, { huaweiConfig: cloud, now: function () { return NOW } })
  return { calls, transport }
}

h.describe('Huawei direct request chain', function () {
  h.it('authenticates once, queries base shadow, and uses no computer backend', async function () {
    const test = setup({ temperature: 25, humidity: 45, humi_down: 30, humi_up: 60, fan: 'OFF', autoMode: 'OFF' })
    const raw = await test.transport.getState()
    await test.transport.getState()
    assert.equal(raw.sensor.temperature, 25)
    assert.equal(raw.config.humidityLower, 30)
    assert.equal(raw.config.configRevision, null)
    assert.equal(raw.config.configStatus, 'unconfirmed')
    assert.equal(normalizeState(raw, { now: NOW }).config.configRevision, null)
    assert.equal(test.calls.filter(call => call.url.includes('/auth/tokens')).length, 1)
    assert.equal(test.calls.some(call => call.url.includes('/api/v1/')), false)
  })

  h.it('refreshes a revoked token once and continues the read', async function () {
    const test = setup({ humidity: 40 }, { revokeOnce: true })
    await test.transport.getState()
    assert.equal(test.calls.filter(call => call.url.includes('/auth/tokens')).length, 2)
  })

  h.it('accepts old firmware humidity commands without inventing a Flash save', async function () {
    const test = setup({ humidity: 40, humi_down: 30, humi_up: 60 })
    const result = await test.transport.sendCommand('set_thresholds', { lower: 32, upper: 62 }, { requestId: 'r1', expectedRevision: 0 })
    const sent = test.calls.find(call => call.url.endsWith('/commands'))
    assert.deepEqual(JSON.parse(sent.data), { service_id: 'control', command_name: 'humidity', paras: { down: 32, up: 62 } })
    assert.equal(result.status, 'applied')
    assert.equal(result.saved, false)
  })

  h.it('does not equate echoed thresholds or revision with Flash success', async function () {
    const test = setup({ configRevision: 4 }, { commandResult: { command_id: 'c1', response: { result_code: 0, paras: { down: 30, up: 60, configRevision: 5 } } } })
    const result = await test.transport.sendCommand('set_thresholds', { lower: 30, upper: 60 }, { requestId: 'r2', expectedRevision: 4 })
    assert.equal(result.status, 'applied')
    assert.equal(result.saved, false)
  })

  h.it('honors an explicit saved=true device response', async function () {
    const test = setup({ configRevision: 4 }, { commandResult: { command_id: 'c1', response: { result_code: 0, paras: { saved: true, configRevision: 5 } } } })
    const result = await test.transport.sendCommand('set_thresholds', { lower: 30, upper: 60 }, { requestId: 'r3', expectedRevision: 4 })
    assert.equal(result.saved, true)
    assert.equal(result.configRevision, 5)
  })

  h.it('blocks an actual revision conflict before sending any command', async function () {
    const test = setup({ configRevision: 4 })
    const result = await test.transport.sendCommand('set_thresholds', { lower: 30, upper: 60 }, { requestId: 'r4', expectedRevision: 3 })
    assert.equal(result.status, 'rejected')
    assert.equal(result.errorCode, 'REVISION_CONFLICT')
    assert.equal(test.calls.some(call => call.url.endsWith('/commands')), false)
  })

  h.it('blocks unsupported alarm commands even if old firmware would ACK anything', async function () {
    const test = setup({ humidity: 40, flameDetected: false, flameValid: true })
    const result = await test.transport.sendCommand('acknowledge_alarm', {}, { requestId: 'r5' })
    assert.equal(result.errorCode, 'UNSUPPORTED_CAPABILITY')
    assert.equal(test.calls.some(call => call.url.endsWith('/commands')), false)
  })

  h.it('does not treat an accepted command without a device response as executed', async function () {
    const test = setup({}, { commandResult: { command_id: 'c1' } })
    const result = await test.transport.sendCommand('set_fan', { value: 'OFF' }, { requestId: 'r6' })
    assert.notEqual(result.status, 'applied')
    assert.equal(result.saved, false)
  })

  h.it('rejects concurrent commands rather than repeating physical operations', async function () {
    const test = setup({})
    const first = test.transport.sendCommand('set_fan', { value: 'OFF' }, { requestId: 'r7' })
    await assert.rejects(test.transport.sendCommand('set_fan', { value: 'ON' }, { requestId: 'r8' }), error => error.code === 'BUSY')
    await first
    assert.equal(test.calls.filter(call => call.url.endsWith('/commands')).length, 1)
  })

  h.it('displays digital flame separately and hides stale invalid sensor readings', async function () {
    const test = setup({ humidity: 40, co2: 500, tvoc: 10, sgpValid: false, combustibleRaw: 140, gasValid: false, flameDetected: true, flameValid: true })
    const raw = await test.transport.getState()
    const view = normalizeState(raw, { now: NOW })
    assert.equal(raw.gas.eco2, null)
    assert.equal(raw.gas.combustibleRaw, null)
    assert.equal(view.flame.digital, true)
    assert.equal(view.flame.text, '检测到火焰')
    assert.equal(view.flame.raw, null)
  })

  h.it('disallows HTTP requests and reports request failures without request bodies', async function () {
    const fetch = createWxFetch()
    await assert.rejects(fetch('http://iotda.example.test', {}), /HTTPS/)
    global.wx = { request: function (request) { request.fail({ errMsg: 'test-password' }) } }
    await assert.rejects(fetch('https://iotda.example.test', {}), error => !error.message.includes('test-password'))
  })

  h.it('migrates old localhost settings once; preserves later explicit mock selection', function () {
    const store = { 'smartfarm.env.v1': { mode: 'mock', baseUrl: 'http://127.0.0.1:8080', deviceId: 'old' } }
    global.wx = { getStorageSync: key => store[key], setStorageSync: (key, value) => { store[key] = value } }
    const migrated = config.getEnv()
    assert.equal(migrated.mode, 'gateway')
    assert.notEqual(migrated.baseUrl, 'http://127.0.0.1:8080')
    config.setEnv({ mode: 'mock' })
    assert.equal(config.getEnv().mode, 'mock')
    assert.equal(JSON.stringify(store[config.STORAGE_KEY]).includes('iamPassword'), false)
    config.resetEnv()
    assert.equal(config.getEnv().mode, 'gateway')
  })
})

h.main('huawei-direct.test.js')
