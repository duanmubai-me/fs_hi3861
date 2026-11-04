// services/transport-gateway.js
// gateway 传输层：小程序 → 本机应用服务（gateway/）HTTP 接口。
// 接口约定见 wechat/smart_farm/docs/contract.md：
//   GET  /api/v1/health
//   GET  /api/v1/devices/{id}/state
//   POST /api/v1/devices/{id}/commands            -> 202 {requestId,status,statusUrl}
//   GET  /api/v1/devices/{id}/commands/{requestId}-> {requestId,status,result?}
//
// 命令是异步的：202 只表示"已接收"，必须轮询到 applied/rejected 才结束；
// 超时返回 TIMEOUT（结果未知），页面不应据此重复下发开泵命令。

const errors = require('../models/errors')
const idUtil = require('../utils/id')

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path
}

function httpRequest(env, method, path, data, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
      reject(errors.createError('NETWORK_ERROR', '当前环境没有 wx.request'))
      return
    }
    wx.request({
      url: joinUrl(env.baseUrl, path),
      method: method,
      data: data,
      timeout: timeoutMs || 10000,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        resolve(res)
      },
      fail: function (err) {
        reject(
          errors.createError('NETWORK_ERROR', '无法连接应用服务', {
            detail: (err && err.errMsg) || ''
          })
        )
      }
    })
  })
}

function errorFromResponse(res) {
  const body = res && res.data
  const errorBody = body && body.error ? body.error : {}
  const code = errorBody.code || 'UNKNOWN'
  const message = errorBody.message || 'HTTP ' + (res && res.statusCode)
  if (res && res.statusCode === 404) {
    // 未知设备 → DEVICE_OFFLINE；未知/过期命令 → STALE_COMMAND（不要把协议错误误报成设备离线）
    return errors.createError(code === 'STALE_COMMAND' ? 'STALE_COMMAND' : 'DEVICE_OFFLINE', message)
  }
  if (res && res.statusCode === 409) {
    return errors.createError('REVISION_CONFLICT', message)
  }
  if (res && res.statusCode === 429) {
    return errors.createError('BUSY', message)
  }
  if (res && res.statusCode === 503) {
    return errors.createError('DEVICE_OFFLINE', message)
  }
  if (res && res.statusCode === 501) {
    return errors.createError('NOT_IMPLEMENTED', message)
  }
  return errors.createError(code, message)
}

/**
 * @param {object} env config/index.js 的环境（mode==='gateway'）
 */
function createGatewayTransport(env) {
  const deviceId = encodeURIComponent(env.deviceId)
  const statePath = '/api/v1/devices/' + deviceId + '/state'
  const commandPath = '/api/v1/devices/' + deviceId + '/commands'

  return {
    name: 'gateway',
    describe: function () {
      return '应用服务（' + env.baseUrl + '）'
    },

    getState: function () {
      return httpRequest(env, 'GET', statePath, null, 10000).then(function (res) {
        if (res.statusCode !== 200) throw errorFromResponse(res)
        const state = res.data || {}
        if (!state.receivedAt) state.receivedAt = Date.now()
        return state
      })
    },

    sendCommand: function (action, params, meta) {
      const safeMeta = meta || {}
      const requestId = safeMeta.requestId || idUtil.createRequestId(action)
      const payload = {
        requestId: requestId,
        action: action,
        params: params || {}
      }
      if (safeMeta.expectedRevision !== undefined && safeMeta.expectedRevision !== null) {
        payload.expectedRevision = safeMeta.expectedRevision
      }

      return httpRequest(env, 'POST', commandPath, payload, 10000)
        .then(function (res) {
          if (res.statusCode !== 202) throw errorFromResponse(res)
          const timeoutMs = env.commandTimeoutMs || 9000
          const deadline = Date.now() + timeoutMs
          const resultPath = commandPath + '/' + encodeURIComponent(requestId)

          function poll() {
            if (Date.now() > deadline) {
              throw errors.createError('TIMEOUT', '等待设备执行结果超时，结果未知')
            }
            return httpRequest(env, 'GET', resultPath, null, 8000).then(function (pollRes) {
              if (pollRes.statusCode >= 400) throw errorFromResponse(pollRes)
              const body = pollRes.data || {}
              const status = body.status || 'pending'
              if (status === 'applied' || status === 'rejected') {
                const result = body.result || {
                  requestId: requestId,
                  action: action,
                  status: status,
                  errorCode: status === 'rejected' ? body.errorCode || 'UNKNOWN' : null,
                  message: body.message || '',
                  saved: !!body.saved,
                  configRevision: body.configRevision,
                  params: params || {},
                  appliedAt: Date.now()
                }
                if (!result.requestId) result.requestId = requestId
                if (!result.action) result.action = action
                if (!result.params) result.params = params || {}
                return result
              }
              return delay(300).then(poll)
            })
          }

          return poll()
        })
    },

    health: function () {
      return httpRequest(env, 'GET', '/api/v1/health', null, 5000).then(function (res) {
        if (res.statusCode !== 200) throw errorFromResponse(res)
        return res.data || {}
      })
    }
  }
}

module.exports = {
  createGatewayTransport
}
