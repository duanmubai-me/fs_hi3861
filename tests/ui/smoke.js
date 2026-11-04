// tests/ui/smoke.js
// 真机模拟器 UI 冒烟：用微信开发者工具 + miniprogram-automator 打开小程序，
// 逐页检查渲染、执行关键交互（刷新、保存阈值、模拟报警/解除、NFC 模拟写入），并截图。
//
// 前置条件：
//   1) 微信开发者工具已安装并登录；
//   2) IDE 已开启「设置 → 安全设置 → 服务端口」；
//   3) 以无头/自动模式运行：node tests/ui/smoke.js（脚本会调用 cli auto 启动自动化）。
//
// 环境变量（一般不用改）：
//   WECHAT_CLI         cli.bat 路径（默认 <workspace>/.tools/wechat-devtools/cli.bat）
//   AUTOMATOR_PATH     miniprogram-automator 包路径（默认 <workspace>/.tools/wechat-ai/node_modules/miniprogram-automator）
//   MINI_PROJECT       小程序项目路径（默认 <repo>/wechat/smart_farm）
//   UI_SMOKE_ARTIFACTS 截图输出目录（默认 tests/ui/artifacts）
//   UI_SMOKE_SKIP=1    跳过（无 IDE 环境时由 CI 使用）
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const HERE = __dirname
const REPO = path.resolve(HERE, '..', '..')
const WORKSPACE = path.resolve(REPO, '..', '..', '..', '..', '..')

const CLI = process.env.WECHAT_CLI || path.join(WORKSPACE, '.tools', 'wechat-devtools', 'cli.bat')
const AUTOMATOR =
  process.env.AUTOMATOR_PATH ||
  path.join(WORKSPACE, '.tools', 'wechat-ai', 'node_modules', 'miniprogram-automator')
const PROJECT = process.env.MINI_PROJECT || path.join(REPO, 'wechat', 'smart_farm')
const ARTIFACTS = process.env.UI_SMOKE_ARTIFACTS || path.join(HERE, 'artifacts')
const AUTOMATION_PORT = Number(process.env.UI_SMOKE_PORT || 9420)

const results = []
const consoleErrors = []

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/**
 * 微信开发者工具的 cli.bat 在 Windows 上不能被 child_process.spawn 直接执行，
 * 因此这里用 shell 调起 `cli auto --auto-port`，再用 automator.connect 连 ws。
 */
function enableAutomation() {
  const command =
    '"' + CLI + '" auto --project "' + PROJECT + '" --auto-port ' + AUTOMATION_PORT + ' --trust-project'
  console.log('run: ' + command)
  const res = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (res.stdout) console.log(String(res.stdout).trim())
  if (res.stderr) console.error(String(res.stderr).trim())
  if (res.error) throw res.error
}

async function connectAutomation(automator) {
  const wsEndpoint = 'ws://127.0.0.1:' + AUTOMATION_PORT
  try {
    console.log('try connect ' + wsEndpoint)
    return await automator.connect({ wsEndpoint: wsEndpoint })
  } catch (e) {
    console.log('connect failed, enabling automation via CLI ...')
  }
  enableAutomation()
  let lastError = null
  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    try {
      return await automator.connect({ wsEndpoint: wsEndpoint })
    } catch (e) {
      lastError = e
    }
  }
  throw new Error('automation connect failed: ' + (lastError && lastError.message))
}


function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(function () {
      results.push({ name: name, ok: true })
      console.log('ok   - ' + name)
    })
    .catch(function (err) {
      results.push({ name: name, ok: false, error: err && err.message ? err.message : String(err) })
      console.error('FAIL - ' + name + ' :: ' + (err && err.message ? err.message : String(err)))
    })
}

async function screenshot(mp, name) {
  const file = path.join(ARTIFACTS, name + '.png')
  try {
    await mp.screenshot({ path: file })
    console.log('shot - ' + file)
  } catch (e) {
    console.warn('screenshot failed: ' + name + ' :: ' + (e && e.message))
  }
}

async function textOf(page, selector) {
  const el = await page.$(selector)
  if (!el) return ''
  return String((await el.text()) || '').trim()
}

async function exists(page, selector) {
  return !!(await page.$(selector))
}

async function main() {
  if (process.env.UI_SMOKE_SKIP === '1') {
    console.log('UI_SMOKE_SKIP=1, skipped')
    return 0
  }
  if (!fs.existsSync(CLI)) {
    console.error('找不到微信开发者工具 CLI：' + CLI)
    return 2
  }
  if (!fs.existsSync(AUTOMATOR)) {
    console.error('找不到 miniprogram-automator：' + AUTOMATOR)
    return 2
  }
  if (!fs.existsSync(path.join(PROJECT, 'app.json'))) {
    console.error('找不到小程序项目：' + PROJECT)
    return 2
  }
  fs.mkdirSync(ARTIFACTS, { recursive: true })

  const automator = require(AUTOMATOR)
  let mp = null
  try {
    mp = await connectAutomation(automator)
    console.log('automation connected')
    mp.on('console', function (msg) {
      if (msg && msg.type === 'error') {
        consoleErrors.push(String(msg.args && msg.args.length ? msg.args.join(' ') : msg.text || msg.type))
      }
    })
    mp.on('exception', function (err) {
      consoleErrors.push('exception: ' + String(err && (err.message || err)))
    })

    // ---------- dashboard ----------
    let page = await mp.reLaunch('/pages/dashboard/dashboard')
    await page.waitFor(1800)
    await check('dashboard: 页面加载且无致命错误', async function () {
      const pathName = page.path || '/pages/dashboard/dashboard'
      if (pathName.indexOf('dashboard') < 0) throw new Error('当前页面不是 dashboard: ' + pathName)
      const banner = await textOf(page, '[data-testid="dash-banner"]')
      const alarm = await textOf(page, '[data-testid="dash-alarm"]')
      if (!banner && !alarm) throw new Error('banner 与 alarm 都为空，可能未加载状态')
    })
    await check('dashboard: 湿度/温度卡片存在且不是假 0', async function () {
      if (!(await exists(page, '[data-testid="dash-humidity"]'))) throw new Error('缺少 dash-humidity')
      const text = await textOf(page, '[data-testid="dash-humidity"]')
      if (text.indexOf('0.0') >= 0 && text.indexOf('%') === text.indexOf('%')) {
        // mock 湿度漂移在 20–80 之间，正常不会是 0.0；出现说明不是有效值
        throw new Error('湿度疑似显示成 0.0：' + text)
      }
    })
    await mp.screenshot({ path: path.join(ARTIFACTS, '01-dashboard.png') })
    await check('dashboard: 点击刷新可用', async function () {
      const el = await page.$('[data-testid="dash-refresh"]')
      if (!el) throw new Error('缺少 dash-refresh')
      await el.tap()
      await page.waitFor(1200)
      const err = await textOf(page, '[data-testid="dash-error"]')
      if (err) throw new Error('刷新后出现错误卡：' + err)
    })
    await check('dashboard: 风扇开关命令链路', async function () {
      const el = await page.$('[data-testid="dash-fan-switch"]')
      if (!el) throw new Error('缺少 dash-fan-switch')
      const before = await page.data('view.fan.on')
      await el.tap()
      await page.waitFor(1600)
      const after = await page.data('view.fan.on')
      if (!!before === !!after) throw new Error('点击后风扇状态未变化（mock 命令未生效？）')
    })
    await screenshot(mp, '02-dashboard-after-fan')

    // ---------- settings ----------
    page = await mp.switchTab('/pages/settings/settings')
    await page.waitFor(1500)
    await check('settings: 页面元素齐全', async function () {
      for (const selector of ['[data-testid="set-lower"]', '[data-testid="set-upper"]', '[data-testid="set-save"]']) {
        if (!(await exists(page, selector))) throw new Error('缺少 ' + selector)
      }
    })
    await check('settings: 保存阈值命令链路', async function () {
      const el = await page.$('[data-testid="set-save"]')
      await el.tap()
      await page.waitFor(2200)
      const error = await page.data('saveError')
      if (error !== null && error !== undefined && String(error) !== '') {
        throw new Error('保存后出现错误：' + JSON.stringify(error))
      }
      const view = await page.data('view')
      if (!view) throw new Error('保存后 view 为空')
    })
    await screenshot(mp, '03-settings')

    // ---------- security ----------
    page = await mp.switchTab('/pages/security/security')
    await page.waitFor(1500)
    await check('security: 安防元素存在', async function () {
      for (const selector of ['[data-testid="sec-flame"]', '[data-testid="sec-ack"]']) {
        if (!(await exists(page, selector))) throw new Error('缺少 ' + selector)
      }
    })
    await check('security: 模拟报警 → 报警锁定', async function () {
      const el = await page.$('[data-testid="sec-mock-active"]')
      if (!el) throw new Error('缺少 sec-mock-active')
      await el.tap()
      await page.waitFor(1800)
      const active = await page.data('view.alarm.active')
      if (active !== true) throw new Error('模拟报警后 view.alarm.active 不是 true')
    })
    await screenshot(mp, '04-security-alarm')
    await check('security: 模拟解除 → 确认解除', async function () {
      const clearing = await page.$('[data-testid="sec-mock-clearing"]')
      if (clearing) {
        await clearing.tap()
        await page.waitFor(1500)
      }
      const ack = await page.$('[data-testid="sec-ack"]')
      if (!ack) throw new Error('缺少 sec-ack')
      await ack.tap()
      await page.waitFor(1800)
      const active = await page.data('view.alarm.active')
      if (active === true) throw new Error('确认解除后仍处于报警')
    })

    // ---------- provisioning ----------
    page = await mp.switchTab('/pages/provisioning/provisioning')
    await page.waitFor(1500)
    await check('provisioning: 表单与写入按钮存在', async function () {
      for (const selector of ['[data-testid="prov-ssid"]', '[data-testid="prov-passwd"]', '[data-testid="prov-write"]']) {
        if (!(await exists(page, selector))) throw new Error('缺少 ' + selector)
      }
    })
    await check('provisioning: mock 写入流程', async function () {
      const ssid = await page.$('[data-testid="prov-ssid"]')
      const passwd = await page.$('[data-testid="prov-passwd"]')
      await ssid.input('Lab24G')
      await passwd.input('example-only')
      const write = await page.$('[data-testid="prov-write"]')
      await write.tap()
      await page.waitFor(2600)
      const result = await textOf(page, '[data-testid="prov-result"]')
      if (!result) throw new Error('写入后没有结果卡')
    })
    await screenshot(mp, '05-provisioning')

    // ---------- diagnostics ----------
    page = await mp.navigateTo('/pages/diagnostics/diagnostics')
    await page.waitFor(1500)
    await check('diagnostics: 健康检查可用', async function () {
      const health = await page.$('[data-testid="diag-health"]')
      if (!health) throw new Error('缺少 diag-health')
      await health.tap()
      await page.waitFor(1200)
    })
    await screenshot(mp, '06-diagnostics')

    await check('全局：无 console 错误/异常', async function () {
      if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 8).join(' | '))
    })
  } finally {
    if (mp) {
      try {
        await mp.disconnect()
      } catch (e) {
        /* ignore */
      }
    }
  }

  const failed = results.filter(function (r) {
    return !r.ok
  })
  console.log('')
  console.log('--- UI smoke summary ---')
  console.log('checks: ' + results.length + '  failed: ' + failed.length + '  artifacts: ' + ARTIFACTS)
  if (failed.length) {
    failed.forEach(function (r) {
      console.log('  - ' + r.name + ': ' + r.error)
    })
    console.log('UI SMOKE FAILED')
    return 1
  }
  console.log('UI SMOKE PASSED')
  return 0
}

main()
  .then(function (code) {
    process.exitCode = code
  })
  .catch(function (err) {
    console.error('UI SMOKE ERROR: ' + (err && err.stack ? err.stack : err))
    process.exitCode = 1
  })
