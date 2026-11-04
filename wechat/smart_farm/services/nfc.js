// services/nfc.js
// 微信 NFC 写标签封装（既定 example-nfc-v1 记录）。
// - 能力检测：平台 + wx.getNFCAdapter 是否存在；iOS 小程序不支持完整 NFC，页面须降级提示；
// - 真实写入：getNFCAdapter → getNdef → startDiscovery → connect → writeNdefMessage({records})；
// - mock 模式/无 NFC 环境：模拟到"标签写入成功"这一步并返回记录摘要，不假装板端已读取/联网；
// - 所有路径最后都清理监听、停止发现、关闭连接，避免重复写。
//
// 注意：records 只属于 writeNdefMessage；connect() 只接受回调，不接收 records。

const codec = require('../utils/nfc-codec')
const errors = require('../models/errors')

const STEP_TEXT = {
  prepare: '校验配网信息',
  adapter: '初始化 NFC',
  discovery: '开始发现标签',
  connect: '连接标签',
  write: '写入 NDEF 记录',
  verify: '回读核对',
  done: '完成',
  cleanup: '清理连接'
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function hasNfcApi() {
  return typeof wx !== 'undefined' && typeof wx.getNFCAdapter === 'function'
}

function getPlatform() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      return String(wx.getSystemInfoSync().platform || 'unknown')
    }
  } catch (e) {}
  return 'unknown'
}

/**
 * 当前环境的 NFC 能力。
 * @returns {{platform:string, hasApi:boolean, supported:boolean, canSimulate:boolean, note:string}}
 */
function getCapability() {
  const platform = getPlatform()
  const hasApi = hasNfcApi()
  const isIos = platform === 'ios'
  const supported = hasApi && !isIos
  return {
    platform: platform,
    hasApi: hasApi,
    supported: supported,
    canSimulate: !supported,
    note: supported
      ? platform === 'android'
        ? '安卓端可用小程序 NFC；需在真机上验证标签兼容性'
        : '当前平台未验证小程序 NFC 能力'
      : isIos
        ? 'iPhone 小程序不支持完整 NFC 写标签；请用安卓辅助或独立 NFC 工具（记录格式须一致）'
        : '当前环境没有可用的 NFC 接口（可能未在真机运行或平台不支持）'
  }
}

function emulatorEnabled(env) {
  return !env || env.mode === 'mock' || !getCapability().supported
}

function stepReporter(onProgress) {
  return function report(step, extra) {
    if (typeof onProgress !== 'function') return
    onProgress(
      Object.assign(
        {
          step: step,
          text: STEP_TEXT[step] || step
        },
        extra || {}
      )
    )
  }
}

function wrapError(err, fallbackCode, fallbackMessage) {
  const detail = err && (err.errMsg || err.message)
  const code = (err && err.code) || fallbackCode || 'NFC_WRITE_FAILED'
  let message = fallbackMessage || (code === 'NFC_NOT_SUPPORTED' ? '当前设备不支持小程序 NFC' : 'NFC 操作失败')
  if (detail) message += '：' + detail
  return errors.createError(code, message, { detail: detail })
}

function recordOf(encoded) {
  return {
    tnf: encoded.record.tnf,
    type: encoded.record.type,
    id: encoded.record.id,
    payload: encoded.record.payload
  }
}

function compareRecord(readback, encoded) {
  if (!readback || !encoded) return { matched: false, reason: '没有回读到标签内容' }
  const actual = codec.toHex(readback.payload)
  const expected = codec.toHex(encoded.record.payload)
  if (actual !== expected) {
    return {
      matched: false,
      reason: '回读内容与写入不一致',
      expectedHex: expected,
      actualHex: actual
    }
  }
  return { matched: true, reason: '' }
}

/**
 * 在 mock/无 NFC 环境中模拟写标签，返回与真实流程一致的进度与记录摘要。
 */
async function simulateWrite(encoded, report) {
  report('adapter', { detail: '模拟环境，不触碰真实 NFC' })
  await delay(120)
  report('discovery', { detail: '模拟发现标签' })
  await delay(160)
  report('connect', { detail: '模拟连接标签' })
  await delay(160)
  report('write', { detail: '模拟写入 ' + encoded.bytes.total + ' 字节业务记录' })
  await delay(220)
  report('verify', { detail: '模拟回读（mock 不产生真实回读）' })
  await delay(120)
  return {
    ok: true,
    simulated: true,
    record: encoded.record,
    texts: encoded.texts,
    bytes: encoded.bytes,
    description: codec.describeRecord(encoded.record),
    readback: null,
    verified: false,
    warnings: encoded.warnings,
    note: '模拟写入成功只代表小程序侧记录构造完成，板端读取/联网仍需真实硬件验证'
  }
}

function callNfc(fn, options) {
  return new Promise(function (resolve, reject) {
    const opts = Object.assign({}, options || {}, {
      success: resolve,
      fail: reject
    })
    try {
      fn(opts)
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * 真实写入一条 NDEF record（仅安卓等支持环境）。
 * @param {object} encoded encodeWifiRecord 的返回值
 * @param {Function} report 进度回调
 * @param {{timeoutMs:number, signal:{aborted:boolean}|null}} control 外部中断控制
 */
async function realWrite(encoded, report, control) {
  const capability = getCapability()
  if (!capability.supported) {
    throw errors.createError('NFC_NOT_SUPPORTED', capability.note)
  }

  let adapter = null
  let ndef = null
  let discoveryStarted = false
  let discoveredMessages = null
  let onDiscovered = null
  let onNdefMessage = null

  function cleanup() {
    report('cleanup')
    try {
      if (ndef && onNdefMessage && typeof ndef.offNdefMessage === 'function') ndef.offNdefMessage(onNdefMessage)
    } catch (e) {}
    try {
      if (ndef) ndef.close()
    } catch (e) {}
    try {
      if (adapter && onDiscovered && typeof adapter.offDiscovered === 'function') adapter.offDiscovered(onDiscovered)
    } catch (e) {}
    try {
      if (adapter && discoveryStarted) adapter.stopDiscovery()
    } catch (e) {}
  }

  try {
    report('adapter')
    adapter = wx.getNFCAdapter()
    ndef = adapter.getNdef()
    if (!ndef) throw errors.createError('NFC_NOT_SUPPORTED', '当前设备没有 NDEF 能力')

    onDiscovered = function (res) {
      if (res && Array.isArray(res.messages) && res.messages.length > 0) discoveredMessages = res.messages
    }
    if (typeof adapter.onDiscovered === 'function') adapter.onDiscovered(onDiscovered)
    onNdefMessage = function (res) {
      if (res && Array.isArray(res.messages) && res.messages.length > 0) discoveredMessages = res.messages
    }
    if (typeof ndef.onNdefMessage === 'function') ndef.onNdefMessage(onNdefMessage)

    report('discovery')
    adapter.startDiscovery()
    discoveryStarted = true

    // 等待用户贴标签：connect 失败则重试，直到超时或被中止
    const deadline = Date.now() + (control.timeoutMs || 20000)
    let connected = false
    let lastError = null
    while (Date.now() < deadline) {
      if (control.signal && control.signal.aborted) throw errors.createError('NFC_ABORTED', '已取消写入')
      try {
        await callNfc(function (opts) {
          ndef.connect(opts)
        })
        connected = true
        break
      } catch (e) {
        lastError = e
        await delay(600)
      }
    }
    if (!connected) {
      throw wrapError(lastError, 'NFC_TAG_NOT_FOUND', '未发现可写的 NFC 标签，请贴近板载标签后重试')
    }
    report('connect', { detail: '已连接标签' })

    report('write')
    try {
      await callNfc(function (opts) {
        ndef.writeNdefMessage(
          Object.assign({}, opts, {
            records: [recordOf(encoded)]
          })
        )
      })
    } catch (e) {
      const detail = (e && (e.errMsg || e.message)) || ''
      if (detail.indexOf('readonly') >= 0 || detail.indexOf('read only') >= 0) {
        throw wrapError(e, 'NFC_TAG_READ_ONLY', '标签只读或已锁定，无法写入')
      }
      throw wrapError(e, 'NFC_WRITE_FAILED', '写入 NDEF 记录失败')
    }

    report('verify')
    // 尽力回读：部分机型会在连接/写入后通过 onDiscovered/onNdefMessage 返回当前 NDEF 消息
    for (let i = 0; i < 6 && !discoveredMessages; i++) await delay(250)
    const first = discoveredMessages && discoveredMessages[0]
    const check = compareRecord(first, encoded)

    return {
      ok: true,
      simulated: false,
      record: encoded.record,
      texts: encoded.texts,
      bytes: encoded.bytes,
      description: codec.describeRecord(encoded.record),
      readback: first || null,
      verified: check.matched,
      verifyMessage: check.matched ? '回读一致' : check.reason,
      warnings: encoded.warnings,
      note: ''
    }
  } finally {
    cleanup()
  }
}

/**
 * 写 Wi-Fi 配网记录。
 * @param {{ssid:string, passwd:string}} credentials
 * @param {{env?:object, onProgress?:Function, signal?:{aborted:boolean}, timeoutMs?:number}} [options]
 * @returns {Promise<object>}
 */
function writeWifi(credentials, options) {
  const opts = options || {}
  const report = stepReporter(opts.onProgress)
  const encoded = codec.encodeWifiRecord(credentials)
  if (!encoded.ok) {
    const first = encoded.errors[0]
    const err = errors.createError('INVALID_INPUT', first ? first.message : '配网信息不合法')
    err.field = first ? first.field : ''
    err.errors = encoded.errors
    return Promise.reject(err)
  }

  report('prepare', { detail: '记录 ' + encoded.bytes.total + ' 字节' })

  if (emulatorEnabled(opts.env)) {
    return simulateWrite(encoded, report)
  }
  return realWrite(encoded, report, { timeoutMs: opts.timeoutMs || 20000, signal: opts.signal || null })
}

/**
 * 只做记录构造与校验（不写标签），供诊断页/单测使用。
 * @param {{ssid:string, passwd:string}} credentials
 * @param {number} [timestamp]
 */
function previewRecord(credentials, timestamp) {
  return codec.encodeWifiRecord(credentials, timestamp)
}

module.exports = {
  STEP_TEXT,
  getPlatform,
  getCapability,
  writeWifi,
  previewRecord,
  isEmulator: emulatorEnabled
}
