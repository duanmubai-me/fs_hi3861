// utils/units.js
// 单位与数值展示工具。页面不直接拼单位字符串。

/**
 * 保留一位小数；无效值返回 null
 * @param {number|string|null} value
 * @returns {number|null}
 */
function round1(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  if (!isFinite(n)) return null
  return Math.round(n * 10) / 10
}

/**
 * 整数；无效值返回 null
 * @param {number|string|null} value
 * @returns {number|null}
 */
function toInt(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const n = Number(value)
  if (!isFinite(n)) return null
  return Math.round(n)
}

/**
 * 湿度展示值，无效时返回 '--'
 * @param {number|null} value
 * @returns {string}
 */
function formatHumidity(value) {
  const n = round1(value)
  return n === null ? '--' : n.toFixed(1)
}

/**
 * 温度展示值
 * @param {number|null} value
 * @returns {string}
 */
function formatTemperature(value) {
  const n = round1(value)
  return n === null ? '--' : n.toFixed(1)
}

/**
 * 湿度单位（随传感器类型变化）
 * @param {string} sensorKind air_rh | soil_relative
 * @returns {string}
 */
function humidityUnit(sensorKind) {
  return sensorKind === 'soil_relative' ? '%（标定相对值）' : '%RH'
}

/**
 * 湿度类型中文名
 * @param {string} sensorKind
 * @returns {string}
 */
function sensorKindText(sensorKind) {
  return sensorKind === 'soil_relative' ? '土壤湿度（标定相对值）' : '空气相对湿度'
}

/**
 * ppm / ppb 数值展示
 * @param {number|null} value
 * @param {string} unit
 * @returns {string}
 */
function formatConcentration(value, unit) {
  const n = toInt(value)
  if (n === null) return '--'
  return n + ' ' + (unit || '')
}

/**
 * 原始值（未标定气体/火焰）展示
 * @param {number|null} value
 * @returns {string}
 */
function formatRaw(value) {
  const n = toInt(value)
  return n === null ? '--' : String(n)
}

/**
 * 0–100 百分数输入校验（整数）
 * @param {*} value
 * @returns {number|null} 合法返回整数，否则 null
 */
function parsePercentInt(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null
  const n = Number(value)
  if (!isFinite(n) || Math.floor(n) !== n) return null
  if (n < 0 || n > 100) return null
  return n
}

module.exports = {
  round1,
  toInt,
  formatHumidity,
  formatTemperature,
  humidityUnit,
  sensorKindText,
  formatConcentration,
  formatRaw,
  parsePercentInt
}
