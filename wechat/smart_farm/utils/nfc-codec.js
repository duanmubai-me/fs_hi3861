// utils/nfc-codec.js
// NFC 配网记录编解码（既定基线：沿用老师示例的 example-nfc-v1）。
//
// 基线规则（不要改）：
//   单条 record；tnf = 2；type = str2ab('t')（ASCII 0x74）；
//   id = str2ab(毫秒时间戳十进制字符串，当前 13 位)；
//   payload = str2ab(紧凑 JSON：{"ssid":"...","passwd":"..."})；
//   字节转换沿用示例 str2ab 的逐字符 charCodeAt 行为，不是 UTF-8。
//
// 已知边界：非 ASCII（中文等）、引号、反斜杠在示例实现里不可靠，直接拒绝并提示，
// 不自动转 UTF-8、不截断后报成功。

const TYPE_TEXT = 't'
const TYPE_CODE = 0x74
const MAX_SSID_LEN = 32
const MAX_PASSWD_LEN = 63
const MIN_WPA_PASSWD_LEN = 8

const ERROR_MESSAGES = {
  REQUIRED: '不能为空',
  NOT_STRING: '必须是字符串',
  TOO_LONG: '超出长度上限',
  NON_ASCII: '当前基线只支持英文数字等 ASCII 字符，中文/全角符号会丢失信息',
  UNSAFE_CHAR: '不能包含双引号、反斜杠或控制字符',
  INVALID_RECORD: '记录格式不合法'
}

/**
 * 示例 str2ab：每个字符取 charCodeAt 的低 8 位，返回 ArrayBuffer。
 * 注意：这不是 UTF-8 编码，保持与既定 NFC 基线一致。
 * @param {string} str
 * @returns {ArrayBuffer}
 */
function str2ab(str) {
  const text = String(str == null ? '' : str)
  const buffer = new ArrayBuffer(text.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < text.length; i++) {
    view[i] = text.charCodeAt(i) & 0xff
  }
  return buffer
}

/**
 * ArrayBuffer/Uint8Array → 逐字节字符串（与 str2ab 对称）。
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string}
 */
function ab2str(buf) {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i])
  return out
}

function byteLength(buf) {
  if (!buf) return 0
  if (typeof buf.byteLength === 'number') return buf.byteLength
  return 0
}

/**
 * 判断字符串是否全部为可见 ASCII（0x20–0x7E），且不含 JSON 敏感字符。
 * @param {string} str
 * @returns {{ok:boolean, reason?:string}}
 */
function checkAsciiSafe(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) {
      return { ok: false, reason: 'NON_ASCII' }
    }
  }
  if (str.indexOf('"') >= 0 || str.indexOf('\\') >= 0) {
    return { ok: false, reason: 'UNSAFE_CHAR' }
  }
  return { ok: true }
}

function pushError(list, field, code) {
  list.push({ field: field, code: code, message: field + ': ' + ERROR_MESSAGES[code] })
}

/**
 * 校验 Wi-Fi 配网输入。
 * @param {{ssid:*, passwd:*}} input
 * @returns {{ok:boolean, errors:Array, warnings:Array, normalized:{ssid:string, passwd:string}}}
 */
function validateWifi(input) {
  const errors = []
  const warnings = []
  const raw = input || {}
  const ssid = raw.ssid
  const passwd = raw.passwd

  if (ssid === undefined || ssid === null || ssid === '') {
    pushError(errors, 'ssid', 'REQUIRED')
  } else if (typeof ssid !== 'string') {
    pushError(errors, 'ssid', 'NOT_STRING')
  } else {
    if (ssid.length > MAX_SSID_LEN) pushError(errors, 'ssid', 'TOO_LONG')
    const safe = checkAsciiSafe(ssid)
    if (!safe.ok) pushError(errors, 'ssid', safe.reason)
  }

  if (passwd === undefined || passwd === null) {
    pushError(errors, 'passwd', 'REQUIRED')
  } else if (typeof passwd !== 'string') {
    pushError(errors, 'passwd', 'NOT_STRING')
  } else {
    if (passwd.length > MAX_PASSWD_LEN) pushError(errors, 'passwd', 'TOO_LONG')
    const safe = checkAsciiSafe(passwd)
    if (!safe.ok) pushError(errors, 'passwd', safe.reason)
    if (passwd.length > 0 && passwd.length < MIN_WPA_PASSWD_LEN) {
      warnings.push({
        field: 'passwd',
        code: 'PASSWD_TOO_SHORT',
        message: '密码短于 8 位，多数 Wi-Fi 会拒绝连接；开放网络可忽略'
      })
    }
    if (passwd.length === 0) {
      warnings.push({ field: 'passwd', code: 'PASSWD_EMPTY', message: '密码为空，仅适用于开放网络' })
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    normalized: {
      ssid: typeof ssid === 'string' ? ssid : '',
      passwd: typeof passwd === 'string' ? passwd : ''
    }
  }
}

/**
 * 生成紧凑 JSON 正文（键顺序固定 ssid、passwd；调用前已禁止敏感字符）。
 * @param {{ssid:string, passwd:string}} input
 * @returns {string}
 */
function buildPayload(input) {
  const ssid = String((input && input.ssid) || '')
  const passwd = String((input && input.passwd) || '')
  return '{"ssid":"' + ssid + '","passwd":"' + passwd + '"}'
}

/**
 * 构造既定 NDEF record（尚未写入标签）。
 * @param {{ssid:string, passwd:string}} input
 * @param {number} [timestamp] 毫秒时间戳；默认 Date.now()
 * @returns {{ok:boolean, errors:Array, warnings:Array, record:object|null, texts:object|null, bytes:object|null}}
 */
function encodeWifiRecord(input, timestamp) {
  const checked = validateWifi(input)
  if (!checked.ok) {
    return {
      ok: false,
      errors: checked.errors,
      warnings: checked.warnings,
      record: null,
      texts: null,
      bytes: null
    }
  }

  const ssid = checked.normalized.ssid
  const passwd = checked.normalized.passwd
  const idText = String(timestamp === undefined || timestamp === null ? Date.now() : timestamp)
  const payloadText = buildPayload({ ssid: ssid, passwd: passwd })
  const typeBuffer = str2ab(TYPE_TEXT)
  const idBuffer = str2ab(idText)
  const payloadBuffer = str2ab(payloadText)

  return {
    ok: true,
    errors: [],
    warnings: checked.warnings,
    record: {
      tnf: 2,
      type: typeBuffer,
      id: idBuffer,
      payload: payloadBuffer
    },
    texts: {
      typeText: TYPE_TEXT,
      idText: idText,
      payloadText: payloadText
    },
    bytes: {
      type: byteLength(typeBuffer),
      id: byteLength(idBuffer),
      payload: byteLength(payloadBuffer),
      // 仅业务记录字节合计；不含 NDEF 头/长度域等开销，长度上限须再与标签/板端核对。
      total: byteLength(typeBuffer) + byteLength(idBuffer) + byteLength(payloadBuffer)
    }
  }
}

/**
 * 反解记录正文为对象（板端/测试用，不用于写标签）。
 * @param {string} payloadText
 * @returns {{ssid:string, passwd:string}}
 */
function parsePayload(payloadText) {
  const data = JSON.parse(String(payloadText))
  if (!data || typeof data.ssid !== 'string' || typeof data.passwd !== 'string') {
    throw new Error(ERROR_MESSAGES.INVALID_RECORD)
  }
  return { ssid: data.ssid, passwd: data.passwd }
}

/**
 * 给页面/诊断展示的记录摘要（不含明文密码时由调用方自行脱敏）。
 * @param {object} record
 * @returns {object}
 */
function describeRecord(record) {
  if (!record) {
    return {
      tnf: null,
      typeText: '',
      idText: '',
      payloadText: '',
      typeBytes: 0,
      idBytes: 0,
      payloadBytes: 0,
      totalBytes: 0,
      typeHex: '',
      idHex: ''
    }
  }
  const typeText = ab2str(record.type)
  const idText = ab2str(record.id)
  return {
    tnf: record.tnf,
    typeText: typeText,
    idText: idText,
    payloadText: ab2str(record.payload),
    typeBytes: byteLength(record.type),
    idBytes: byteLength(record.id),
    payloadBytes: byteLength(record.payload),
    totalBytes: byteLength(record.type) + byteLength(record.id) + byteLength(record.payload),
    typeHex: toHex(record.type),
    idHex: toHex(record.id)
  }
}

/**
 * 字节数组转十六进制字符串。
 * @param {ArrayBuffer|Uint8Array|number[]} buf
 * @param {number} [maxBytes] 最多输出的字节数
 * @returns {string}
 */
function toHex(buf, maxBytes) {
  if (!buf) return ''
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const limit = maxBytes && maxBytes > 0 ? Math.min(maxBytes, view.length) : view.length
  let out = ''
  for (let i = 0; i < limit; i++) {
    const h = view[i].toString(16).toUpperCase()
    out += (h.length === 1 ? '0' + h : h) + (i === limit - 1 ? '' : ' ')
  }
  return out
}

module.exports = {
  TYPE_TEXT,
  TYPE_CODE,
  MAX_SSID_LEN,
  MAX_PASSWD_LEN,
  MIN_WPA_PASSWD_LEN,
  str2ab,
  ab2str,
  byteLength,
  validateWifi,
  buildPayload,
  encodeWifiRecord,
  parsePayload,
  describeRecord,
  toHex
}
