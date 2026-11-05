'use strict'

// gateway 冒烟测试：纯 Node（node:http + node:assert），不依赖任何外部包。
// 启动真实 HTTP server 到端口 0，按 contract.md §6 逐项验证 mock、未配置的 huawei
// 与未实现的 local provider。运行：node gateway/tests/smoke.js

const assert = require('node:assert/strict')
const http = require('node:http')

const { loadConfig } = require('../src/config')
const { startGateway } = require('../src/index')

const REQUEST_TIMEOUT_MS = 6000
const COMMAND_TIMEOUT_MS = 6000

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function makeRequestIdFactory(runId) {
  return function (label) {
    return 'smoke-' + runId + '-' + label
  }
}

function request(gateway, method, path, options) {
  const opts = options || {}
  return new Promise(function (resolve, reject) {
    const headers = { connection: 'close' }
    let body = null
    if (opts.body !== undefined) {
      body = opts.raw ? String(opts.body) : JSON.stringify(opts.body)
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(body))
    }

    const req = http.request(
      {
        hostname: gateway.config.host,
        port: gateway.address.port,
        method: method,
        path: path,
        headers: headers,
        agent: false
      },
      function (res) {
        const chunks = []
        res.on('data', function (chunk) {
          chunks.push(chunk)
        })
        res.on('end', function () {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch (err) {
            json = null
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            text: text,
            json: json
          })
        })
      }
    )

    req.setTimeout(REQUEST_TIMEOUT_MS, function () {
      req.destroy(new Error('HTTP 请求超时：' + method + ' ' + path))
    })
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

function expectStatus(res, expected, label) {
  assert.equal(
    res.statusCode,
    expected,
    label + '：期望 HTTP ' + expected + '，实际 ' + res.statusCode + '，body=' + res.text
  )
}

function assertError(res, expectedStatus, expectedCode, label) {
  expectStatus(res, expectedStatus, label)
  assert.ok(res.json && res.json.error, label + '：缺少 error 对象，body=' + res.text)
  assert.equal(res.json.error.code, expectedCode, label + '：错误码不符')
  assert.equal(typeof res.json.error.message, 'string', label + '：错误 message 必须是字符串')
}

function assertCommandResult(command, expectedStatus, label) {
  assert.ok(command && command.result, label + '：缺少 result，body=' + JSON.stringify(command))
  assert.equal(command.status, expectedStatus, label + '：顶层 status 不符')
  assert.equal(command.result.status, expectedStatus, label + '：result.status 不符')
  assert.equal(command.result.requestId, command.requestId, label + '：result.requestId 不一致')
}

async function getState(gateway, deviceId) {
  const res = await request(gateway, 'GET', '/api/v1/devices/' + encodeURIComponent(deviceId) + '/state')
  expectStatus(res, 200, 'GET state')
  return res.json
}

async function postCommand(gateway, deviceId, body) {
  return request(gateway, 'POST', '/api/v1/devices/' + encodeURIComponent(deviceId) + '/commands', {
    body: body
  })
}

async function getCommand(gateway, deviceId, requestId) {
  return request(
    gateway,
    'GET',
    '/api/v1/devices/' + encodeURIComponent(deviceId) + '/commands/' + encodeURIComponent(requestId)
  )
}

async function waitForTerminal(gateway, deviceId, requestId, label) {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    const res = await getCommand(gateway, deviceId, requestId)
    expectStatus(res, 200, label + '（轮询命令）')
    last = res.json
    if (last && last.status !== 'pending') return last
    await sleep(100)
  }
  throw new Error(label + '：等待命令终态超时，最后结果=' + JSON.stringify(last))
}

async function postAndWait(gateway, deviceId, body, label) {
  const accepted = await postCommand(gateway, deviceId, body)
  expectStatus(accepted, 202, label + '（POST 命令）')
  assert.equal(accepted.json.requestId, body.requestId, label + '：202 requestId 不一致')
  return waitForTerminal(gateway, deviceId, body.requestId, label)
}

async function testMockGateway(gateway, config, rid) {
  const deviceId = config.deviceId
  const devicePath = '/api/v1/devices/' + encodeURIComponent(deviceId)

  console.log('[smoke] 1. health')
  const healthRes = await request(gateway, 'GET', '/api/v1/health')
  expectStatus(healthRes, 200, 'health')
  const health = healthRes.json
  assert.equal(health.ok, true, 'health.ok 应为 true')
  assert.equal(health.provider, 'mock', 'health.provider 应为 mock')
  assert.equal(typeof health.version, 'string', 'health.version 缺失')
  assert.equal(health.deviceId, deviceId, 'health.deviceId 不一致')
  assert.equal(typeof health.bootId, 'string', 'health.bootId 缺失')
  assert.equal(typeof health.uptimeMs, 'number', 'health.uptimeMs 缺失')
  assert.equal(typeof health.serverTime, 'number', 'health.serverTime 缺失')
  console.log('[smoke]    health OK：provider=' + health.provider + ' version=' + health.version)

  console.log('[smoke] 2. state')
  const initialState = await getState(gateway, deviceId)
  assert.equal(initialState.deviceId, deviceId, 'state.deviceId 不一致')
  assert.equal(typeof initialState.sensor, 'object', 'state.sensor 缺失')
  assert.equal(typeof initialState.config, 'object', 'state.config 缺失')
  assert.equal(typeof initialState.capabilities, 'object', 'state.capabilities 缺失')
  assert.equal(typeof initialState.receivedAt, 'number', 'state.receivedAt 必须由服务器填成毫秒数')
  assert.ok(initialState.receivedAt > 0, 'state.receivedAt 应为正数')
  const initialRevision = initialState.config.configRevision
  console.log('[smoke]    state OK：initialRevision=' + initialRevision + ' receivedAt=' + initialState.receivedAt)

  console.log('[smoke] 3. CORS 预检')
  const preflight = await request(gateway, 'OPTIONS', '/api/v1/health')
  expectStatus(preflight, 204, 'OPTIONS')
  assert.equal(preflight.headers['access-control-allow-origin'], '*', 'CORS 未允许 *')
  assert.equal(preflight.headers['access-control-allow-headers'], 'content-type', 'CORS 未允许 content-type')

  console.log('[smoke] 4. 非法 action（网关静态校验 400 UNSUPPORTED_CAPABILITY）')
  const unsupportedBody = {
    requestId: rid('unsupported-action'),
    action: 'not_a_supported_action',
    params: { value: 'whatever' }
  }
  const unsupportedRes = await postCommand(gateway, deviceId, unsupportedBody)
  expectStatus(unsupportedRes, 400, '非法 action')
  assert.equal(unsupportedRes.json.error.code, 'UNSUPPORTED_CAPABILITY', '非法 action 错误码不符')
  console.log('[smoke]    非法 action OK：400 / UNSUPPORTED_CAPABILITY')

  console.log('[smoke] 4b. 非法阈值范围（网关静态校验 400 INVALID_THRESHOLD_RANGE）')
  const badRangeRes = await postCommand(gateway, deviceId, {
    requestId: rid('bad-range'),
    action: 'set_thresholds',
    params: { lower: 80, upper: 20 }
  })
  expectStatus(badRangeRes, 400, '非法阈值范围')
  assert.equal(badRangeRes.json.error.code, 'INVALID_THRESHOLD_RANGE', '非法阈值错误码不符')
  console.log('[smoke]    非法阈值范围 OK：400 / INVALID_THRESHOLD_RANGE')

  console.log('[smoke] 5. 保存阈值 30/40，验证 saved 与 revision 增长')
  // mock-device 的出厂值恰好也是 30/40；set_thresholds 在值未变化时不增加 revision。
  // 因此先把值改成 35/45，再执行用户要求的 30/40 保存，后者才会真正落盘并提升 revision。
  const prepBody = {
    requestId: rid('thresholds-prep'),
    action: 'set_thresholds',
    params: { lower: 35, upper: 45 }
  }
  const prepFinal = await postAndWait(gateway, deviceId, prepBody, '阈值预置')
  assertCommandResult(prepFinal, 'applied', '阈值预置')
  assert.equal(prepFinal.result.saved, true, '阈值预置 saved 应为 true')
  const afterPrep = await getState(gateway, deviceId)
  const prepRevision = afterPrep.config.configRevision
  assert.ok(prepRevision > initialRevision, '阈值预置后 revision 应增长')
  assert.equal(afterPrep.config.humidityLower, 35, '阈值预置 lower 未生效')
  assert.equal(afterPrep.config.humidityUpper, 45, '阈值预置 upper 未生效')

  const saveBody = {
    requestId: rid('thresholds'),
    action: 'set_thresholds',
    params: { lower: 30, upper: 40 }
  }
  const saveAccepted = await postCommand(gateway, deviceId, saveBody)
  expectStatus(saveAccepted, 202, '保存阈值（POST）')
  assert.equal(saveAccepted.json.requestId, saveBody.requestId, '保存阈值 requestId 不一致')
  assert.equal(saveAccepted.json.status, 'pending', '首次命令 202 应为 pending')
  assert.equal(
    saveAccepted.json.statusUrl,
    devicePath + '/commands/' + encodeURIComponent(saveBody.requestId),
    'statusUrl 不正确'
  )

  const saveFinal = await waitForTerminal(gateway, deviceId, saveBody.requestId, '保存阈值')
  assertCommandResult(saveFinal, 'applied', '保存阈值')
  assert.equal(saveFinal.result.saved, true, '保存阈值 saved 应为 true')
  assert.ok(saveFinal.result.configRevision > prepRevision, '保存阈值后 revision 应增长')
  const saveRevision = saveFinal.result.configRevision

  const afterSave = await getState(gateway, deviceId)
  assert.equal(afterSave.config.humidityLower, 30, '保存后 lower 未生效')
  assert.equal(afterSave.config.humidityUpper, 40, '保存后 upper 未生效')
  assert.equal(afterSave.config.configRevision, saveRevision, 'state revision 与命令回执不一致')
  console.log('[smoke]    阈值保存 OK：saved=true，revision ' + prepRevision + ' → ' + saveRevision)

  console.log('[smoke] 6. 相同 requestId 重复 POST（幂等）')
  const duplicateRes = await postCommand(gateway, deviceId, saveBody)
  expectStatus(duplicateRes, 202, '重复 POST')
  assert.equal(duplicateRes.json.requestId, saveBody.requestId, '重复 POST requestId 不一致')
  const duplicateFinal = await waitForTerminal(gateway, deviceId, saveBody.requestId, '重复 POST')
  assertCommandResult(duplicateFinal, 'applied', '重复 POST')
  assert.equal(duplicateFinal.result.configRevision, saveRevision, '重复 POST 不应改变 revision')
  assert.equal(duplicateFinal.result.saved, true, '重复 POST 的 saved 应为 true')
  assert.equal(duplicateFinal.result.appliedAt, saveFinal.result.appliedAt, '重复 POST 不应产生新的执行时间')
  const afterDuplicate = await getState(gateway, deviceId)
  assert.equal(afterDuplicate.config.configRevision, saveRevision, '重复 POST 后 state revision 变化')
  console.log('[smoke]    幂等 OK：同一 requestId 未重复执行，revision 保持 ' + saveRevision)

  console.log('[smoke] 7. expectedRevision 冲突')
  const conflictBody = {
    requestId: rid('revision-conflict'),
    action: 'set_thresholds',
    params: { lower: 25, upper: 55 },
    expectedRevision: saveRevision - 1
  }
  const conflictFinal = await postAndWait(gateway, deviceId, conflictBody, 'revision 冲突')
  assertCommandResult(conflictFinal, 'rejected', 'revision 冲突')
  assert.equal(conflictFinal.result.errorCode, 'REVISION_CONFLICT', 'revision 冲突错误码不符')
  const afterConflict = await getState(gateway, deviceId)
  assert.equal(afterConflict.config.configRevision, saveRevision, 'revision 冲突后 state revision 变化')
  assert.equal(afterConflict.config.humidityLower, 30, 'revision 冲突后 lower 变化')
  assert.equal(afterConflict.config.humidityUpper, 40, 'revision 冲突后 upper 变化')
  console.log('[smoke]    冲突 OK：rejected / REVISION_CONFLICT，设备配置未改变')

  console.log('[smoke] 8. 未知设备')
  const unknownState = await request(gateway, 'GET', '/api/v1/devices/not-a-real-device/state')
  assertError(unknownState, 404, 'DEVICE_OFFLINE', '未知设备 state')
  const unknownCommand = await request(
    gateway,
    'POST',
    '/api/v1/devices/not-a-real-device/commands',
    { body: { requestId: rid('unknown-device'), action: 'set_fan', params: { value: 'ON' } } }
  )
  assertError(unknownCommand, 404, 'DEVICE_OFFLINE', '未知设备 command')
  console.log('[smoke]    未知设备 OK：404 / DEVICE_OFFLINE')

  console.log('[smoke] 9. 未知 requestId')
  const unknownRequest = await getCommand(gateway, deviceId, rid('never-issued'))
  assertError(unknownRequest, 404, 'STALE_COMMAND', '未知 requestId')
  console.log('[smoke]    未知 requestId OK：404 / STALE_COMMAND')

  console.log('[smoke] 10. 畸形 JSON 与超过 32KB 的请求体')
  const malformed = await request(gateway, 'POST', devicePath + '/commands', {
    body: '{ this is not json',
    raw: true
  })
  assertError(malformed, 400, 'INVALID_PAYLOAD', '畸形 JSON')

  const hugeBody = JSON.stringify({
    requestId: rid('oversized'),
    action: 'set_thresholds',
    params: { lower: 30, upper: 40, padding: 'x'.repeat(33 * 1024) }
  })
  assert.ok(Buffer.byteLength(hugeBody) > 32 * 1024, '测试用超大请求体构造失败')
  const oversized = await request(gateway, 'POST', devicePath + '/commands', {
    body: hugeBody,
    raw: true
  })
  assertError(oversized, 413, 'INVALID_PAYLOAD', '超大请求体')

  const missingRequestId = await request(gateway, 'POST', devicePath + '/commands', {
    body: { action: 'set_fan', params: { value: 'ON' } }
  })
  assertError(missingRequestId, 400, 'INVALID_PAYLOAD', 'requestId 缺失')
  console.log('[smoke]    请求校验 OK：畸形 JSON=400，超大=413，requestId 缺失=400')
}

async function testSkeletonProvider(baseConfig, providerName) {
  // huawei 段显式置 null：本测试只验证“已实现但未配置”的降级语义，
  // 不能读取 config/local.json 里的真实凭据，更不能发起真实云请求。
  const config = Object.assign({}, baseConfig, { provider: providerName, huawei: null })
  const gateway = await startGateway({ config: config, logger: false })
  try {
    const healthRes = await request(gateway, 'GET', '/api/v1/health')
    expectStatus(healthRes, 200, providerName + ' health')
    assert.equal(healthRes.json.provider, providerName, providerName + ' health provider 不符')
    assert.equal(healthRes.json.ok, false, providerName + ' health.ok 应为 false')
    assert.equal(healthRes.json.configured, false, providerName + ' health.configured 应为 false')
    assert.equal(typeof healthRes.json.note, 'string', providerName + ' health.note 缺失')

    const stateRes = await request(
      gateway,
      'GET',
      '/api/v1/devices/' + encodeURIComponent(config.deviceId) + '/state'
    )
    assertError(stateRes, 501, 'NOT_IMPLEMENTED', providerName + ' state')

    const commandRes = await request(
      gateway,
      'POST',
      '/api/v1/devices/' + encodeURIComponent(config.deviceId) + '/commands',
      {
        body: {
          requestId: 'smoke-' + providerName + '-command',
          action: 'set_fan',
          params: { value: 'ON' }
        }
      }
    )

    if (providerName === 'huawei') {
      // huawei provider 已实现，但缺少应用侧配置：POST 仍按异步命令契约返回 202，
      // 轮询结果必须是 rejected / NOT_IMPLEMENTED，不能伪造 applied。
      expectStatus(commandRes, 202, providerName + ' command')
      let view = null
      for (let i = 0; i < 40; i += 1) {
        view = await request(gateway, 'GET', commandRes.json.statusUrl)
        if (view.json && view.json.status !== 'pending') break
        await sleep(25)
      }
      expectStatus(view, 200, providerName + ' command status')
      assert.equal(view.json.status, 'rejected', providerName + ' 未配置时命令应 rejected')
      assert.equal(view.json.result.errorCode, 'NOT_IMPLEMENTED', providerName + ' 未配置时错误码')
      console.log('[smoke]    huawei 已实现但未配置：POST 202 → rejected / NOT_IMPLEMENTED')
    } else {
      assertError(commandRes, 501, 'NOT_IMPLEMENTED', providerName + ' command')
      console.log('[smoke]    ' + providerName + ' 骨架 OK：health configured=false，state/command=501')
    }
  } finally {
    await closeServer(gateway.server)
  }
}

function closeServer(server) {
  return new Promise(function (resolve) {
    if (!server || !server.listening) {
      resolve()
      return
    }
    server.close(function () {
      resolve()
    })
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections()
    }
  })
}

async function main() {
  const loaded = loadConfig({ env: {} })
  const mockConfig = Object.assign({}, loaded, {
    host: '127.0.0.1',
    port: 0,
    provider: 'mock',
    deviceId: 'mock-farm-001',
    staleAfterMs: 90000,
    commandTimeoutMs: 8000
  })

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const rid = makeRequestIdFactory(runId)
  const gateway = await startGateway({ config: mockConfig, logger: false })
  const servers = [gateway.server]

  try {
    console.log('[smoke] mock gateway: ' + gateway.url + ' deviceId=' + mockConfig.deviceId)
    await testMockGateway(gateway, mockConfig, rid)

    console.log('[smoke] 11. huawei 未配置 / local 未实现 provider')
    await testSkeletonProvider(mockConfig, 'huawei')
    await testSkeletonProvider(mockConfig, 'local')

    console.log('\nSMOKE OK')
  } catch (err) {
    process.exitCode = 1
    console.error('\nSMOKE FAILED')
    console.error(err && err.stack ? err.stack : String(err))
  } finally {
    for (let i = servers.length - 1; i >= 0; i -= 1) {
      await closeServer(servers[i])
    }
  }
}

main().catch(function (err) {
  process.exitCode = 1
  console.error('\nSMOKE FAILED')
  console.error(err && err.stack ? err.stack : String(err))
})
