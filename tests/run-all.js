// tests/run-all.js
// 统一入口：先跑小程序纯逻辑单测，再跑 gateway smoke；全部通过打印 ALL TESTS PASSED 并退出 0。
// gateway/tests/smoke.js 是交付物的一部分，缺失时判失败（不再 SKIP）。
//
// 用法（在 Team 仓库根 fs_hi3861 下，或任意 cwd）：node tests/run-all.js
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const HERE = __dirname
const MINI_DIR = path.join(HERE, 'miniprogram')
const ROOT = path.resolve(HERE, '..')
const GATEWAY_SMOKE = path.join(ROOT, 'gateway', 'tests', 'smoke.js')

const MINI_FILES = [
  'utils.test.js',
  'nfc-codec.test.js',
  'errors.test.js',
  'state.test.js',
  'mock-device.test.js',
  'device.test.js',
  'regression.test.js',
  'huawei-direct.test.js'
]
const TIMEOUT_MS = 180000

const failures = []
let suiteCount = 0
let passedCount = 0

function runNode(label, scriptPath, cwd) {
  console.log('')
  console.log('=== ' + label + ' ===')
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: cwd,
    stdio: 'inherit',
    env: process.env,
    timeout: TIMEOUT_MS
  })
  suiteCount += 1
  if (result.error) {
    failures.push(label + ': ' + result.error.message)
    console.log('ERROR        ' + label + ': ' + result.error.message)
    return
  }
  if (result.status !== 0) {
    failures.push(label + ': exit code ' + String(result.status))
    console.log('SUITE FAILED ' + label + ' (exit code ' + String(result.status) + ')')
    return
  }
  passedCount += 1
}

console.log('smart-farm test runner')
console.log('root: ' + ROOT)

for (const file of MINI_FILES) {
  const scriptPath = path.join(MINI_DIR, file)
  if (!fs.existsSync(scriptPath)) {
    suiteCount += 1
    failures.push('missing test file: ' + scriptPath)
    console.log('')
    console.log('=== miniprogram: ' + file + ' ===')
    console.log('ERROR        missing test file: ' + scriptPath)
    continue
  }
  runNode('miniprogram: ' + file, scriptPath, MINI_DIR)
}

console.log('')
if (!fs.existsSync(GATEWAY_SMOKE)) {
  suiteCount += 1
  failures.push('missing gateway smoke: ' + GATEWAY_SMOKE)
  console.log('=== gateway: tests/smoke.js ===')
  console.log('ERROR        missing gateway smoke test: ' + GATEWAY_SMOKE)
} else {
  runNode('gateway: tests/smoke.js', GATEWAY_SMOKE, ROOT)
}

console.log('')
console.log('--- run-all summary ---')
console.log('suites: ' + passedCount + '/' + suiteCount + ' passed')
if (failures.length) {
  console.log('failed suites:')
  failures.forEach(function (entry) {
    console.log('  - ' + entry)
  })
  console.log('TESTS FAILED')
  process.exitCode = 1
} else {
  console.log('ALL TESTS PASSED')
  process.exitCode = 0
}
