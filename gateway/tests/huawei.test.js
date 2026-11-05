'use strict'

// 华为云 IoTDA provider 离线单元测试。
//
// 全部通过注入的假 fetch 完成：不读取 config/local.json 的真实凭据，
// 不访问任何真实网络。所有请求 URL 都会断言只指向 *.example.test。
//
// 运行：node gateway/tests/huawei.test.js   （或 cd gateway && npm test）

const assert = require('node:assert/strict')

const { createHuaweiProvider } = require('../src/providers/huawei')

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0)
const PROJECT_ID = 'test-project-id'
const DEVICE_ID = 'test-device-001'
const IAM_BASE = 'https://iam.example.test'
const IOTDA_BASE = 'https://iotda.example.test'
const IAM_URL = IAM_BASE + '/v3/auth/tokens?nocatalog=true'
const DEVICE_URL = IOTDA_BASE + '/v5/iot/' + PROJECT_ID + '/devices/' + DEVICE_ID
const SHADOW_URL = DEVICE_URL + '/shadow'
const COMMAND_URL = DEVICE_URL + '/commands'

const HUAWEI_CONFIG = {
  iotdaEndpoint: 'iotda.example.test',
  projectId: PROJECT_ID,
  iamEndpoint: 'iam.example.test',
  iamDomain: 'test-domain',
  iamUserName: 'test-user',
  iamPassword: 'test-password',
  verifyTls: true,
  deviceId: DEVICE_ID
}

let groupCount = 0

function ok(label) {
  groupCount += 1
  console.log('[huawei] ' + label + ' OK')
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    return null
  }
}

function normalizeHeaders(headers) {
  const out = {}
  Object.keys(headers || {}).forEach(function (key) {
    out[String(key).toLowerCase()] = String(headers[key])
  })
  return out
}

function makeResponse(result) {
  const status = result.status === undefined ? 200 : result.status
  const headers = normalizeHeaders(result.headers)
  const text = result.body === undefined
    ? ''
    : (typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
  return {
    status: status,
    ok: status >= 200 && status < 300,
    headers: {
      get: function (name) {
        return headers[String(name).toLowerCase()] || null
      }
    },
    text: async function () {
      return text
    },
    json: async function () {
      return text ? JSON.parse(text) : null
    }
  }
}

function createFakeFetch(handler) {
  const calls = []
  async function fetchImpl(url, init) {
    const call = {
      url: String(url),
      method: (init && init.method) || 'GET',
      headers: normalizeHeaders(init && init.headers),
      body: init && typeof init.body === 'string' ? parseJson(init.body) : null
    }
    calls.push(call)
    const result = await handler(call, init)
    if (result === undefined) {
      throw new Error('测试收到未预期的请求：' + call.method + ' ' + call.url)
    }
    return makeResponse(result)
  }
  return { fetchImpl: fetchImpl, calls: calls }
}

function isIam(call) {
  return call.method === 'POST' && call.url === IAM_URL
}

function isDevice(call) {
  return call.method === 'GET' && call.url === DEVICE_URL
}

function isShadow(call) {
  return call.method === 'GET' && call.url === SHADOW_URL
}

function isCommand(call) {
  return call.method === 'POST' && call.url === COMMAND_URL
}

function iamOk(token) {
  return {
    status: 201,
    headers: { 'x-subject-token': token },
    body: { token: { expires_at: '2099-01-01T00:00:00.000Z' } }
  }
}

function deviceOk(status) {
  return {
    status: 200,
    body: {
      device_id: DEVICE_ID,
      node_id: DEVICE_ID,
      status: status || 'ONLINE'
    }
  }
}

function shadowOk(properties) {
  return {
    status: 200,
    body: {
      device_id: DEVICE_ID,
      shadow: [
        {
          service_id: 'control',
          desired: {},
          reported: {
            properties: properties,
            event_time: '20260101T000000Z'
          },
          version: 3
        }
      ]
    }
  }
}

function commandOk(commandId, response) {
  return {
    status: 200,
    body: {
      command_id: commandId,
      response: response
    }
  }
}

function assertFakeHostsOnly(fake) {
  assert.ok(fake.calls.length > 0, '预期至少有一次假 fetch 调用')
  fake.calls.forEach(function (call) {
    assert.ok(
      call.url.indexOf(IAM_BASE + '/') === 0 || call.url.indexOf(IOTDA_BASE + '/') === 0,
      '出现非假接口请求（可能尝试访问真实网络）：' + call.url
    )
  })
}

function createProvider(fake, huaweiConfig) {
  return createHuaweiProvider(
    { provider: 'huawei', deviceId: DEVICE_ID, huawei: huaweiConfig || HUAWEI_CONFIG },
    { fetchImpl: fake.fetchImpl, now: function () { return NOW } }
  )
}

async function testMissingConfig() {
  const fake = createFakeFetch(function () {
    throw new Error('未配置时不应发起网络请求')
  })
  const provider = createHuaweiProvider(
    { provider: 'huawei', deviceId: DEVICE_ID, huawei: null },
    { fetchImpl: fake.fetchImpl, now: function () { return NOW } }
  )

  const health = await provider.health()
  assert.equal(health.ok, false, '未配置时 health.ok 必须为 false')
  assert.equal(health.provider, 'huawei')
  assert.equal(health.configured, false)
  assert.match(health.note, /iotdaEndpoint/, 'health.note 应列出缺失字段名')
  assert.match(health.note, /iamPassword/)

  await assert.rejects(provider.getState(), function (err) {
    return err && err.code === 'NOT_IMPLEMENTED'
  }, '未配置时 getState 应抛 NOT_IMPLEMENTED')

  await assert.rejects(provider.sendCommand('set_fan', { value: 'ON' }, { requestId: 'missing-1' }), function (err) {
    return err && err.code === 'NOT_IMPLEMENTED'
  }, '未配置时 sendCommand 应抛 NOT_IMPLEMENTED')

  assert.equal(fake.calls.length, 0, '未配置时不得发起任何 HTTP 请求')
  assert.equal(provider.implemented, true, 'provider 实现已存在，implemented 应为 true')
  assert.equal(provider.configured, false)

  const partialFake = createFakeFetch(function () {
    throw new Error('缺字段时不应发起网络请求')
  })
  const partialConfig = Object.assign({}, HUAWEI_CONFIG)
  delete partialConfig.iamPassword
  const partial = createProvider(partialFake, partialConfig)
  const partialHealth = await partial.health()
  assert.equal(partialHealth.configured, false)
  assert.deepEqual(partialHealth.missing, ['iamPassword'])
  assert.equal(partialHealth.note.indexOf('test-password'), -1, 'health.note 不得包含密码值')
  assert.equal(partialFake.calls.length, 0)

  ok('缺配置：health configured=false，getState/sendCommand 抛 NOT_IMPLEMENTED，零网络')
}

async function testIamAndStateMapping() {
  const properties = {
    sensorKind: 'air_rh',
    humidity: 45.5,
    temperature: 26.3,
    fan: 'ON',
    autoMode: 'ON',
    humi_down: 30,
    humi_up: 40,
    configRevision: 7,
    flameTrip: 160,
    flameClear: 120,
    alarmEnabled: true,
    eco2: 430,
    tvoc: 16,
    flame: 130,
    motor: 'forward',
    board: 'FS-Hi3861',
    firmware: '1.2.3',
    supportsMotorReverse: true,
    bootId: 'boot-cloud-1',
    seq: 9,
    uptimeMs: 123456,
    alarmStatus: 'normal',
    sampledAt: 1700000000000
  }

  const fake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-state-1')
    if (isDevice(call)) return deviceOk('ONLINE')
    if (isShadow(call)) return shadowOk(properties)
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const provider = createProvider(fake)

  const state = await provider.getState()

  assert.equal(state.deviceId, DEVICE_ID)
  assert.equal(state.online, true)
  assert.equal(state.receivedAt, NOW)
  assert.equal(state.bootId, 'boot-cloud-1')
  assert.equal(state.seq, 9)
  assert.equal(state.uptimeMs, 123456)

  assert.equal(state.sensor.kind, 'air_rh')
  assert.equal(state.sensor.humidity, 45.5)
  assert.equal(state.sensor.temperature, 26.3)
  assert.equal(state.sensor.quality, 'ok')
  assert.equal(state.sensor.sampledAt, 1700000000000)

  assert.equal(state.actuators.fan, 'on')
  assert.equal(state.actuators.motor, 'forward')
  assert.equal(state.mode, 'auto')
  assert.equal(state.alarm.status, 'normal')
  assert.equal(state.alarm.muted, false)

  assert.equal(state.config.humidityLower, 30)
  assert.equal(state.config.humidityUpper, 40)
  assert.equal(state.config.flameTrip, 160)
  assert.equal(state.config.flameClear, 120)
  assert.equal(state.config.alarmEnabled, true)
  assert.equal(state.config.configRevision, 7)

  assert.equal(state.gas.eco2, 430)
  assert.equal(state.gas.tvoc, 16)
  assert.equal(state.gas.combustibleRaw, null)
  assert.equal(state.gas.quality, 'ok')
  assert.equal(state.flame.raw, 130)
  assert.equal(state.flame.quality, 'ok')

  assert.equal(state.capabilities.board, 'FS-Hi3861')
  assert.equal(state.capabilities.firmware, '1.2.3')
  assert.equal(state.capabilities.supportsMotorReverse, true)
  assert.deepEqual(state.capabilities.gas, { eco2: true, tvoc: true, combustible: false })
  assert.equal(state.capabilities.flame.available, true)
  assert.deepEqual(state.capabilities.flame.rawRange, [0, 4095])
  assert.equal(state.capabilities.flame.direction, 'up')
  assert.deepEqual(state.capabilities.calibrated, { combustible: false })

  const iamCalls = fake.calls.filter(isIam)
  const deviceCalls = fake.calls.filter(isDevice)
  const shadowCalls = fake.calls.filter(isShadow)
  assert.equal(iamCalls.length, 1)
  assert.equal(deviceCalls.length, 1)
  assert.equal(shadowCalls.length, 1)

  const iamBody = iamCalls[0].body
  assert.deepEqual(iamBody.auth.identity.methods, ['password'])
  assert.equal(iamBody.auth.identity.password.user.name, 'test-user')
  assert.equal(iamBody.auth.identity.password.user.domain.name, 'test-domain')
  assert.equal(iamBody.auth.identity.password.user.password, 'test-password')
  assert.deepEqual(iamBody.auth.scope.project, { id: PROJECT_ID })
  assert.equal(iamCalls[0].headers['content-type'], 'application/json;charset=utf8')

  assert.equal(deviceCalls[0].headers['x-auth-token'], 'token-state-1')
  assert.equal(shadowCalls[0].headers['x-auth-token'], 'token-state-1')
  assert.equal(deviceCalls[0].url, DEVICE_URL)
  assert.equal(shadowCalls[0].url, SHADOW_URL)
  assert.equal(deviceCalls[0].url.indexOf('password'), -1)
  assert.equal(shadowCalls[0].url.indexOf('password'), -1)

  // 第二次读状态应复用 IAM token，不再重新鉴权。
  await provider.getState()
  assert.equal(fake.calls.filter(isIam).length, 1, 'IAM token 应被缓存复用')
  assert.equal(fake.calls.filter(isDevice).length, 2)
  assert.equal(fake.calls.filter(isShadow).length, 2)

  assertFakeHostsOnly(fake)
  ok('IAM 登录取 token、请求头 X-Auth-Token、设备+影子映射 RawState、token 缓存')
}

async function testOfflineAndMissingShadow() {
  const offlineFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-offline')
    if (isDevice(call)) return deviceOk('OFFLINE')
    if (isShadow(call)) {
      return { status: 404, body: { error_code: 'IOTDA.014112', error_msg: 'shadow not found' } }
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const offlineState = await createProvider(offlineFake).getState()
  assert.equal(offlineState.online, false)
  assert.equal(offlineState.sensor.quality, 'error')
  assert.equal(offlineState.sensor.humidity, null, '缺失湿度必须是 null，不能补 0')
  assert.equal(offlineState.sensor.temperature, null)
  assert.equal(offlineState.config.humidityLower, undefined, '缺失阈值不得补 0')
  assert.equal(offlineState.config.humidityUpper, undefined)
  assert.equal(offlineState.config.configRevision, null)
  assert.equal(offlineState.gas.eco2, null)
  assert.equal(offlineState.gas.quality, 'not_configured')
  assert.equal(offlineState.flame.raw, null)
  assert.equal(offlineState.flame.quality, 'ok')
  assert.equal(offlineState.capabilities.gas.eco2, false)
  assert.equal(offlineState.capabilities.flame.available, false)
  assert.equal(offlineState.actuators.fan, 'off')
  assert.equal(offlineState.actuators.motor, null)
  assert.equal(offlineState.mode, 'manual')
  assert.equal(offlineState.alarm.status, 'normal')

  // 设备在线但影子 404：仍然返回 RawState，quality=error，数值为 null。
  const noShadowFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-no-shadow')
    if (isDevice(call)) return deviceOk('online')
    if (isShadow(call)) return { status: 404, body: { error_code: 'IOTDA.014112' } }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const noShadowState = await createProvider(noShadowFake).getState()
  assert.equal(noShadowState.online, true, '小写 online 也应识别为在线')
  assert.equal(noShadowState.sensor.quality, 'error')
  assert.equal(noShadowState.sensor.humidity, null)

  // 影子存在但没有任何传感器属性：quality=not_configured，不是 0。
  const emptyShadowFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-empty-shadow')
    if (isDevice(call)) return deviceOk('ONLINE')
    if (isShadow(call)) return shadowOk({})
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const emptyState = await createProvider(emptyShadowFake).getState()
  assert.equal(emptyState.online, true)
  assert.equal(emptyState.sensor.quality, 'not_configured')
  assert.equal(emptyState.sensor.humidity, null)
  assert.equal(emptyState.capabilities.gas.eco2, false)

  assertFakeHostsOnly(offlineFake)
  assertFakeHostsOnly(noShadowFake)
  assertFakeHostsOnly(emptyShadowFake)
  ok('离线/影子缺失容错：online=false、quality=error/not_configured、null 不变成 0')
}

async function testCommands() {
  const responses = [
    commandOk('cmd-thresholds', {
      result_code: 0,
      response_name: 'COMMAND_RESPONSE',
      paras: { saved: true, configRevision: 6, lower: 35, upper: 45 }
    }),
    commandOk('cmd-fan-reject', {
      result_code: 7,
      response_name: 'COMMAND_RESPONSE',
      paras: { errorCode: 'ALARM_LOCKED', message: 'alarm is active' }
    }),
    commandOk('cmd-mode', {
      result_code: 0,
      paras: { saved: true, configRevision: 8, mode: 'auto' }
    }),
    commandOk('cmd-ack', {
      result_code: 0,
      paras: {}
    }),
    commandOk('cmd-silent', null)
  ]
  let commandIndex = 0
  const fake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-command')
    if (isCommand(call)) {
      const response = responses[commandIndex]
      commandIndex += 1
      return response
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const provider = createProvider(fake)

  const thresholds = await provider.sendCommand('set_thresholds', { lower: 35, upper: 45 }, {
    requestId: 'set_thresholds-cmd-1'
  })
  assert.equal(thresholds.status, 'applied')
  assert.equal(thresholds.saved, true)
  assert.equal(thresholds.configRevision, 6)
  assert.equal(thresholds.platformCommandId, 'cmd-thresholds')
  assert.equal(thresholds.platformResultCode, 0)
  assert.deepEqual(thresholds.params, { lower: 35, upper: 45 })

  const fan = await provider.sendCommand('set_fan', { value: 'ON' }, { requestId: 'set_fan-cmd-2' })
  assert.equal(fan.status, 'rejected')
  assert.equal(fan.errorCode, 'ALARM_LOCKED')
  assert.equal(fan.platformCommandId, 'cmd-fan-reject')
  assert.equal(fan.platformResultCode, 7)
  assert.equal(fan.saved, false)
  assert.equal(fan.configRevision, null)
  assert.equal(fan.message.indexOf('alarm is active') >= 0, true)
  assert.deepEqual(fan.params, { value: 'ON' })

  const mode = await provider.sendCommand('set_mode', { mode: 'auto' }, { requestId: 'set_mode-cmd-3' })
  assert.equal(mode.status, 'applied')
  assert.equal(mode.saved, true)
  assert.equal(mode.configRevision, 8)
  assert.deepEqual(mode.params, { mode: 'auto' })

  const ack = await provider.sendCommand('acknowledge_alarm', {}, { requestId: 'ack-cmd-4' })
  assert.equal(ack.status, 'applied')
  assert.equal(ack.saved, false)
  assert.deepEqual(ack.params, {})
  assert.equal(ack.platformCommandId, 'cmd-ack')

  const silent = await provider.sendCommand('set_fan', { value: 'OFF' }, { requestId: 'set_fan-cmd-5' })
  assert.equal(silent.status, 'unknown', '没有设备 response 时不得伪造 applied')
  assert.equal(silent.errorCode, 'TIMEOUT')
  assert.equal(silent.platformCommandId, 'cmd-silent')
  assert.equal(silent.appliedAt, null)

  const callsBeforeUnsupported = fake.calls.length
  const unsupported = await provider.sendCommand('mock_alarm', { status: 'active' }, {
    requestId: 'mock-alarm-6'
  })
  assert.equal(unsupported.status, 'rejected')
  assert.equal(unsupported.errorCode, 'UNSUPPORTED_CAPABILITY')
  assert.equal(fake.calls.length, callsBeforeUnsupported, '不支持的动作不得发云命令')

  const commandCalls = fake.calls.filter(isCommand)
  assert.equal(commandCalls.length, 5)
  assert.deepEqual(commandCalls[0].body, {
    service_id: 'control',
    command_name: 'humidity',
    paras: { up: 45, down: 35 }
  })
  assert.deepEqual(commandCalls[1].body, {
    service_id: 'control',
    command_name: 'fan',
    paras: { value: 'ON' }
  })
  assert.deepEqual(commandCalls[2].body, {
    service_id: 'control',
    command_name: 'autoMode',
    paras: { value: 'ON' }
  })
  assert.deepEqual(commandCalls[3].body, {
    service_id: 'control',
    command_name: 'acknowledgeAlarm',
    paras: {}
  })
  assert.deepEqual(commandCalls[4].body, {
    service_id: 'control',
    command_name: 'fan',
    paras: { value: 'OFF' }
  })
  assert.equal(commandCalls[0].headers['x-auth-token'], 'token-command')

  assertFakeHostsOnly(fake)
  ok('命令映射：set_thresholds/set_fan/set_mode/acknowledge_alarm、command_id、applied/rejected、unknown 不伪造')
}

async function testExpectedRevision() {
  let posted = 0
  const fake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-revision')
    if (isShadow(call)) return shadowOk({ configRevision: 2, humi_down: 30, humi_up: 40 })
    if (isCommand(call)) {
      posted += 1
      return commandOk('cmd-revision-' + posted, {
        result_code: 0,
        paras: { saved: true, configRevision: 3 }
      })
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const provider = createProvider(fake)

  const conflict = await provider.sendCommand('set_thresholds', { lower: 30, upper: 40 }, {
    requestId: 'revision-conflict',
    expectedRevision: 1
  })
  assert.equal(conflict.status, 'rejected')
  assert.equal(conflict.errorCode, 'REVISION_CONFLICT')
  assert.equal(posted, 0, '版本冲突必须在本地拒绝，不发送云命令')
  assert.equal(conflict.message.indexOf('期望 1') >= 0, true)
  assert.equal(conflict.message.indexOf('当前 2') >= 0, true)

  const matched = await provider.sendCommand('set_thresholds', { lower: 30, upper: 40 }, {
    requestId: 'revision-matched',
    expectedRevision: 2
  })
  assert.equal(matched.status, 'applied')
  assert.equal(matched.configRevision, 3)
  assert.equal(posted, 1, '版本匹配时才发送云命令')

  const missingShadowFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-revision-missing')
    if (isShadow(call)) return { status: 404, body: { error_code: 'IOTDA.014112' } }
    if (isCommand(call)) {
      throw new Error('影子缺失时不得发送云命令')
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const missingShadowProvider = createProvider(missingShadowFake)
  const missing = await missingShadowProvider.sendCommand('set_thresholds', { lower: 30, upper: 40 }, {
    requestId: 'revision-missing',
    expectedRevision: 2
  })
  assert.equal(missing.status, 'rejected')
  assert.equal(missing.errorCode, 'REVISION_CONFLICT')
  assert.equal(missingShadowFake.calls.filter(isCommand).length, 0)

  assertFakeHostsOnly(fake)
  assertFakeHostsOnly(missingShadowFake)
  ok('expectedRevision：影子 revision 冲突/缺失时本地 rejected，一致时才下发')
}

async function testUnauthorizedRefresh() {
  let iamCount = 0
  let deviceCount = 0
  const fake = createFakeFetch(function (call) {
    if (isIam(call)) {
      iamCount += 1
      return iamOk('token-' + iamCount)
    }
    if (isDevice(call)) {
      deviceCount += 1
      if (deviceCount === 1) {
        return { status: 401, body: { error_code: 'APIGW.0301', error_msg: 'token expired' } }
      }
      return deviceOk('ONLINE')
    }
    if (isShadow(call)) return shadowOk({ humidity: 50 })
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const provider = createProvider(fake)

  const state = await provider.getState()
  assert.equal(state.online, true)
  assert.equal(state.sensor.humidity, 50)
  assert.equal(iamCount, 2, '401 后应刷新一次 token')

  const deviceCalls = fake.calls.filter(isDevice)
  assert.equal(deviceCalls.length, 2)
  assert.equal(deviceCalls[0].headers['x-auth-token'], 'token-1')
  assert.equal(deviceCalls[1].headers['x-auth-token'], 'token-2')
  assert.equal(fake.calls.filter(isShadow)[0].headers['x-auth-token'], 'token-2')

  // 连续 401 只刷新一次，然后映射为 PROVIDER_UNAVAILABLE，不能无限循环。
  let iamCount2 = 0
  const alwaysUnauthorized = createFakeFetch(function (call) {
    if (isIam(call)) {
      iamCount2 += 1
      return iamOk('always-token-' + iamCount2)
    }
    if (isDevice(call)) {
      return { status: 401, body: { error_code: 'APIGW.0301', error_msg: 'unauthorized' } }
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  await assert.rejects(createProvider(alwaysUnauthorized).getState(), function (err) {
    return err && err.code === 'PROVIDER_UNAVAILABLE'
  })
  assert.equal(iamCount2, 2, '连续 401 只允许刷新一次')
  assert.equal(alwaysUnauthorized.calls.filter(isDevice).length, 2)

  assertFakeHostsOnly(fake)
  assertFakeHostsOnly(alwaysUnauthorized)
  ok('401 刷新 token 后重试一次；连续 401 映射 PROVIDER_UNAVAILABLE')
}

async function testTransportErrorMapping() {
  // 设备详情 429 -> BUSY
  const busyFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-busy')
    if (isDevice(call)) return { status: 429, body: { error_code: 'APIGW.0308', error_msg: 'too many requests' } }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  await assert.rejects(createProvider(busyFake).getState(), function (err) {
    return err && err.code === 'BUSY'
  })

  // 命令 404 -> DEVICE_OFFLINE
  const notFoundFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-404')
    if (isCommand(call)) return { status: 404, body: { error_code: 'IOTDA.014100', error_msg: 'device not found' } }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  await assert.rejects(createProvider(notFoundFake).sendCommand('set_fan', { value: 'ON' }, {
    requestId: 'transport-404'
  }), function (err) {
    return err && err.code === 'DEVICE_OFFLINE'
  })

  // 命令 503 -> PROVIDER_UNAVAILABLE
  const unavailableFake = createFakeFetch(function (call) {
    if (isIam(call)) return iamOk('token-503')
    if (isCommand(call)) return { status: 503, body: { error_code: 'IOTDA.000002', error_msg: 'service unavailable' } }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  await assert.rejects(createProvider(unavailableFake).sendCommand('set_fan', { value: 'ON' }, {
    requestId: 'transport-503'
  }), function (err) {
    return err && err.code === 'PROVIDER_UNAVAILABLE'
  })

  // 网络错误 -> PROVIDER_UNAVAILABLE
  const networkFake = createFakeFetch(function (call) {
    if (isIam(call)) throw new Error('connect ECONNREFUSED (fake)')
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  await assert.rejects(createProvider(networkFake).getState(), function (err) {
    return err && err.code === 'PROVIDER_UNAVAILABLE'
  })

  // 请求超时 -> PROVIDER_UNAVAILABLE
  const timeoutFake = createFakeFetch(function (call, init) {
    if (isIam(call)) return iamOk('token-timeout')
    if (isCommand(call)) {
      return new Promise(function (resolve, reject) {
        if (init && init.signal) {
          init.signal.addEventListener('abort', function () {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    }
    throw new Error('未预期请求：' + call.method + ' ' + call.url)
  })
  const timeoutProvider = createHuaweiProvider(
    { provider: 'huawei', deviceId: DEVICE_ID, huawei: Object.assign({}, HUAWEI_CONFIG, { requestTimeoutMs: 20 }) },
    { fetchImpl: timeoutFake.fetchImpl, now: function () { return NOW } }
  )
  await assert.rejects(timeoutProvider.sendCommand('set_fan', { value: 'ON' }, {
    requestId: 'transport-timeout'
  }), function (err) {
    return err && err.code === 'PROVIDER_UNAVAILABLE'
  })

  assertFakeHostsOnly(busyFake)
  assertFakeHostsOnly(notFoundFake)
  assertFakeHostsOnly(unavailableFake)
  assertFakeHostsOnly(networkFake)
  assertFakeHostsOnly(timeoutFake)
  ok('失败语义：429=BUSY、404=DEVICE_OFFLINE、5xx/网络/超时=PROVIDER_UNAVAILABLE，不伪造 applied')
}

async function testHealthWhenConfigured() {
  const provider = createHuaweiProvider(
    { provider: 'huawei', deviceId: DEVICE_ID, huawei: HUAWEI_CONFIG },
    { fetchImpl: createFakeFetch(function () {}).fetchImpl, now: function () { return NOW } }
  )
  const health = await provider.health()
  assert.equal(health.ok, true)
  assert.equal(health.configured, true)
  assert.equal(health.provider, 'huawei')
  assert.equal(health.deviceId, DEVICE_ID)
  assert.equal(typeof health.note, 'string')
  assert.equal(health.note.indexOf('test-password'), -1, 'health 不得回显密码')
  assert.equal(health.note.indexOf('test-user'), -1, 'health 不得回显 IAM 用户名')
  ok('已配置时 health ok=true 且不回显凭据值')
}

async function main() {
  await testMissingConfig()
  await testIamAndStateMapping()
  await testOfflineAndMissingShadow()
  await testCommands()
  await testExpectedRevision()
  await testUnauthorizedRefresh()
  await testTransportErrorMapping()
  await testHealthWhenConfigured()
  console.log('\nHUAWEI OK (' + groupCount + ' groups)')
}

main().catch(function (err) {
  process.exitCode = 1
  console.error('\nHUAWEI FAILED')
  console.error(err && err.stack ? err.stack : String(err))
})
