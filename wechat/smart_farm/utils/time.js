// utils/time.js
// 时间格式化与"数据年龄"工具，纯函数，便于 Node 侧单测。

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/**
 * 格式化为 HH:mm:ss
 * @param {number|string|Date|null} value
 * @returns {string} 无效值返回 '--'
 */
function formatTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
}

/**
 * 格式化为 MM-DD HH:mm
 * @param {number|string|Date|null} value
 * @returns {string}
 */
function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return (
    pad2(date.getMonth() + 1) +
    '-' +
    pad2(date.getDate()) +
    ' ' +
    pad2(date.getHours()) +
    ':' +
    pad2(date.getMinutes())
  )
}

/**
 * 相对当前时间的人话年龄，例如 "刚刚" / "12 秒前" / "3 分钟前" / "2 小时前"
 * @param {number|null} timestamp 毫秒时间戳
 * @param {number} [now]
 * @returns {string}
 */
function formatAge(timestamp, now) {
  if (!isFinite(timestamp) || timestamp <= 0) return '--'
  const current = isFinite(now) ? now : Date.now()
  const diff = Math.max(0, current - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 3) return '刚刚'
  if (seconds < 60) return seconds + ' 秒前'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + ' 分钟前'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + ' 小时前'
  return Math.floor(hours / 24) + ' 天前'
}

/**
 * 判断数据是否过期
 * @param {number|null} timestamp 采样/接收时间
 * @param {number} staleAfterMs
 * @param {number} [now]
 * @returns {boolean}
 */
function isStale(timestamp, staleAfterMs, now) {
  if (!isFinite(timestamp) || timestamp <= 0) return true
  const current = isFinite(now) ? now : Date.now()
  return current - timestamp > staleAfterMs
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

module.exports = {
  formatTime,
  formatDateTime,
  formatAge,
  isStale
}
