// pages/provisioning/provisioning.js
// NFC 配网页：能力提示、记录校验、逐步骤进度与写入结果。
// 页面只调用 services/device 与 services/nfc，不直接接触 NFC/传输/存储。

const device = require('../../services/device')
const nfc = require('../../services/nfc')

const FIELD_REASON = {
  REQUIRED: '不能为空',
  NOT_STRING: '必须是字符串',
  TOO_LONG: '超出长度上限',
  NON_ASCII: '仅支持英文、数字等 ASCII 字符；中文或全角符号会丢失信息',
  UNSAFE_CHAR: '不能包含双引号、反斜杠或控制字符'
}

const WRITE_HINTS = {
  INVALID_INPUT: '请按输入框下的提示修改后重试；当前记录格式仅支持可见 ASCII 字符。',
  NFC_NOT_SUPPORTED: '请改用安卓真机辅助写入，或使用模拟写入验证流程。',
  NFC_ABORTED: '操作已取消，可修改后重新写入。',
  NFC_TAG_NOT_FOUND: '将手机 NFC 区域贴近板载标签，保持 1–2 秒后重试。',
  NFC_TAG_READ_ONLY: '确认标签未被锁定，或更换可写标签。',
  NFC_WRITE_FAILED: '检查标签容量与贴合位置后重试。',
  NFC_TIMEOUT: '重新贴近标签后再试。',
  UNKNOWN: '请检查 NFC 环境和标签后重试。'
}

const WRITE_MESSAGES = {
  INVALID_INPUT: '配网信息不合法',
  NFC_NOT_SUPPORTED: '当前环境不支持真实 NFC 写入',
  NFC_ABORTED: '已取消 NFC 操作',
  NFC_TAG_NOT_FOUND: '未发现可写的 NFC 标签',
  NFC_TAG_READ_ONLY: '标签只读或已锁定',
  NFC_WRITE_FAILED: '写入 NFC 记录失败',
  NFC_TIMEOUT: 'NFC 操作超时',
  UNKNOWN: '写入标签失败'
}

function platformLabel(platform) {
  if (platform === 'ios') return 'iOS'
  if (platform === 'android') return 'Android'
  if (platform === 'devtools') return '开发者工具'
  return platform || '未知环境'
}

function describeCapability(capability) {
  const cap = capability || {}
  const platform = cap.platform || 'unknown'
  const hasApi = !!cap.hasApi
  const supported = !!cap.supported
  const canSimulate = typeof cap.canSimulate === 'boolean' ? cap.canSimulate : !supported
  let assistText = ''

  if (!supported) {
    if (platform === 'ios') {
      assistText = 'iPhone 小程序不支持完整 NFC 写标签，需安卓辅助或使用模拟写入；记录格式必须与板端一致。'
    } else if (!hasApi) {
      assistText = '当前环境没有可用的 NFC 接口，需安卓真机辅助或使用模拟写入验证流程。'
    } else {
      assistText = '当前平台未经真机验证，需安卓辅助或使用模拟写入。'
    }
  } else {
    assistText = '当前环境支持真实 NFC；请使用安卓真机贴近标签，并确认标签可写、容量足够。'
  }

  return {
    platform: platform,
    platformText: platformLabel(platform),
    hasApi: hasApi,
    supported: supported,
    canSimulate: canSimulate,
    note: cap.note || '未能获取 NFC 能力说明。',
    statusText: supported ? '支持真实 NFC' : '模拟写入 / 需辅助',
    badgeClass: supported ? 'badge-ok' : 'badge-warn',
    needAssist: !supported,
    assistText: assistText
  }
}

function describeEnvironment(capability) {
  const env = device.getEnv() || {}
  const envMode = env.mode === 'gateway' ? 'gateway' : 'mock'
  const cap = capability || {}
  const willSimulate = envMode === 'mock' || !cap.supported || cap.canSimulate === true
  let environmentNote = ''

  if (envMode === 'mock') {
    environmentNote = '当前为 mock 环境：点击写入会执行模拟流程，不会触碰真实 NFC 标签。'
  } else if (!cap.supported) {
    environmentNote = '当前环境无法真实写入 NFC，将自动执行模拟写入；真实写入请在安卓真机使用 gateway 模式。'
  } else {
    environmentNote = '当前为华为云直连环境：点击写入会尝试真实 NFC 标签写入，此操作无需电脑后端。'
  }

  return {
    envMode: envMode,
    willSimulate: willSimulate,
    environmentNote: environmentNote,
    writeButtonText: willSimulate ? '模拟写入标签' : '写入标签'
  }
}

function byteLength(value) {
  if (!value) return 0
  if (typeof value.byteLength === 'number') return value.byteLength
  if (typeof value.length === 'number') return value.length
  return 0
}

function bufferText(value) {
  if (!value) return ''
  const view = value instanceof Uint8Array ? value : new Uint8Array(value)
  let text = ''
  for (let i = 0; i < view.length; i++) text += String.fromCharCode(view[i])
  return text
}

function warningsOf(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(function (item) {
      if (!item) return ''
      if (typeof item === 'string') return item
      return item.message || ''
    })
    .filter(function (text) {
      return !!text
    })
}

function maskedPayload(ssid) {
  return JSON.stringify({
    ssid: String(ssid === undefined || ssid === null ? '' : ssid),
    passwd: '***'
  })
}

function buildResult(result, ssid) {
  const data = result || {}
  const record = data.record || {}
  const bytes = data.bytes || {}
  const typeBytes = typeof bytes.type === 'number' ? bytes.type : byteLength(record.type)
  const idLength = typeof bytes.id === 'number' ? bytes.id : byteLength(record.id)
  const payloadLength = typeof bytes.payload === 'number' ? bytes.payload : byteLength(record.payload)
  const totalBytes = typeof bytes.total === 'number' ? bytes.total : typeBytes + idLength + payloadLength
  const simulated = !!data.simulated
  const verified = data.verified === true
  const warnings = warningsOf(data.warnings)
  const typeText = data.texts && data.texts.typeText ? String(data.texts.typeText) : bufferText(record.type)
  let verifyMessage = ''
  if (typeof data.verifyMessage === 'string' && data.verifyMessage) {
    verifyMessage = data.verifyMessage
  } else if (!simulated) {
    verifyMessage = verified ? '回读一致' : '未取得一致的回读结果'
  }

  return {
    ssid: String(ssid === undefined || ssid === null ? '' : ssid),
    simulated: simulated,
    modeText: simulated ? '模拟写入' : '真实写入',
    badgeClass: simulated ? 'badge-warn' : 'badge-ok',
    tnf: record.tnf === undefined || record.tnf === null ? '--' : String(record.tnf),
    typeText: typeText || '--',
    typeBytes: typeBytes,
    idLength: idLength,
    payloadLength: payloadLength,
    totalBytes: totalBytes,
    payloadSummary: maskedPayload(ssid),
    warnings: warnings,
    hasWarnings: warnings.length > 0,
    verified: verified,
    verifiedLabel: verified ? '通过（verified=true）' : '未通过（verified=false）',
    verifyMessage: verifyMessage
  }
}

function isFieldName(name) {
  return name === 'ssid' || name === 'passwd'
}

function fieldReasonOf(item) {
  if (item.code && FIELD_REASON[item.code]) return FIELD_REASON[item.code]
  const message = typeof item.message === 'string' ? item.message : ''
  if (!message) return '输入不合法'
  const prefix = item.field + ': '
  return message.indexOf(prefix) === 0 ? message.slice(prefix.length) : message
}

function fieldErrorsOf(err) {
  const out = { ssid: '', passwd: '' }
  if (!err) return out
  const list = Array.isArray(err.errors) ? err.errors : []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item || !isFieldName(item.field) || out[item.field]) continue
    out[item.field] = fieldReasonOf(item)
  }
  if (isFieldName(err.field) && !out[err.field]) {
    const message = typeof err.message === 'string' ? err.message : ''
    const prefix = err.field + ': '
    if (!message) {
      out[err.field] = '请检查该字段后重试'
    } else {
      out[err.field] = message.indexOf(prefix) === 0 ? message.slice(prefix.length) : message
    }
  }
  return out
}

function writeErrorOf(err) {
  const code = err && err.code ? err.code : 'UNKNOWN'
  let message = ''
  if (typeof err === 'string' && err) {
    message = err
  } else if (err && err.message) {
    message = String(err.message)
  }
  if (!message) message = WRITE_MESSAGES[code] || WRITE_MESSAGES.UNKNOWN

  let hint = ''
  if (err && err.hint) hint = String(err.hint)
  if (!hint) hint = WRITE_HINTS[code] || WRITE_HINTS.UNKNOWN

  return { message: message, hint: hint }
}

Page({
  data: {
    loading: true,
    view: null,
    banner: null,
    capability: null,
    envMode: 'mock',
    willSimulate: true,
    environmentNote: '',
    writeButtonText: '写入标签',
    ssid: '',
    passwd: '',
    fieldErrors: { ssid: '', passwd: '' },
    writing: false,
    steps: [],
    result: null,
    error: null
  },

  onLoad() {
    this._unloaded = false
    this._refreshing = false
    const capability = nfc.getCapability() || {}
    const capabilityView = describeCapability(capability)
    this.setData(Object.assign({ capability: capabilityView }, describeEnvironment(capabilityView)))
  },

  onShow() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
    this.applyEnvContext(this.data.capability)
    this.refresh()
    const env = device.getEnv() || {}
    const interval = Number(env.pollIntervalMs) > 0 ? Number(env.pollIntervalMs) : 5000
    this._pollTimer = setInterval(this.refresh.bind(this), interval)
  },

  onHide() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  onUnload() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
    this._unloaded = true
  },

  applyEnvContext(capability) {
    this.setData(describeEnvironment(capability))
  },

  async refresh() {
    if (this._unloaded || this._refreshing) return
    this._refreshing = true
    try {
      const res = await device.refresh()
      if (this._unloaded) return
      const view = res && res.ok ? res.view : null
      let banner = null
      if (!res || !res.ok) {
        const message = res && res.error && res.error.message ? res.error.message : '设备状态暂不可用'
        banner = { level: 'warn', text: '设备状态暂不可用：' + message }
      } else if (view && view.online === false) {
        banner = { level: 'err', text: '设备离线，显示的是最后一次缓存状态' }
      } else if (view && view.stale) {
        banner = { level: 'warn', text: '数据已过期（' + view.ageText + '），请等待设备上报' }
      }
      this.setData({ loading: false, view: view, banner: banner })
    } catch (e) {
      if (!this._unloaded) {
        this.setData({ loading: false, banner: { level: 'warn', text: '设备状态刷新失败，请稍后重试' } })
      }
    } finally {
      this._refreshing = false
    }
  },

  onSsidInput(event) {
    this.setData({
      ssid: event.detail.value,
      'fieldErrors.ssid': ''
    })
  },

  onPasswdInput(event) {
    this.setData({
      passwd: event.detail.value,
      'fieldErrors.passwd': ''
    })
  },

  onProgress(progress) {
    if (this._unloaded || !progress) return
    const steps = (this.data.steps || []).concat([
      {
        step: progress.step || '',
        text: progress.text || progress.step || '',
        detail: progress.detail ? String(progress.detail) : ''
      }
    ])
    this.setData({ steps: steps })
  },

  async onWrite() {
    if (this.data.writing) return
    const credentials = {
      ssid: this.data.ssid,
      passwd: this.data.passwd
    }

    this.setData({
      writing: true,
      steps: [],
      result: null,
      error: null,
      fieldErrors: { ssid: '', passwd: '' }
    })

    try {
      const result = await nfc.writeWifi(credentials, {
        env: device.getEnv(),
        onProgress: this.onProgress.bind(this)
      })
      if (this._unloaded) return
      this.setData({ result: buildResult(result, credentials.ssid) })
    } catch (err) {
      if (this._unloaded) return
      this.setData({
        error: writeErrorOf(err),
        fieldErrors: fieldErrorsOf(err)
      })
    } finally {
      if (!this._unloaded) this.setData({ writing: false })
    }
  }
})
