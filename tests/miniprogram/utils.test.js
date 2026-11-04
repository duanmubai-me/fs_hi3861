// tests/miniprogram/utils.test.js
// 覆盖 utils/units.js 与 utils/time.js 的边界值。
'use strict'

const h = require('./harness')
const units = require(h.SM_ROOT + '/utils/units')
const time = require(h.SM_ROOT + '/utils/time')
const assert = h.assert

// 固定本地时间：2024-01-02 03:04:05（用本地构造，避免时区差异）
const NOW = new Date(2024, 0, 2, 3, 4, 5).getTime()

h.describe('units.parsePercentInt', function () {
  h.it('accepts integers 0..100 and integer strings', function () {
    ;[0, 1, 30, 99, 100].forEach(function (n) {
      assert.strictEqual(units.parsePercentInt(n), n)
    })
    assert.strictEqual(units.parsePercentInt('40'), 40)
    assert.strictEqual(units.parsePercentInt('0'), 0)
    assert.strictEqual(units.parsePercentInt('100'), 100)
  })

  h.it('rejects out-of-range, fractional, empty and non-numeric input', function () {
    ;[-1, 101, 30.5, '30.5', 'abc', NaN, Infinity, -Infinity, '', null, undefined].forEach(function (value) {
      assert.strictEqual(units.parsePercentInt(value), null, 'expected null for ' + String(value))
    })
  })

  // 源码 parsePercentInt 用 Number(value) 判定，布尔 true 会变成 1（契约要求 0–100 整数输入）。
  h.it('parsePercentInt(true) should reject booleans', function () {
    assert.strictEqual(units.parsePercentInt(true), null)
  })
})

h.describe('units.round1', function () {
  h.it('rounds to one decimal', function () {
    assert.strictEqual(units.round1(45.15), 45.2)
    assert.strictEqual(units.round1(45.14), 45.1)
    assert.strictEqual(units.round1(26.34), 26.3)
    assert.strictEqual(units.round1(26.35), 26.4)
    assert.strictEqual(units.round1('46.26'), 46.3)
    assert.strictEqual(units.round1(-1.25), -1.2)
    assert.strictEqual(units.round1(0), 0)
    assert.strictEqual(units.round1(100), 100)
  })

  h.it('returns null for non-finite / non-numeric input', function () {
    ;[undefined, NaN, Infinity, -Infinity, 'abc'].forEach(function (value) {
      assert.strictEqual(units.round1(value), null, 'expected null for ' + String(value))
    })
  })

  // Number(null) === 0，导致 round1(null) 返回 0；JSDoc 写的是"无效值返回 null"。
  h.it('round1(null) should be null', function () {
    assert.strictEqual(units.round1(null), null)
  })
})

h.describe('units.formatHumidity / formatTemperature', function () {
  h.it('formats one decimal with no unit suffix', function () {
    assert.strictEqual(units.formatHumidity(45.15), '45.2')
    assert.strictEqual(units.formatHumidity(45), '45.0')
    assert.strictEqual(units.formatHumidity(0), '0.0')
    assert.strictEqual(units.formatHumidity(100), '100.0')
    assert.strictEqual(units.formatTemperature(26.34), '26.3')
    assert.strictEqual(units.formatTemperature(-3.25), '-3.2')
    assert.strictEqual(units.formatTemperature(undefined), '--')
    assert.strictEqual(units.formatHumidity(undefined), '--')
    assert.strictEqual(units.formatHumidity('abc'), '--')
  })

  // 同 round1 的根因：null 被当作 0，展示成 0.0 而不是 '--'。
  h.it('formatHumidity(null) should be "--"', function () {
    assert.strictEqual(units.formatHumidity(null), '--')
  })

  h.it('formatTemperature(null) should be "--"', function () {
    assert.strictEqual(units.formatTemperature(null), '--')
  })
})

h.describe('units.formatRaw / formatConcentration', function () {
  h.it('formats raw values and concentrations', function () {
    assert.strictEqual(units.formatRaw(130), '130')
    assert.strictEqual(units.formatRaw(0), '0')
    assert.strictEqual(units.formatRaw(undefined), '--')
    assert.strictEqual(units.formatConcentration(430, 'ppm'), '430 ppm')
    assert.strictEqual(units.formatConcentration(16, 'ppb'), '16 ppb')
    assert.strictEqual(units.formatConcentration(0, 'ppm'), '0 ppm')
    assert.strictEqual(units.formatConcentration(undefined, 'ppm'), '--')
  })

  h.it('formatRaw(null) should be "--"', function () {
    assert.strictEqual(units.formatRaw(null), '--')
  })

  h.it('formatConcentration(null, "ppm") should be "--"', function () {
    assert.strictEqual(units.formatConcentration(null, 'ppm'), '--')
  })
})

h.describe('units.toInt / labels', function () {
  h.it('converts to integer but rejects non-finite input', function () {
    assert.strictEqual(units.toInt(45.6), 46)
    assert.strictEqual(units.toInt('16'), 16)
    assert.strictEqual(units.toInt(undefined), null)
    assert.strictEqual(units.toInt(NaN), null)
    assert.strictEqual(units.toInt(Infinity), null)
  })

  h.it('toInt(null) should be null', function () {
    assert.strictEqual(units.toInt(null), null)
  })

  h.it('maps sensor kind to unit and Chinese label', function () {
    assert.strictEqual(units.humidityUnit('air_rh'), '%RH')
    assert.strictEqual(units.humidityUnit('soil_relative'), '%（标定相对值）')
    assert.strictEqual(units.humidityUnit(undefined), '%RH')
    assert.strictEqual(units.sensorKindText('air_rh'), '空气相对湿度')
    assert.strictEqual(units.sensorKindText('soil_relative'), '土壤湿度（标定相对值）')
    assert.strictEqual(units.sensorKindText(undefined), '空气相对湿度')
  })
})

h.describe('time.formatAge', function () {
  h.it('uses 刚刚 / 秒 / 分钟 / 小时 / 天 tiers at boundaries', function () {
    assert.strictEqual(time.formatAge(NOW - 2999, NOW), '刚刚')
    assert.strictEqual(time.formatAge(NOW - 3000, NOW), '3 秒前')
    assert.strictEqual(time.formatAge(NOW - 59999, NOW), '59 秒前')
    assert.strictEqual(time.formatAge(NOW - 60000, NOW), '1 分钟前')
    assert.strictEqual(time.formatAge(NOW - 90000, NOW), '1 分钟前')
    assert.strictEqual(time.formatAge(NOW - 3599999, NOW), '59 分钟前')
    assert.strictEqual(time.formatAge(NOW - 3600000, NOW), '1 小时前')
    assert.strictEqual(time.formatAge(NOW - 86399999, NOW), '23 小时前')
    assert.strictEqual(time.formatAge(NOW - 86400000, NOW), '1 天前')
    assert.strictEqual(time.formatAge(NOW - 2 * 86400000, NOW), '2 天前')
  })

  h.it('treats future timestamps as 刚刚 and invalid timestamps as --', function () {
    assert.strictEqual(time.formatAge(NOW + 5000, NOW), '刚刚')
    assert.strictEqual(time.formatAge(NOW, NOW), '刚刚')
    ;[null, undefined, 0, -1, NaN].forEach(function (value) {
      assert.strictEqual(time.formatAge(value, NOW), '--', 'expected -- for ' + String(value))
    })
  })
})

h.describe('time.isStale', function () {
  h.it('is not stale at exactly staleAfterMs, stale one ms later', function () {
    assert.strictEqual(time.isStale(NOW - 90000, 90000, NOW), false)
    assert.strictEqual(time.isStale(NOW - 90001, 90000, NOW), true)
    assert.strictEqual(time.isStale(NOW, 90000, NOW), false)
    assert.strictEqual(time.isStale(NOW - 1, 90000, NOW), false)
  })

  h.it('handles custom threshold and invalid timestamps', function () {
    assert.strictEqual(time.isStale(NOW, 0, NOW), false)
    assert.strictEqual(time.isStale(NOW - 1, 0, NOW), true)
    assert.strictEqual(time.isStale(0, 90000, NOW), true)
    assert.strictEqual(time.isStale(null, 90000, NOW), true)
    assert.strictEqual(time.isStale(undefined, 90000, NOW), true)
    assert.strictEqual(time.isStale(NaN, 90000, NOW), true)
  })
})

h.describe('time.formatTime / formatDateTime', function () {
  h.it('formats local HH:mm:ss and MM-DD HH:mm', function () {
    assert.strictEqual(time.formatTime(NOW), '03:04:05')
    assert.strictEqual(time.formatTime(new Date(2024, 0, 2, 3, 4, 5)), '03:04:05')
    assert.strictEqual(time.formatDateTime(NOW), '01-02 03:04')
    assert.strictEqual(time.formatDateTime(NOW - 60000), '01-02 03:03')
  })

  h.it('returns -- for empty / invalid values', function () {
    ;[null, undefined, '', 'not-a-date', NaN].forEach(function (value) {
      assert.strictEqual(time.formatTime(value), '--', 'expected -- for ' + String(value))
      assert.strictEqual(time.formatDateTime(value), '--', 'expected -- for ' + String(value))
    })
  })
})

h.main('utils.test.js')
