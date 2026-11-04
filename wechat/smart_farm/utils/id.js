// utils/id.js
// requestId 生成：每次用户操作一个，网络重试沿用同一个。

let counter = 0

/**
 * @param {string} [prefix]
 * @returns {string} 形如 set_thresholds-1a2b3c-4d5e6f
 */
function createRequestId(prefix) {
  counter = (counter + 1) % 100000
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  const c = counter.toString(36)
  return (prefix || 'req') + '-' + t + '-' + c + r
}

/**
 * 判断字符串是否像一个 requestId（用于诊断页展示校验）
 * @param {string} value
 * @returns {boolean}
 */
function isRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{5,63}$/.test(value)
}

module.exports = {
  createRequestId,
  isRequestId
}
