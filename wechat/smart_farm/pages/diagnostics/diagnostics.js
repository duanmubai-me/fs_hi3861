// pages/diagnostics/diagnostics.js
// 诊断页：运行环境、健康检查、传输层信息、最近回执、能力位与 mock 故障注入。
// 约束：页面只调用 services/device 业务门面；不直接读写 Storage，不直接引用传输层/模拟设备实现。
const device = require('../../services/device')

const MODE_OPTIONS = [
  { value: 'mock', label: 'mock（应用内模拟设备）' },
  { value: 'gateway', label: 'gateway（本机应用服务）' }
]

// 与 config/index.js 的 DEFAULTS 保持一致。页面不得直接 require config，故在此声明默认值。
const DEFAULT_ENV = {
  mode: 'mock',
  baseUrl: 'http://127.0.0.1:8080',
  deviceId: 'mock-farm-001',
  pollIntervalMs: 5000,
  staleAfterMs: 90000,
  commandTimeoutMs: 9000
}

const DEFAULT_FAULTS = {
  offline: false,
  sensorError: false,
  nvWriteError: false,
  nvVerifyError: false,
  slowMs: 0
}

const FAULT_KEYS = ['offline', 'sensorError', 'nvWriteError', 'nvVerifyError']

const ALARM_STATUSES = ['active', 'clearing', 'normal']

function modeIndexOf(mode) {
  for (let i = 0; i < MODE_OPTIONS.length; i++) {
    if (MODE_OPTIONS[i].value === mode) return i
  }
  return 0
}

function modeLabelOf(mode) {
  return MODE_OPTIONS[modeIndexOf(mode)].label
}

function modeTextOf(mode) {
  return mode === 'gateway' ? 'gateway 应用服务' : 'mock 模拟'
}

function normalizeFaults(faults) {
  const data = faults || {}
  const result = { slowMs: typeof data.slowMs === 'number' ? data.slowMs : 0 }
  FAULT_KEYS.forEach(function (key) {
    result[key] = !!data[key]
  })
  return result
}

function appVersion() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.appVersion) || '--'
  } catch (e) {
    return '--'
  }
}

function bannerFromError(error) {
  const data = error || {}
  const hint = []
  if (data.code) hint.push('错误码 ' + data.code)
  if (data.hint) hint.push(data.hint)
  return {
    level: 'err',
    text: data.message || '操作失败，请稍后重试',
    hint: hint.join(' · ')
  }
}

/**
 * 诊断页顶部状态提示：只消费 view 已归一化字段，不引入 models/state。
 * @param {object} view
 * @returns {object|null}
 */
function statusBanner(view) {
  if (!view) return null
  if (view.online === false) {
    return { level: 'err', text: '设备离线，显示的是最后一次缓存状态', hint: '' }
  }
  if (view.alarm && view.alarm.active) {
    return { level: 'err', text: '火焰报警中：已停止灌溉输出，请现场确认', hint: '' }
  }
  if (view.stale) {
    return { level: 'warn', text: '数据已过期（' + view.ageText + '），请等待设备上报', hint: '' }
  }
  if (view.sensorValid === false) {
    return {
      level: 'warn',
      text: '传感器数据无效：' + (view.humidity ? view.humidity.qualityText : '--'),
      hint: ''
    }
  }
  return null
}

/**
 * 最近回执 → 只读展示字段（不自行格式化时间）。
 * @param {object|null} command device.getLastCommand() 的返回值
 * @returns {object|null}
 */
function describeLastCommand(command) {
  if (!command) return null
  const result = command.result || {}
  const error = command.error || null
  const status = command.status || result.status || 'unknown'
  let statusClass = 'badge-muted'
  if (status === 'applied') statusClass = 'badge-ok'
  else if (status === 'rejected' || status === 'error') statusClass = 'badge-err'
  const revision = result.configRevision
  return {
    action: command.action || '--',
    requestId: command.requestId || '--',
    status: status,
    statusClass: statusClass,
    savedText: command.saved ? '是' : '否',
    configRevision: revision === undefined || revision === null ? '--' : String(revision),
    errorCode: error && error.code ? error.code : '--',
    errorMessage: error && error.message ? error.message : ''
  }
}

function stringifyCapabilities(capabilities) {
  if (!capabilities) return '暂无（尚未获取设备状态）'
  try {
    return JSON.stringify(capabilities, null, 2)
  } catch (e) {
    return '能力位序列化失败'
  }
}

function formatUptime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '--'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  let text = ''
  if (hours > 0) text += hours + ' 小时 '
  if (hours > 0 || minutes > 0) text += minutes + ' 分 '
  text += seconds + ' 秒'
  return text + '（' + ms + ' ms）'
}

Page({
  data: {
    loading: true,
    view: null,
    banner: null,
    env: null,
    envModeText: 'mock 模拟',
    form: { mode: DEFAULT_ENV.mode, baseUrl: DEFAULT_ENV.baseUrl, deviceId: DEFAULT_ENV.deviceId },
    modeOptions: MODE_OPTIONS,
    modeIndex: 0,
    modeLabel: MODE_OPTIONS[0].label,
    formErrors: { baseUrl: '', deviceId: '' },
    envMessage: '',
    savingEnv: false,
    checkingHealth: false,
    health: null,
    healthError: null,
    transportName: '--',
    transportDescribe: '--',
    appVersion: '--',
    lastCommand: null,
    capabilitiesText: '暂无（尚未获取设备状态）',
    isMock: true,
    faults: DEFAULT_FAULTS,
    mockBusy: false
  },

  onShow() {
    this.alive = true
    this.syncEnv()
    this.refresh({ initial: true })
    this.startPolling()
  },

  onHide() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  onUnload() {
    this.alive = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  syncEnv() {
    const env = device.getEnv()
    this.setData({
      env: env,
      envModeText: modeTextOf(env.mode),
      isMock: env.mode === 'mock',
      form: { mode: env.mode, baseUrl: env.baseUrl, deviceId: env.deviceId },
      modeIndex: modeIndexOf(env.mode),
      modeLabel: modeLabelOf(env.mode),
      formErrors: { baseUrl: '', deviceId: '' },
      envMessage: '',
      transportName: device.transportName() || '--',
      transportDescribe: device.transportDescribe() || '--',
      appVersion: appVersion(),
      lastCommand: describeLastCommand(device.getLastCommand()),
      faults: env.mode === 'mock' ? normalizeFaults(device.getFaults()) : normalizeFaults(null)
    })
  },

  startPolling() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const env = device.getEnv()
    const interval = env.pollIntervalMs || 5000
    const self = this
    this.timer = setInterval(function () {
      self.refresh({ silent: true })
    }, interval)
  },

  applyEnv(env) {
    const next = env || device.getEnv()
    this.setData({
      env: next,
      envModeText: modeTextOf(next.mode),
      isMock: next.mode === 'mock',
      form: { mode: next.mode, baseUrl: next.baseUrl, deviceId: next.deviceId },
      modeIndex: modeIndexOf(next.mode),
      modeLabel: modeLabelOf(next.mode),
      formErrors: { baseUrl: '', deviceId: '' },
      faults: next.mode === 'mock' ? normalizeFaults(device.getFaults()) : normalizeFaults(null),
      transportName: device.transportName() || '--',
      transportDescribe: device.transportDescribe() || '--',
      appVersion: appVersion()
    })
    this.startPolling()
  },

  /**
   * 刷新状态。串行执行，避免轮询与手动刷新并发写 data。
   * @param {{silent?:boolean, initial?:boolean}} [options]
   * @returns {Promise}
   */
  refresh(options) {
    const settings = options || {}
    const self = this
    if (!this.refreshChain) this.refreshChain = Promise.resolve()
    this.refreshChain = this.refreshChain
      .then(function () {
        return self.doRefresh(settings)
      })
      .catch(function () {
        // doRefresh 内部已兜底；这里只保证定时轮询链不会因意外异常中断。
      })
    return this.refreshChain
  },

  async doRefresh(options) {
    if (this.alive === false) return
    const settings = options || {}
    if (!settings.silent) this.setData({ loading: true })
    try {
      const result = await device.refresh()
      if (this.alive === false) return
      const env = result.env || device.getEnv()
      const patch = {
        loading: false,
        env: env,
        envModeText: modeTextOf(env.mode),
        isMock: env.mode === 'mock',
        transportName: device.transportName() || '--',
        transportDescribe: device.transportDescribe() || '--',
        lastCommand: describeLastCommand(device.getLastCommand()),
        faults: env.mode === 'mock' ? normalizeFaults(device.getFaults()) : normalizeFaults(null)
      }
      if (result.ok && result.view) {
        patch.view = result.view
        patch.capabilitiesText = stringifyCapabilities(result.view.capabilities)
        patch.banner = statusBanner(result.view)
      } else {
        patch.banner = bannerFromError(result.error)
      }
      this.setData(patch)
    } catch (e) {
      if (this.alive === false) return
      this.setData({ loading: false, banner: bannerFromError(e) })
    }
  },

  onModeChange(event) {
    const index = Number(event.detail.value) || 0
    const option = MODE_OPTIONS[index] || MODE_OPTIONS[0]
    this.setData({
      modeIndex: index,
      modeLabel: option.label,
      'form.mode': option.value
    })
  },

  onBaseUrlInput(event) {
    this.setData({ 'form.baseUrl': event.detail.value })
  },

  onDeviceIdInput(event) {
    this.setData({ 'form.deviceId': event.detail.value })
  },

  async onSaveEnv() {
    if (this.data.savingEnv) return
    const form = this.data.form || {}
    const mode = form.mode === 'gateway' ? 'gateway' : 'mock'
    const baseUrl = String(form.baseUrl || '').trim()
    const deviceId = String(form.deviceId || '').trim()
    const formErrors = { baseUrl: '', deviceId: '' }

    if (!baseUrl) formErrors.baseUrl = '请输入应用服务地址（baseUrl）'
    else if (baseUrl.length > 200) formErrors.baseUrl = 'baseUrl 不能超过 200 个字符'
    else if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) formErrors.baseUrl = 'baseUrl 需以 http:// 或 https:// 开头'

    if (!deviceId) formErrors.deviceId = '请输入设备 ID'
    else if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
      formErrors.deviceId = '设备 ID 只能是 1–64 位字母、数字、下划线或短横线'
    }

    if (formErrors.baseUrl || formErrors.deviceId) {
      this.setData({ formErrors: formErrors })
      return
    }

    this.setData({ savingEnv: true, formErrors: { baseUrl: '', deviceId: '' }, envMessage: '' })
    try {
      const env = device.setEnv({ mode: mode, baseUrl: baseUrl, deviceId: deviceId })
      this.applyEnv(env)
      await this.refresh({ silent: true })
      if (this.alive === false) return
      this.setData({ envMessage: '已保存环境：' + modeTextOf(env.mode) + ' · ' + env.deviceId })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ banner: bannerFromError(e), envMessage: '' })
    } finally {
      if (this.alive !== false) this.setData({ savingEnv: false })
    }
  },

  async onResetEnv() {
    if (this.data.savingEnv) return
    this.setData({ savingEnv: true, formErrors: { baseUrl: '', deviceId: '' }, envMessage: '' })
    try {
      const env = device.setEnv(DEFAULT_ENV)
      this.applyEnv(env)
      await this.refresh({ silent: true })
      if (this.alive === false) return
      this.setData({ envMessage: '已恢复默认 mock 环境' })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ banner: bannerFromError(e), envMessage: '' })
    } finally {
      if (this.alive !== false) this.setData({ savingEnv: false })
    }
  },

  async onHealth() {
    if (this.data.checkingHealth) return
    this.setData({ checkingHealth: true, healthError: null })
    try {
      const result = await device.health()
      if (this.alive === false) return
      if (!result.ok) {
        this.setData({ checkingHealth: false, health: null, healthError: bannerFromError(result.error) })
        return
      }
      const data = result.health || {}
      const ok = data.ok !== false
      this.setData({
        checkingHealth: false,
        healthError: null,
        health: {
          ok: ok,
          okText: ok ? '正常' : '异常',
          okClass: ok ? 'badge-ok' : 'badge-err',
          provider: data.provider || '--',
          version: data.version || '--',
          bootId: data.bootId || '--',
          deviceId: data.deviceId || '--',
          uptimeText: formatUptime(data.uptimeMs),
          note: data.note || ''
        }
      })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ checkingHealth: false, health: null, healthError: bannerFromError(e) })
    }
  },

  async onFaultChange(event) {
    if (this.data.mockBusy || !this.data.isMock) return
    const key = event.currentTarget.dataset.key
    if (FAULT_KEYS.indexOf(key) < 0) return
    const value = !!event.detail.value
    this.setData({ mockBusy: true })
    try {
      const patch = {}
      patch[key] = value
      const next = device.setFaults(patch)
      this.setData({ faults: normalizeFaults(next || device.getFaults()) })
      await this.refresh({ silent: true })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ banner: bannerFromError(e), faults: normalizeFaults(device.getFaults()) })
    } finally {
      if (this.alive !== false) this.setData({ mockBusy: false })
    }
  },

  async onResetMock() {
    if (this.data.mockBusy || !this.data.isMock) return
    this.setData({ mockBusy: true })
    try {
      await device.resetMock()
      // 底层 reset() 只恢复配置/运行状态，不清理故障注入；这里显式清空，避免重置后仍离线。
      const cleared = device.setFaults({
        offline: false,
        sensorError: false,
        nvWriteError: false,
        nvVerifyError: false
      })
      this.setData({ faults: normalizeFaults(cleared || device.getFaults()) })
      await this.refresh({ silent: true })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ banner: bannerFromError(e) })
    } finally {
      if (this.alive !== false) this.setData({ mockBusy: false })
    }
  },

  async onMockAlarm(event) {
    if (this.data.mockBusy || !this.data.isMock) return
    const status = event.currentTarget.dataset.status
    if (ALARM_STATUSES.indexOf(status) < 0) return
    this.setData({ mockBusy: true })
    try {
      const result = await device.mockTriggerAlarm(status)
      if (this.alive === false) return
      if (!result.ok) {
        this.setData({ banner: bannerFromError(result.error) })
        return
      }
      await this.refresh({ silent: true })
    } catch (e) {
      if (this.alive === false) return
      this.setData({ banner: bannerFromError(e) })
    } finally {
      if (this.alive !== false) this.setData({ mockBusy: false })
    }
  }
})
