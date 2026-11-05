// models/errors.js
// 统一错误码与人话映射。设备端/应用服务/客户端错误都收敛到这里。
// 错误码来源：doc/07 §7（统一错误码）。

const CODES = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_THRESHOLD_RANGE: 'INVALID_THRESHOLD_RANGE',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  DUPLICATE_CONFLICT: 'DUPLICATE_CONFLICT',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  STALE_COMMAND: 'STALE_COMMAND',
  BUSY: 'BUSY',
  SENSOR_INVALID: 'SENSOR_INVALID',
  ALARM_LOCKED: 'ALARM_LOCKED',
  NV_READ_FAILED: 'NV_READ_FAILED',
  NV_WRITE_FAILED: 'NV_WRITE_FAILED',
  NV_VERIFY_FAILED: 'NV_VERIFY_FAILED',
  HARDWARE_ERROR: 'HARDWARE_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  // NFC 相关（小程序侧）
  NFC_NOT_SUPPORTED: 'NFC_NOT_SUPPORTED',
  NFC_ABORTED: 'NFC_ABORTED',
  NFC_TAG_NOT_FOUND: 'NFC_TAG_NOT_FOUND',
  NFC_TAG_READ_ONLY: 'NFC_TAG_READ_ONLY',
  NFC_WRITE_FAILED: 'NFC_WRITE_FAILED',
  NFC_TIMEOUT: 'NFC_TIMEOUT',
  // 客户端本地错误
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_INPUT: 'INVALID_INPUT',
  UNKNOWN: 'UNKNOWN'
}

const DESCRIPTIONS = {
  PROVIDER_UNAVAILABLE: { message: '华为云请求失败', hint: '查看下方详情，检查 IAM 配置、IoTDA 地址和网络', retryable: true },
  INVALID_PAYLOAD: { message: '请求参数不合法', hint: '检查字段名、类型和必填项', retryable: false },
  UNSUPPORTED_VERSION: { message: '协议版本不受支持', hint: '三端需使用同一协议版本', retryable: false },
  UNSUPPORTED_CAPABILITY: { message: '设备不支持该功能', hint: '查看诊断页的能力信息', retryable: false },
  OUT_OF_RANGE: { message: '数值超出允许范围', hint: '按页面提示的范围重新输入', retryable: false },
  INVALID_THRESHOLD_RANGE: {
    message: '阈值范围不合法',
    hint: '下限必须小于上限，且都在 0–100 之间',
    retryable: false
  },
  REVISION_CONFLICT: {
    message: '配置已被其他操作修改',
    hint: '先刷新设备状态，再基于最新版本重新保存',
    retryable: true
  },
  DUPLICATE_CONFLICT: {
    message: '同一请求 ID 携带了不同参数',
    hint: '重新发起一次操作',
    retryable: true
  },
  DEVICE_OFFLINE: { message: '设备离线', hint: '检查设备供电、Wi-Fi 与华为云设备状态', retryable: true },
  STALE_COMMAND: {
    message: '命令已过期，未执行',
    hint: '刷新状态后重新操作，避免执行旧命令',
    retryable: true
  },
  BUSY: { message: '设备忙，请稍后重试', hint: '上一条配置/控制命令还在处理', retryable: true },
  SENSOR_INVALID: { message: '传感器数据无效', hint: '等待有效采样或检查传感器接线', retryable: true },
  ALARM_LOCKED: {
    message: '火焰报警锁定中，操作被拒绝',
    hint: '先确认报警解除，再重新开启',
    retryable: false
  },
  NV_READ_FAILED: { message: '读取设备配置失败', hint: '设备存储异常，查看设备日志', retryable: true },
  NV_WRITE_FAILED: { message: '写入设备存储失败', hint: '配置未保存，请重试或检查 Flash', retryable: true },
  NV_VERIFY_FAILED: {
    message: '写入后回读校验失败',
    hint: '配置可能未落盘，请重启设备后重新读取',
    retryable: true
  },
  HARDWARE_ERROR: { message: '硬件错误', hint: '检查执行器/传感器与供电', retryable: true },
  NOT_IMPLEMENTED: { message: '当前环境尚未实现该能力', hint: 'mock/本地适配中属于预期状态', retryable: false },
  NFC_NOT_SUPPORTED: {
    message: '当前设备/环境不支持小程序 NFC',
    hint: '安卓真机可用；iPhone 请用辅助工具，且记录格式须一致',
    retryable: false
  },
  NFC_ABORTED: { message: '已取消 NFC 操作', hint: '', retryable: true },
  NFC_TAG_NOT_FOUND: {
    message: '未发现可写的 NFC 标签',
    hint: '把手机 NFC 区域贴近板载标签，保持 1–2 秒后重试',
    retryable: true
  },
  NFC_TAG_READ_ONLY: { message: '标签只读或已锁定', hint: '确认标签未被锁定，或更换标签', retryable: false },
  NFC_WRITE_FAILED: { message: '写入 NFC 记录失败', hint: '检查标签容量与贴合位置后重试', retryable: true },
  NFC_TIMEOUT: { message: 'NFC 操作超时', hint: '重新贴近标签并重试', retryable: true },
  NETWORK_ERROR: { message: '无法访问华为云', hint: '检查手机网络、华为云配置和 HTTPS 合法域名', retryable: true },
  TIMEOUT: { message: '操作超时，结果未知', hint: '先刷新状态核对，不要直接重复发送开泵命令', retryable: true },
  INVALID_INPUT: { message: '输入不合法', hint: '按页面提示修正后重试', retryable: false },
  UNKNOWN: { message: '未知错误', hint: '查看诊断页的最近回执', retryable: true }
}

/**
 * 把任意错误对象归类成统一错误码。
 * @param {*} err
 * @returns {string}
 */
function normalizeCode(err) {
  if (!err) return CODES.UNKNOWN
  if (typeof err === 'string') return CODES[err] ? err : CODES.UNKNOWN
  if (err.code && CODES[err.code]) return err.code
  if (err.errorCode && CODES[err.errorCode]) return err.errorCode
  return CODES.UNKNOWN
}

/**
 * 生成可展示的错误描述。
 * @param {string|object|Error} err
 * @param {string} [fallbackMessage]
 * @returns {{code:string, message:string, hint:string, retryable:boolean, detail:string}}
 */
function describeError(err, fallbackMessage) {
  const code = normalizeCode(err)
  const base = DESCRIPTIONS[code] || DESCRIPTIONS.UNKNOWN
  let detail = ''
  if (err && typeof err === 'object') {
    if (typeof err.message === 'string' && err.message && err.message !== base.message) detail = err.message
    else if (typeof err.detail === 'string') detail = err.detail
  } else if (typeof err === 'string' && err !== code) {
    detail = err
  }
  return {
    code: code,
    message: base.message,
    hint: base.hint,
    retryable: base.retryable,
    detail: detail || fallbackMessage || ''
  }
}

/**
 * 生成一个带有 code 的错误对象（用于 Promise reject / 客户端校验）。
 * @param {string} code
 * @param {string} [message]
 * @param {object} [extra]
 * @returns {Error}
 */
function createError(code, message, extra) {
  const err = new Error(message || (DESCRIPTIONS[code] && DESCRIPTIONS[code].message) || '错误')
  err.code = CODES[code] ? code : CODES.UNKNOWN
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (key) {
      err[key] = extra[key]
    })
  }
  return err
}

module.exports = {
  CODES,
  DESCRIPTIONS,
  normalizeCode,
  describeError,
  createError
}
