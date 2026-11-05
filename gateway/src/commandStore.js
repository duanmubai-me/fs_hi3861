'use strict'

// requestId 命令记录：
//  - 每设备一条串行队列（前一条执行完才调用下一条 provider.sendCommand）；
//  - 同设备同 requestId 幂等：相同 action/params/expectedRevision 直接返回已有记录，不重复执行；
//  - 同 requestId 但内容不同返回 DUPLICATE_CONFLICT，避免静默忽略不同命令；
//  - 只保留最近 100 条，完成超过 30 分钟的记录会被清理；
//  - 轮询超时（commandTimeoutMs）置为 unknown，不伪造 applied/rejected。

const DEFAULT_RETENTION_MS = 30 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_COMMAND_TIMEOUT_MS = 8000
const SWEEP_INTERVAL_MS = 60 * 1000

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value).sort().forEach(function (key) {
      out[key] = stableValue(value[key])
    })
    return out
  }
  return value
}

function signatureOf(command) {
  return JSON.stringify([
    command.action,
    stableValue(command.params || {}),
    command.expectedRevision === undefined ? null : command.expectedRevision
  ])
}

function makeResult(entry, status, errorCode, message, now) {
  return {
    requestId: entry.requestId,
    action: entry.action,
    status: status,
    errorCode: errorCode || null,
    message: message || '',
    saved: false,
    configRevision: null,
    params: clone(entry.params || {}),
    appliedAt: status === 'unknown' ? null : now()
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let settled = false
    const timer = setTimeout(function () {
      if (settled) return
      settled = true
      const err = new Error('等待设备执行结果超时，结果未知')
      err.code = 'TIMEOUT'
      reject(err)
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    Promise.resolve(promise).then(
      function (value) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      function (err) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function createCommandStore(options) {
  const opts = options || {}
  const retentionMs = Number.isFinite(opts.retentionMs) && opts.retentionMs > 0
    ? opts.retentionMs
    : DEFAULT_RETENTION_MS
  const maxEntries = Number.isInteger(opts.maxEntries) && opts.maxEntries > 0
    ? opts.maxEntries
    : DEFAULT_MAX_ENTRIES
  const commandTimeoutMs = Number.isFinite(opts.commandTimeoutMs) && opts.commandTimeoutMs > 0
    ? opts.commandTimeoutMs
    : DEFAULT_COMMAND_TIMEOUT_MS
  const now = typeof opts.now === 'function' ? opts.now : function () { return Date.now() }

  const devices = new Map()
  const tails = new Map()

  function mapFor(deviceId) {
    let map = devices.get(deviceId)
    if (!map) {
      map = new Map()
      devices.set(deviceId, map)
    }
    return map
  }

  function prune() {
    const cutoff = now() - retentionMs
    devices.forEach(function (map, deviceId) {
      map.forEach(function (entry, requestId) {
        if (entry.status !== 'pending' && entry.updatedAt < cutoff) {
          map.delete(requestId)
        }
      })
      if (map.size === 0) devices.delete(deviceId)
    })
  }

  function makeRoom(map) {
    let oldestId = null
    let oldestAt = Infinity
    map.forEach(function (entry, requestId) {
      if (entry.status !== 'pending' && entry.updatedAt < oldestAt) {
        oldestAt = entry.updatedAt
        oldestId = requestId
      }
    })
    if (!oldestId) return false
    map.delete(oldestId)
    return true
  }

  function publicView(entry) {
    const view = {
      requestId: entry.requestId,
      status: entry.status
    }
    if (entry.status !== 'pending' && entry.result) view.result = clone(entry.result)
    return view
  }

  function get(deviceId, requestId) {
    prune()
    const map = devices.get(deviceId)
    const entry = map && map.get(requestId)
    return entry ? publicView(entry) : null
  }

  function finalize(entry, status, result) {
    entry.status = status
    entry.result = result
    entry.updatedAt = now()
  }

  function execute(deviceId, entry, provider) {
    const meta = { requestId: entry.requestId }
    if (entry.expectedRevision !== undefined) meta.expectedRevision = entry.expectedRevision

    return withTimeout(
      Promise.resolve().then(function () {
        return provider.sendCommand(entry.action, entry.params, meta)
      }),
      commandTimeoutMs
    ).then(function (raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw Object.assign(new Error('设备返回了非法命令结果'), { code: 'HARDWARE_ERROR' })
      }
      const result = clone(raw)
      const status = result.status === 'applied' || result.status === 'rejected'
        ? result.status
        : 'unknown'
      result.requestId = entry.requestId
      result.action = entry.action
      result.status = status
      result.params = result.params && typeof result.params === 'object' ? result.params : clone(entry.params)
      if (result.status === 'rejected' && !result.errorCode) result.errorCode = 'HARDWARE_ERROR'
      if (typeof result.message !== 'string') result.message = ''
      if (result.appliedAt === undefined || result.appliedAt === null) {
        result.appliedAt = status === 'unknown' ? null : now()
      }
      finalize(entry, status, result)
    }).catch(function (err) {
      const code = err && err.code ? String(err.code) : 'HARDWARE_ERROR'
      const status = code === 'TIMEOUT' ? 'unknown' : 'rejected'
      const result = makeResult(entry, status, code, err && err.message ? String(err.message) : '', now)
      finalize(entry, status, result)
    })
  }

  function enqueue(deviceId, entry, provider) {
    const previous = tails.get(deviceId) || Promise.resolve()
    const next = previous.then(function () {
      return execute(deviceId, entry, provider)
    })
    tails.set(deviceId, next)
    const cleanup = function () {
      if (tails.get(deviceId) === next) tails.delete(deviceId)
    }
    next.then(cleanup, cleanup)
    return next
  }

  /**
   * 登记命令。返回对象而不是抛异常，便于 API 区分 202/409/429。
   * @returns {{ok:true, duplicate:boolean, entry:object, view:object}|{ok:false, code:string, message:string}}
   */
  function submit(deviceId, provider, command) {
    prune()
    const map = mapFor(deviceId)
    const existing = map.get(command.requestId)
    if (existing) {
      if (existing.signature === signatureOf(command)) {
        return { ok: true, duplicate: true, entry: existing, view: publicView(existing) }
      }
      return {
        ok: false,
        code: 'DUPLICATE_CONFLICT',
        message: '同一 requestId 已用于不同的命令参数'
      }
    }

    if (map.size >= maxEntries && !makeRoom(map)) {
      return {
        ok: false,
        code: 'BUSY',
        message: '当前设备的待执行命令过多，请稍后重试'
      }
    }

    const entry = {
      requestId: command.requestId,
      action: command.action,
      params: clone(command.params || {}),
      expectedRevision: command.expectedRevision,
      signature: signatureOf(command),
      status: 'pending',
      result: null,
      createdAt: now(),
      updatedAt: now()
    }
    map.set(entry.requestId, entry)
    enqueue(deviceId, entry, provider)

    return { ok: true, duplicate: false, entry: entry, view: publicView(entry) }
  }

  const sweeper = setInterval(prune, SWEEP_INTERVAL_MS)
  if (typeof sweeper.unref === 'function') sweeper.unref()

  return {
    submit: submit,
    get: get,
    close: function () {
      clearInterval(sweeper)
    }
  }
}

module.exports = {
  createCommandStore
}
