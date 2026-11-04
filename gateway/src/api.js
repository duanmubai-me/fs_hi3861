'use strict'

const http = require('node:http')

const pkg = require('../package.json')
const configModule = require('./config')
const { createRegistry } = require('./registry')
const { createCommandStore } = require('./commandStore')

const VERSION = pkg.version || '0.1.0'
const MAX_BODY_BYTES = 32 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function httpError(status, code, message) {
  const err = new Error(message)
  err.status = status
  err.code = code
  return err
}

function notFound() {
  return httpError(404, 'NOT_FOUND', '接口不存在')
}

function methodNotAllowed() {
  return httpError(405, 'METHOD_NOT_ALLOWED', '不支持该 HTTP 方法')
}

function isImplemented(provider) {
  return !provider || provider.implemented !== false
}

function applyCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, {
    error: {
      code: code,
      message: message
    }
  })
}

function decodePathSegments(pathname) {
  const segments = []
  const parts = pathname.split('/')
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue
    try {
      segments.push(decodeURIComponent(parts[i]))
    } catch (err) {
      throw httpError(400, 'INVALID_PAYLOAD', 'URL 编码不合法')
    }
  }
  return segments
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = []
    let total = 0
    let tooLarge = false
    let settled = false

    function fail(statusCode, code, message) {
      if (settled) return
      settled = true
      reject(httpError(statusCode, code, message))
    }

    req.on('data', function (chunk) {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })

    req.on('end', function () {
      if (settled) return
      if (tooLarge) {
        fail(413, 'INVALID_PAYLOAD', '请求体超过 32KB 上限')
        return
      }
      settled = true
      let text = Buffer.concat(chunks).toString('utf8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      if (!text.trim()) {
        reject(httpError(400, 'INVALID_PAYLOAD', '请求体必须是非空 JSON 对象'))
        return
      }
      let data
      try {
        data = JSON.parse(text)
      } catch (err) {
        reject(httpError(400, 'INVALID_PAYLOAD', '请求体不是合法 JSON'))
        return
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        reject(httpError(400, 'INVALID_PAYLOAD', '请求体必须是 JSON 对象'))
        return
      }
      resolve(data)
    })

    req.on('aborted', function () {
      fail(400, 'INVALID_PAYLOAD', '请求体读取被中断')
    })
    req.on('error', function () {
      fail(400, 'INVALID_PAYLOAD', '读取请求体失败')
    })
  })
}

function isIntInRange(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * 静态参数校验：能在网关判定的非法请求直接 400，不进入设备队列。
 * 设备侧仍会再次校验（防御性），但 400 与 202→rejected 的语义必须区分：
 *   - 400：请求本身非法（格式/范围/未知 action），不占用设备命令名额；
 *   - 202→rejected：请求合法但设备拒绝（离线/报警锁定/revision 冲突/NV 失败等）。
 */
function validateActionParams(action, params) {
  const p = params || {}
  if (action === 'set_fan') {
    if (p.value !== 'ON' && p.value !== 'OFF') {
      throw httpError(400, 'INVALID_PAYLOAD', 'set_fan.value 必须是 ON 或 OFF')
    }
    return
  }
  if (action === 'set_mode') {
    if (p.mode !== 'auto' && p.mode !== 'manual') {
      throw httpError(400, 'INVALID_PAYLOAD', 'set_mode.mode 必须是 auto 或 manual')
    }
    return
  }
  if (action === 'set_thresholds') {
    if (!isIntInRange(p.lower, 0, 100) || !isIntInRange(p.upper, 0, 100)) {
      throw httpError(400, 'INVALID_THRESHOLD_RANGE', '湿度阈值必须是 0–100 的整数')
    }
    if (p.lower >= p.upper) {
      throw httpError(400, 'INVALID_THRESHOLD_RANGE', '下限必须小于上限')
    }
    if (p.sensorKind !== undefined && p.sensorKind !== 'air_rh' && p.sensorKind !== 'soil_relative') {
      throw httpError(400, 'INVALID_PAYLOAD', 'sensorKind 只能是 air_rh 或 soil_relative')
    }
    return
  }
  if (action === 'set_security_config') {
    if (!isIntInRange(p.flameTrip, 0, 4095) || !isIntInRange(p.flameClear, 0, 4095)) {
      throw httpError(400, 'INVALID_THRESHOLD_RANGE', '火焰阈值必须是 0–4095 的整数')
    }
    if (p.flameTrip <= p.flameClear) {
      throw httpError(400, 'INVALID_THRESHOLD_RANGE', '触发阈值必须大于解除阈值')
    }
    if (p.alarmEnabled !== undefined && typeof p.alarmEnabled !== 'boolean') {
      throw httpError(400, 'INVALID_PAYLOAD', 'alarmEnabled 必须是布尔值')
    }
    return
  }
  if (action === 'acknowledge_alarm') {
    return
  }
  if (action === 'mock_alarm') {
    if (['active', 'clearing', 'normal'].indexOf(p.status) < 0) {
      throw httpError(400, 'INVALID_PAYLOAD', 'mock_alarm.status 只能是 active/clearing/normal')
    }
    return
  }
  throw httpError(400, 'UNSUPPORTED_CAPABILITY', '未知 action：' + action)
}

function validateCommandBody(body) {
  const requestId = body.requestId
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw httpError(400, 'INVALID_PAYLOAD', 'requestId 缺失或格式不合法')
  }

  const action = body.action
  if (typeof action !== 'string' || action.trim().length === 0 || action.length > 128) {
    throw httpError(400, 'INVALID_PAYLOAD', 'action 缺失或格式不合法')
  }

  let params = {}
  if (body.params !== undefined && body.params !== null) {
    if (typeof body.params !== 'object' || Array.isArray(body.params)) {
      throw httpError(400, 'INVALID_PAYLOAD', 'params 必须是 JSON 对象')
    }
    params = body.params
  }

  let expectedRevision
  if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
    if (!Number.isInteger(body.expectedRevision)) {
      throw httpError(400, 'INVALID_PAYLOAD', 'expectedRevision 必须是整数')
    }
    expectedRevision = body.expectedRevision
  }

  validateActionParams(action, params)

  return {
    requestId: requestId,
    action: action,
    params: params,
    expectedRevision: expectedRevision
  }
}

function commandStatusPath(deviceId, requestId) {
  return '/api/v1/devices/' + encodeURIComponent(deviceId) + '/commands/' + encodeURIComponent(requestId)
}

function providerErrorToHttpError(err) {
  if (err && err.status) return err
  if (err && err.code === 'NOT_IMPLEMENTED') {
    return httpError(501, 'NOT_IMPLEMENTED', '当前 provider 尚未实现该能力')
  }
  if (err && err.code === 'DEVICE_OFFLINE') {
    return httpError(503, 'DEVICE_OFFLINE', '设备离线')
  }
  if (err && err.code === 'INVALID_PAYLOAD') {
    return httpError(400, 'INVALID_PAYLOAD', '设备不接受该请求参数')
  }
  return httpError(503, 'PROVIDER_UNAVAILABLE', '设备服务暂不可用')
}

function ensureImplemented(entry, req) {
  if (isImplemented(entry.provider)) return
  // 不读取未实现 provider 的请求体，但要把 socket 上的数据消费掉，避免 keep-alive 连接挂住。
  if (req && !req.readableEnded) req.resume()
  throw httpError(501, 'NOT_IMPLEMENTED', 'provider ' + String(entry.provider.provider || '') + ' 尚未实现')
}

async function handleHealth(res, context) {
  let providerHealth
  try {
    providerHealth = await context.provider.health()
  } catch (err) {
    throw providerErrorToHttpError(err)
  }
  if (!providerHealth || typeof providerHealth !== 'object') {
    throw httpError(503, 'PROVIDER_UNAVAILABLE', 'provider health 返回非法结果')
  }

  const now = Date.now()
  const payload = {
    ok: providerHealth.ok === true,
    provider: context.config.provider,
    version: providerHealth.version || VERSION,
    deviceId: providerHealth.deviceId || context.config.deviceId,
    bootId: providerHealth.bootId || context.serverBootId,
    uptimeMs: Number.isFinite(providerHealth.uptimeMs)
      ? providerHealth.uptimeMs
      : Math.max(0, now - context.bootAt),
    serverTime: now
  }
  if (providerHealth.configured !== undefined) payload.configured = providerHealth.configured
  if (typeof providerHealth.note === 'string' && providerHealth.note) payload.note = providerHealth.note
  sendJson(res, 200, payload)
}

async function handleState(res, context, entry) {
  if (!isImplemented(entry.provider)) {
    throw httpError(501, 'NOT_IMPLEMENTED', 'provider ' + String(entry.provider.provider || '') + ' 尚未实现')
  }
  let state
  try {
    state = await entry.provider.getState()
  } catch (err) {
    throw providerErrorToHttpError(err)
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw httpError(503, 'PROVIDER_UNAVAILABLE', 'provider 返回了非法设备状态')
  }
  // RawState 的 receivedAt 统一定义为服务器收到的当前毫秒，不信任上游时钟。
  const payload = Object.assign({}, state, { receivedAt: Date.now() })
  sendJson(res, 200, payload)
}

async function handleCreateCommand(req, res, context, entry, setRequestId) {
  const body = await readJsonBody(req)
  const command = validateCommandBody(body)
  setRequestId(command.requestId)

  const submitted = context.commandStore.submit(entry.deviceId, entry.provider, command)
  if (!submitted.ok) {
    if (submitted.code === 'DUPLICATE_CONFLICT') {
      throw httpError(409, 'DUPLICATE_CONFLICT', submitted.message)
    }
    if (submitted.code === 'BUSY') {
      throw httpError(429, 'BUSY', submitted.message)
    }
    throw httpError(503, 'PROVIDER_UNAVAILABLE', '命令无法入队')
  }

  sendJson(res, 202, {
    requestId: command.requestId,
    status: submitted.view.status,
    statusUrl: commandStatusPath(entry.deviceId, command.requestId)
  })
}

function handleGetCommand(res, context, entry, requestId) {
  if (!isImplemented(entry.provider)) {
    throw httpError(501, 'NOT_IMPLEMENTED', 'provider ' + String(entry.provider.provider || '') + ' 尚未实现')
  }
  const view = context.commandStore.get(entry.deviceId, requestId)
  if (!view) {
    throw httpError(404, 'STALE_COMMAND', '命令不存在或已过期')
  }
  sendJson(res, 200, view)
}

async function routeRequest(req, res, context, setRequestId, pathname) {
  const segments = decodePathSegments(pathname)
  const method = req.method || ''

  if (segments.length === 3 && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'health') {
    if (method !== 'GET') throw methodNotAllowed()
    await handleHealth(res, context)
    return
  }

  if (segments.length >= 5 && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'devices') {
    const deviceId = segments[3]
    const entry = context.registry.get(deviceId)
    if (!entry) throw httpError(404, 'DEVICE_OFFLINE', '设备不存在或离线')

    if (segments.length === 5 && segments[4] === 'state') {
      if (method !== 'GET') throw methodNotAllowed()
      await handleState(res, context, entry)
      return
    }

    if (segments.length === 5 && segments[4] === 'commands') {
      if (method !== 'POST') throw methodNotAllowed()
      ensureImplemented(entry, req)
      await handleCreateCommand(req, res, context, entry, setRequestId)
      return
    }

    if (segments.length === 6 && segments[4] === 'commands') {
      if (method !== 'GET') throw methodNotAllowed()
      const requestId = segments[5]
      if (REQUEST_ID_PATTERN.test(requestId)) setRequestId(requestId)
      handleGetCommand(res, context, entry, requestId)
      return
    }
  }

  throw notFound()
}

function createServer(options) {
  const opts = options || {}
  const config = opts.config || configModule.loadConfig()
  const provider = opts.provider
  if (!provider || typeof provider.getState !== 'function' || typeof provider.sendCommand !== 'function' ||
      typeof provider.health !== 'function') {
    throw new Error('createServer 需要实现 getState/sendCommand/health 的 provider')
  }

  const logger = typeof opts.logger === 'function'
    ? opts.logger
    : (opts.logger === false ? function () {} : function (line) { console.log(line) })

  const registry = createRegistry()
  registry.register({ deviceId: config.deviceId, provider: provider })

  const bootAt = Date.now()
  const serverBootId = 'gateway-' + bootAt.toString(36) + '-' +
    Math.floor(Math.random() * 0x1000000).toString(36)
  const commandStore = createCommandStore({ commandTimeoutMs: config.commandTimeoutMs })
  const context = {
    config: config,
    provider: provider,
    registry: registry,
    commandStore: commandStore,
    bootAt: bootAt,
    serverBootId: serverBootId,
    logger: logger
  }

  const server = http.createServer(function (req, res) {
    let requestId = ''
    let pathname = String(req.url || '/').split('?')[0]

    applyCommonHeaders(res)
    res.once('finish', function () {
      try {
        logger(String(req.method || '') + ' ' + pathname + ' ' + res.statusCode + ' requestId=' + (requestId || '-'))
      } catch (err) {
        // 日志失败不影响请求。
      }
    })

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Content-Length', '0')
      res.end()
      return
    }

    function setRequestId(value) {
      requestId = value || ''
    }

    Promise.resolve()
      .then(function () {
        try {
          pathname = new URL(req.url || '/', 'http://gateway.local').pathname
        } catch (err) {
          throw httpError(400, 'INVALID_PAYLOAD', '请求 URL 不合法')
        }
        return routeRequest(req, res, context, setRequestId, pathname)
      })
      .catch(function (err) {
        if (res.writableEnded || res.destroyed) return
        if (!req.readableEnded) req.resume()
        if (!(err && Number.isInteger(err.status))) {
          if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', '应用服务内部错误')
          else if (!res.writableEnded) res.end()
          return
        }
        if (!res.headersSent) {
          sendError(res, err.status, err.code || 'INTERNAL_ERROR', err.message || '应用服务内部错误')
        } else if (!res.writableEnded) {
          res.end()
        }
      })
  })

  server.once('close', function () {
    commandStore.close()
  })

  return server
}

module.exports = {
  createServer,
  MAX_BODY_BYTES
}
