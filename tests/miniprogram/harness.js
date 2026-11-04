// tests/miniprogram/harness.js
// 极简测试框架：describe / it / knownIssue + 计数与失败汇总。
// 纯 CommonJS，零依赖；测试文件执行完调用 main(label) 打印汇总并设置退出码。
//
// 说明：
//  - `it` 里的断言失败计入 failed，进程退出码非 0；
//  - `knownIssue` 用于记录"源码与契约/注释不一致"的已知问题：断言失败时只提示，
//    不计入失败（避免测试套件被已知源码 bug 卡住）；若某天修复了，会打印 KNOWN-FIXED。
'use strict'

const assert = require('node:assert')
const path = require('node:path')

// 小程序源码根目录：相对本文件定位，换机器/移动仓库都能用。
const SM_ROOT = path.resolve(__dirname, '..', '..', 'wechat', 'smart_farm')

const tests = []
const stack = []

function describe(name, fn) {
  stack.push(name)
  try {
    fn()
  } finally {
    stack.pop()
  }
}

function it(name, fn) {
  tests.push({ name: stack.concat(name).join(' > '), fn: fn, known: false })
}

function knownIssue(name, fn) {
  tests.push({ name: stack.concat(name).join(' > '), fn: fn, known: true })
}

function messageLines(err, max) {
  const text = err && err.message ? String(err.message) : String(err)
  const lines = text
    .split('\n')
    .map(function (line) {
      return line.trim()
    })
    .filter(function (line) {
      return line.length > 0
    })
  if (lines.length === 0) return [text]
  return lines.slice(0, max || 5)
}

function oneLine(err) {
  return messageLines(err, 3).join(' | ')
}

function stackLines(err, max) {
  const text = err && err.stack ? String(err.stack) : String(err)
  return text.split('\n').slice(0, max || 6)
}

async function run(label) {
  let passed = 0
  let failed = 0
  let known = 0
  let knownFixed = 0
  const failures = []

  for (const test of tests) {
    try {
      await test.fn()
      if (test.known) {
        knownFixed += 1
        console.log('KNOWN-FIXED  ' + test.name + '  (documented expectation now holds)')
      } else {
        passed += 1
      }
    } catch (err) {
      if (test.known) {
        known += 1
        console.log('KNOWN ISSUE  ' + test.name)
        messageLines(err, 5).forEach(function (line) {
          console.log('             ' + line)
        })
      } else {
        failed += 1
        failures.push({ name: test.name, error: err })
        console.log('FAIL         ' + test.name)
        stackLines(err).forEach(function (line) {
          console.log('             ' + line)
        })
      }
    }
  }

  if (tests.length === 0) {
    failed += 1
    failures.push({ name: '<no tests registered>', error: new Error('no tests registered') })
    console.log('FAIL         <no tests registered>')
  }

  console.log('')
  console.log('--- ' + label + ' summary ---')
  console.log(
    'passed: ' +
      passed +
      '  failed: ' +
      failed +
      '  known issues: ' +
      known +
      '  known fixed: ' +
      knownFixed
  )
  if (failures.length) {
    console.log('failures:')
    failures.forEach(function (entry) {
      console.log('  - ' + entry.name + ': ' + oneLine(entry.error))
    })
  }

  return { label: label, passed: passed, failed: failed, known: known, knownFixed: knownFixed }
}

function main(label) {
  return run(label)
    .then(function (result) {
      process.exitCode = result.failed === 0 ? 0 : 1
      return result
    })
    .catch(function (err) {
      console.error('HARNESS ERROR: ' + stackLines(err, 12).join('\n'))
      process.exitCode = 1
    })
}

module.exports = {
  SM_ROOT: SM_ROOT,
  assert: assert,
  describe: describe,
  it: it,
  knownIssue: knownIssue,
  run: run,
  main: main
}
