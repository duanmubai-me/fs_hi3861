// tests/miniprogram/nfc-codec.test.js
// 覆盖 utils/nfc-codec.js：既定 NDEF 记录格式、字节顺序、输入拒绝与描述摘要。
'use strict'

const h = require('./harness')
const nfc = require(h.SM_ROOT + '/utils/nfc-codec')
const assert = h.assert

const TS = 1700000000000
const SSID = 'Lab24G'
const PASSWD = '12345678'
const PAYLOAD = '{"ssid":"Lab24G","passwd":"12345678"}'

function bytesOf(buf) {
  return Array.from(new Uint8Array(buf))
}

function codesOf(errors) {
  return errors.map(function (entry) {
    return entry.field + ':' + entry.code
  })
}

h.describe('nfc-codec.encodeWifiRecord record shape', function () {
  h.it('builds one record: tnf=2, type="t", 13-digit timestamp id, compact payload', function () {
    const result = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, TS)
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.errors, [])
    assert.deepStrictEqual(result.warnings, [])

    const record = result.record
    assert.strictEqual(record.tnf, 2)
    assert.ok(record.type instanceof ArrayBuffer, 'type should be ArrayBuffer')
    assert.ok(record.id instanceof ArrayBuffer, 'id should be ArrayBuffer')
    assert.ok(record.payload instanceof ArrayBuffer, 'payload should be ArrayBuffer')

    assert.deepStrictEqual(bytesOf(record.type), [0x74])
    assert.strictEqual(result.texts.typeText, 't')
    assert.strictEqual(result.texts.idText, '1700000000000')
    assert.strictEqual(result.texts.payloadText, PAYLOAD)
    assert.strictEqual(record.payload.byteLength, PAYLOAD.length)
    assert.strictEqual(record.id.byteLength, 13)
  })

  h.it('writes payload bytes in order and without any header/encoding prefix', function () {
    const record = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, TS).record
    const payloadBytes = bytesOf(record.payload)
    assert.deepStrictEqual(
      payloadBytes,
      PAYLOAD.split('').map(function (ch) {
        return ch.charCodeAt(0)
      })
    )
    // {"ssid":"
    assert.deepStrictEqual(payloadBytes.slice(0, 9), [0x7b, 0x22, 0x73, 0x73, 0x69, 0x64, 0x22, 0x3a, 0x22])
    assert.strictEqual(payloadBytes[payloadBytes.length - 1], 0x7d)
  })

  h.it('reports byte counts that add up', function () {
    const result = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, TS)
    assert.deepStrictEqual(result.bytes, {
      type: 1,
      id: 13,
      payload: PAYLOAD.length,
      total: 1 + 13 + PAYLOAD.length
    })
    assert.strictEqual(result.bytes.total, 51)
  })

  h.it('uses an explicit numeric timestamp 0 instead of Date.now()', function () {
    const result = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, 0)
    assert.strictEqual(result.texts.idText, '0')
    assert.strictEqual(result.bytes.id, 1)
    assert.deepStrictEqual(bytesOf(result.record.id), [0x30])
  })

  h.it('defaults the id to the current millisecond timestamp', function () {
    const result = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD })
    assert.match(result.texts.idText, /^\d{12,14}$/)
    assert.strictEqual(result.bytes.id, result.texts.idText.length)
  })

  h.it('accepts an 8-char password without warnings', function () {
    const result = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, TS)
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.warnings, [])
  })
})

h.describe('nfc-codec.validateWifi rejections', function () {
  h.it('rejects missing ssid and passwd', function () {
    const checked = nfc.validateWifi({})
    assert.strictEqual(checked.ok, false)
    assert.deepStrictEqual(codesOf(checked.errors), ['ssid:REQUIRED', 'passwd:REQUIRED'])
    assert.strictEqual(nfc.encodeWifiRecord({}, TS).record, null)
  })

  h.it('rejects non-string fields', function () {
    const ssidChecked = nfc.validateWifi({ ssid: 123, passwd: PASSWD })
    assert.strictEqual(ssidChecked.ok, false)
    assert.deepStrictEqual(codesOf(ssidChecked.errors), ['ssid:NOT_STRING'])
    const passwdChecked = nfc.validateWifi({ ssid: SSID, passwd: {} })
    assert.deepStrictEqual(codesOf(passwdChecked.errors), ['passwd:NOT_STRING'])
  })

  h.it('rejects non-ASCII (Chinese / full-width) text instead of truncating', function () {
    const ssidChecked = nfc.validateWifi({ ssid: '实验室', passwd: PASSWD })
    assert.deepStrictEqual(codesOf(ssidChecked.errors), ['ssid:NON_ASCII'])
    const passwdChecked = nfc.validateWifi({ ssid: SSID, passwd: '密码12345678' })
    assert.deepStrictEqual(codesOf(passwdChecked.errors), ['passwd:NON_ASCII'])
    const fullWidth = nfc.validateWifi({ ssid: 'Ｌａｂ', passwd: PASSWD })
    assert.deepStrictEqual(codesOf(fullWidth.errors), ['ssid:NON_ASCII'])
    const encoded = nfc.encodeWifiRecord({ ssid: '实验室', passwd: PASSWD }, TS)
    assert.strictEqual(encoded.ok, false)
    assert.strictEqual(encoded.record, null)
    assert.strictEqual(encoded.texts, null)
    assert.strictEqual(encoded.bytes, null)
  })

  h.it('rejects quotes, backslashes and control characters', function () {
    assert.deepStrictEqual(codesOf(nfc.validateWifi({ ssid: 'Lab"24G', passwd: PASSWD }).errors), [
      'ssid:UNSAFE_CHAR'
    ])
    assert.deepStrictEqual(codesOf(nfc.validateWifi({ ssid: 'Lab\\24G', passwd: PASSWD }).errors), [
      'ssid:UNSAFE_CHAR'
    ])
    assert.deepStrictEqual(codesOf(nfc.validateWifi({ ssid: SSID, passwd: 'abc\\defg' }).errors), [
      'passwd:UNSAFE_CHAR'
    ])
    assert.deepStrictEqual(codesOf(nfc.validateWifi({ ssid: 'Lab\n24G', passwd: PASSWD }).errors), [
      'ssid:NON_ASCII'
    ])
    assert.deepStrictEqual(codesOf(nfc.validateWifi({ ssid: 'Lab\u007f24G', passwd: PASSWD }).errors), [
      'ssid:NON_ASCII'
    ])
  })

  h.it('enforces SSID 32 / passwd 63 length limits', function () {
    assert.strictEqual(nfc.validateWifi({ ssid: 'a'.repeat(32), passwd: 'b'.repeat(63) }).ok, true)
    const longSsid = nfc.validateWifi({ ssid: 'a'.repeat(33), passwd: PASSWD })
    assert.deepStrictEqual(codesOf(longSsid.errors), ['ssid:TOO_LONG'])
    const longPasswd = nfc.validateWifi({ ssid: SSID, passwd: 'b'.repeat(64) })
    assert.deepStrictEqual(codesOf(longPasswd.errors), ['passwd:TOO_LONG'])
  })

  h.it('allows spaces inside SSID and warns (not errors) for empty/short passwords', function () {
    const spaced = nfc.validateWifi({ ssid: 'Lab 24G', passwd: PASSWD })
    assert.strictEqual(spaced.ok, true)
    assert.deepStrictEqual(spaced.normalized, { ssid: 'Lab 24G', passwd: PASSWD })

    const empty = nfc.validateWifi({ ssid: SSID, passwd: '' })
    assert.strictEqual(empty.ok, true)
    assert.deepStrictEqual(codesOf(empty.warnings), ['passwd:PASSWD_EMPTY'])

    const short = nfc.validateWifi({ ssid: SSID, passwd: '1234567' })
    assert.strictEqual(short.ok, true)
    assert.deepStrictEqual(codesOf(short.warnings), ['passwd:PASSWD_TOO_SHORT'])
  })
})

h.describe('nfc-codec.str2ab / ab2str', function () {
  h.it('maps each charCode low byte (not UTF-8) and preserves ASCII round-trip', function () {
    assert.strictEqual(nfc.str2ab('t').byteLength, 1)
    assert.deepStrictEqual(bytesOf(nfc.str2ab('t')), [0x74])
    assert.deepStrictEqual(bytesOf(nfc.str2ab('€')), [0xac])
    assert.deepStrictEqual(bytesOf(nfc.str2ab('😀')), [0x3d, 0x00])
    assert.strictEqual(nfc.ab2str(nfc.str2ab(PAYLOAD)), PAYLOAD)
  })

  h.it('coerces null/undefined/number to string and empty buffer', function () {
    assert.strictEqual(nfc.str2ab(null).byteLength, 0)
    assert.strictEqual(nfc.str2ab(undefined).byteLength, 0)
    assert.strictEqual(nfc.str2ab('').byteLength, 0)
    assert.deepStrictEqual(bytesOf(nfc.str2ab(123)), [0x31, 0x32, 0x33])
  })

  h.it('byteLength and toHex handle buffers and limits', function () {
    assert.strictEqual(nfc.byteLength(null), 0)
    assert.strictEqual(nfc.byteLength(undefined), 0)
    assert.strictEqual(nfc.byteLength(new Uint8Array(3)), 3)
    assert.strictEqual(nfc.byteLength(new ArrayBuffer(4)), 4)
    assert.strictEqual(nfc.byteLength({}), 0)
    assert.strictEqual(nfc.toHex(null), '')
    assert.strictEqual(nfc.toHex(new Uint8Array([0, 15, 255])), '00 0F FF')
    assert.strictEqual(nfc.toHex(new Uint8Array([0, 15, 255]), 2), '00 0F')
    assert.strictEqual(nfc.toHex(new Uint8Array([0x74])), '74')
  })
})

h.describe('nfc-codec.describeRecord', function () {
  h.it('describes a real record without the raw buffers', function () {
    const record = nfc.encodeWifiRecord({ ssid: SSID, passwd: PASSWD }, TS).record
    const described = nfc.describeRecord(record)
    assert.strictEqual(described.tnf, 2)
    assert.strictEqual(described.typeText, 't')
    assert.strictEqual(described.idText, '1700000000000')
    assert.strictEqual(described.payloadText, PAYLOAD)
    assert.strictEqual(described.typeBytes, 1)
    assert.strictEqual(described.idBytes, 13)
    assert.strictEqual(described.payloadBytes, PAYLOAD.length)
    assert.strictEqual(described.totalBytes, 51)
    assert.strictEqual(described.typeHex, '74')
    assert.ok(described.idHex.indexOf('31 37 30 30') === 0)
  })

  h.it('returns zeroed summary for a null record', function () {
    assert.deepStrictEqual(nfc.describeRecord(null), {
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
    })
  })
})

h.describe('nfc-codec payload helpers', function () {
  h.it('buildPayload keeps fixed key order and quotes', function () {
    assert.strictEqual(nfc.buildPayload({ ssid: SSID, passwd: PASSWD }), PAYLOAD)
    assert.strictEqual(nfc.buildPayload({}), '{"ssid":"","passwd":""}')
  })

  h.it('parsePayload round-trips and rejects malformed payloads', function () {
    assert.deepStrictEqual(nfc.parsePayload(PAYLOAD), { ssid: SSID, passwd: PASSWD })
    assert.throws(
      function () {
        nfc.parsePayload('{"ssid":"a"}')
      },
      /记录格式不合法/
    )
    assert.throws(function () {
      nfc.parsePayload('not json')
    })
  })
})

h.main('nfc-codec.test.js')
