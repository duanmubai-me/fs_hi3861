// tests/miniprogram/errors.test.js
// 覆盖 models/errors.js：错误码→文案、未知码兜底、detail 规则、createError 带 code。
'use strict'

const h = require('./harness')
const errors = require(h.SM_ROOT + '/models/errors')
const assert = h.assert

h.describe('errors description table', function () {
  h.it('has a description and boolean retryable for every known code', function () {
    Object.keys(errors.CODES).forEach(function (key) {
      const code = errors.CODES[key]
      const description = errors.DESCRIPTIONS[code]
      assert.ok(description, 'missing description for ' + code)
      assert.strictEqual(typeof description.message, 'string', code + ' message')
      assert.ok(description.message.length > 0, code + ' message empty')
      assert.strictEqual(typeof description.hint, 'string', code + ' hint')
      assert.strictEqual(typeof description.retryable, 'boolean', code + ' retryable')
    })
  })

  h.it('maps every known code to its own message', function () {
    Object.keys(errors.CODES).forEach(function (key) {
      const code = errors.CODES[key]
      const described = errors.describeError(code)
      assert.strictEqual(described.code, code)
      assert.strictEqual(described.message, errors.DESCRIPTIONS[code].message, code)
      assert.strictEqual(described.hint, errors.DESCRIPTIONS[code].hint, code)
      assert.strictEqual(described.retryable, errors.DESCRIPTIONS[code].retryable, code)
      assert.strictEqual(described.detail, '', code + ' should not invent detail')
    })
  })

  h.it('describes representative known codes with the expected copy', function () {
    const range = errors.describeError('INVALID_THRESHOLD_RANGE')
    assert.strictEqual(range.message, '阈值范围不合法')
    assert.strictEqual(range.hint, '下限必须小于上限，且都在 0–100 之间')
    assert.strictEqual(range.retryable, false)

    const offline = errors.describeError({ code: 'DEVICE_OFFLINE' })
    assert.strictEqual(offline.message, '设备离线')
    assert.strictEqual(offline.retryable, true)

    const alarm = errors.describeError({ code: 'ALARM_LOCKED' })
    assert.strictEqual(alarm.message, '火焰报警锁定中，操作被拒绝')
    assert.strictEqual(alarm.retryable, false)

    const revision = errors.describeError({ errorCode: 'REVISION_CONFLICT' })
    assert.strictEqual(revision.code, 'REVISION_CONFLICT')
    assert.strictEqual(revision.message, '配置已被其他操作修改')
    assert.strictEqual(revision.retryable, true)
  })
})

h.describe('errors unknown-code fallback', function () {
  h.it('falls back to UNKNOWN for unknown / missing codes', function () {
    ;[errors.describeError('NOT_A_CODE'), errors.describeError({ code: 'NOT_A_CODE' }), errors.describeError(null)].forEach(
      function (described) {
        assert.strictEqual(described.code, 'UNKNOWN')
        assert.strictEqual(described.message, '未知错误')
        assert.strictEqual(described.retryable, true)
        assert.ok(described.hint.length > 0)
      }
    )
  })

  h.it('uses errorCode only when code itself is unknown', function () {
    assert.strictEqual(errors.normalizeCode({ code: 'BOGUS', errorCode: 'TIMEOUT' }), 'TIMEOUT')
    assert.strictEqual(errors.normalizeCode({ code: 'BUSY', errorCode: 'TIMEOUT' }), 'BUSY')
  })

  h.it('normalizes null / strings / errorCode objects', function () {
    assert.strictEqual(errors.normalizeCode(null), 'UNKNOWN')
    assert.strictEqual(errors.normalizeCode(undefined), 'UNKNOWN')
    assert.strictEqual(errors.normalizeCode('REVISION_CONFLICT'), 'REVISION_CONFLICT')
    assert.strictEqual(errors.normalizeCode('bogus'), 'UNKNOWN')
    assert.strictEqual(errors.normalizeCode({ code: 'BUSY' }), 'BUSY')
    assert.strictEqual(errors.normalizeCode({ errorCode: 'TIMEOUT' }), 'TIMEOUT')
  })
})

h.describe('errors detail rules', function () {
  h.it('keeps a differing message as detail', function () {
    const described = errors.describeError({ code: 'REVISION_CONFLICT', message: '设备返回 revision 3' })
    assert.strictEqual(described.message, '配置已被其他操作修改')
    assert.strictEqual(described.detail, '设备返回 revision 3')
  })

  h.it('does not duplicate a message equal to the table message, but keeps err.detail', function () {
    const same = errors.describeError({ code: 'INVALID_PAYLOAD', message: '请求参数不合法' })
    assert.strictEqual(same.detail, '')

    const withDetail = errors.describeError({
      code: 'INVALID_PAYLOAD',
      message: '请求参数不合法',
      detail: 'params.lower is required'
    })
    assert.strictEqual(withDetail.detail, 'params.lower is required')
  })

  h.it('uses a string error as detail when it is not itself a code', function () {
    const described = errors.describeError('连接超时')
    assert.strictEqual(described.code, 'UNKNOWN')
    assert.strictEqual(described.detail, '连接超时')
  })

  h.it('uses Error.message as detail and supports fallbackMessage', function () {
    const fromError = errors.describeError(new Error('boom'))
    assert.strictEqual(fromError.code, 'UNKNOWN')
    assert.strictEqual(fromError.message, '未知错误')
    assert.strictEqual(fromError.detail, 'boom')

    const fallback = errors.describeError({ code: 'BUSY' }, '请稍后重试')
    assert.strictEqual(fallback.detail, '请稍后重试')
  })
})

h.describe('errors.createError', function () {
  h.it('creates an Error carrying a known code and default message', function () {
    const err = errors.createError('DEVICE_OFFLINE')
    assert.ok(err instanceof Error)
    assert.strictEqual(err.code, 'DEVICE_OFFLINE')
    assert.strictEqual(err.message, '设备离线')
  })

  h.it('honours a custom message and extra properties', function () {
    const err = errors.createError('OUT_OF_RANGE', '自定义文案', { detail: 'upper=101', statusCode: 400 })
    assert.strictEqual(err.code, 'OUT_OF_RANGE')
    assert.strictEqual(err.message, '自定义文案')
    assert.strictEqual(err.detail, 'upper=101')
    assert.strictEqual(err.statusCode, 400)
  })

  h.it('falls back to UNKNOWN for unknown codes', function () {
    const err = errors.createError('NOT_A_CODE')
    assert.strictEqual(err.code, 'UNKNOWN')
    assert.strictEqual(err.message, '错误')
  })

  h.it('round-trips through describeError', function () {
    const described = errors.describeError(errors.createError('NFC_WRITE_FAILED', '写入失败', { detail: 'tag full' }))
    assert.strictEqual(described.code, 'NFC_WRITE_FAILED')
    assert.strictEqual(described.message, '写入 NFC 记录失败')
    assert.strictEqual(described.detail, '写入失败')
  })
})

h.main('errors.test.js')
