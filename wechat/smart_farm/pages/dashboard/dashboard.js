// pages/dashboard/dashboard.js
// 首页总览：安全状态 banner、设备 hero、温湿度、风扇/自动模式开关、快捷入口与最近回执。
// 只调用 services/device 业务门面，不直接访问 transport，也不直接读写 Storage。

const device = require('../../services/device')
const stateModel = require('../../models/state')

const DEFAULT_POLL_MS = 5000

function qualityChipClass(quality) {
  if (quality === 'ok') return 'chip-ok'
  if (quality === 'warming_up' || quality === 'stale') return 'chip-warn'
  if (quality === 'error') return 'chip-danger'
  return ''
}

/**
 * 湿度读数是否可信：有值且质量正常。过期/离线时仍可展示最后一次读数，
 * 但会用 note 说明，并且不再显示为有效绿色数值。
 * @param {object} view
 * @returns {boolean}
 */
function humidityReadableOf(view) {
  const value = view.humidity.value
  return value !== null && value !== undefined && view.humidity.quality === 'ok'
}

/**
 * 湿度无效/过期时的说明（不自己造数，只解释原因）。
 * @param {object} view models/state.js 视图模型
 * @returns {string}
 */
function humidityNoteOf(view) {
  const qualityText = view.humidity.qualityText
  const readable = humidityReadableOf(view)
  if (!view.online) {
    return readable
      ? '设备离线，显示最后一次数据（质量：' + qualityText + '）'
      : '设备离线，读数不可用（质量：' + qualityText + '）'
  }
  if (view.stale) {
    return readable
      ? '数据已过期，显示最后一次数据（质量：' + qualityText + '）'
      : '数据已过期，读数不可用（质量：' + qualityText + '）'
  }
  if (!readable) {
    if (view.humidity.quality !== 'ok') return '数据不可用：' + qualityText
    return '传感器暂无有效读数'
  }
  return ''
}

function alarmTextOf(view) {
  if (!view.alarm.active) return ''
  return '已停止灌溉输出，请现场确认火情后到“安防”页确认解除。报警开始：' + view.alarm.sinceText
}

function errorOf(error) {
  const data = error || {}
  return {
    message: data.message || '无法获取设备状态',
    hint: data.hint || ''
  }
}

function errorTextOf(error) {
  const normalized = errorOf(error)
  return normalized.hint ? normalized.message + '；' + normalized.hint : normalized.message
}

/**
 * 正常数据状态 banner（online/stale/sensor 与报警统一由视图模型判定）。
 * @param {object} view
 * @returns {{level:string,text:string,hint:string,note:string,isError:boolean}}
 */
function bannerOf(view) {
  const status = stateModel.overallStatus(view)
  return { level: status.level, text: status.text, hint: '', note: '', isError: false }
}

/**
 * 刷新失败时顶部 banner 必须切换为错误态，不能继续显示旧的“数据正常”。
 * @param {{message:string,hint:string}} error
 * @param {boolean} hasView 是否还保留着上一次成功读取的数据
 * @returns {{level:string,text:string,hint:string,note:string,isError:boolean}}
 */
function refreshErrorBanner(error, hasView) {
  return {
    level: 'err',
    text: error.message,
    hint: error.hint || '请检查设备连接或华为云配置后重试',
    note: hasView
      ? '当前展示的是最后一次成功读取的数据，可再次刷新重试。'
      : '暂时没有可展示的数据，请确认设备已上电并联网后重试。',
    isError: true
  }
}

/**
 * 最近回执：一句话结果 + 状态 chip。
 * @param {object|null} command device.getLastCommand()
 * @returns {{level:string,text:string,chipText:string,chipClass:string}}
 */
function receiptOf(command) {
  const summary = device.resultSummary(command)
  const chipText = { ok: '成功', warn: '待核对', err: '失败' }[summary.level] || '暂无'
  const chipClass = { ok: 'chip-ok', warn: 'chip-warn', err: 'chip-danger' }[summary.level] || ''
  return {
    level: summary.level,
    text: summary.text,
    chipText: chipText,
    chipClass: chipClass
  }
}

/**
 * view -> 页面直接可用的字段（单位/时间/过期都由视图模型给好）。
 * @param {object} view
 * @returns {object}
 */
function viewPatch(view) {
  const alarmLocked = !!view.alarm.active
  // utils/units.formatHumidity(null) 因 Number(null) === 0 会返回 '0.0'，
  // 必须按“有值且质量正常”守卫，无效时显示 '--'，绝不显示 0。
  const humidityReadable = humidityReadableOf(view)
  const humidityFresh = humidityReadable && view.sensorValid && view.online
  return {
    view: view,
    banner: bannerOf(view),
    deviceName: view.deviceId || '未命名设备',
    onlineText: view.online ? (view.stale ? '在线 · 数据过期' : '在线') : '离线',
    onlineDotClass: !view.online ? 'dot-danger' : view.stale ? 'dot-warn' : 'dot-ok',
    alarmLocked: alarmLocked,
    alarmText: alarmTextOf(view),
    humidityNote: humidityNoteOf(view),
    humidityText: humidityReadable ? view.humidity.text : '--',
    humidityUnit: humidityReadable ? view.humidity.unit : '',
    humidityMuted: !humidityFresh,
    humidityChipClass: qualityChipClass(view.humidity.quality),
    temperatureText: view.temperature.available ? view.temperature.text : '--',
    temperatureUnit: view.temperature.available ? view.temperature.unit : '',
    temperatureMuted: !view.temperature.available || !view.online || view.stale
  }
}

function toast(message) {
  wx.showToast({ title: message || '操作失败', icon: 'none' })
}

Page({
  data: {
    loading: true,
    refreshing: false,
    view: null,
    banner: null,
    error: null,
    receipt: null,
    deviceName: '未命名设备',
    onlineText: '',
    onlineDotClass: 'dot-muted',
    alarmLocked: false,
    alarmText: '',
    humidityNote: '',
    humidityText: '--',
    humidityUnit: '',
    humidityMuted: true,
    humidityChipClass: '',
    temperatureText: '--',
    temperatureUnit: '',
    temperatureMuted: true,
    fanBusy: false,
    autoBusy: false,
    fanError: '',
    autoError: ''
  },

  onShow() {
    this.startPolling()
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.unloaded = true
    this.stopPolling()
  },

  /**
   * 先立即刷新一次，再按配置的轮询间隔启动定时器。
   */
  async startPolling() {
    this.stopPolling()
    this.active = true
    const env = device.getEnv()
    const interval = env && env.pollIntervalMs > 0 ? env.pollIntervalMs : DEFAULT_POLL_MS
    await this.refresh()
    if (!this.active || this.timer) return
    this.timer = setInterval(() => {
      this.refresh({ silent: true })
    }, interval)
  },

  stopPolling() {
    this.active = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  applyRefreshError(error) {
    const normalized = errorOf(error)
    this.setData({
      loading: false,
      error: normalized,
      banner: refreshErrorBanner(normalized, !!this.data.view)
    })
  },

  /**
   * 拉取状态并更新视图。
   * @param {{silent?:boolean}} [options]
   */
  async refresh(options) {
    const opts = options || {}
    if (this.refreshing) {
      if (opts.silent) return
      // 手动刷新撞上进行中的轮询：等这次结束再真正刷新一次，避免点击无响应
      if (this.refreshBarrier) await this.refreshBarrier
      if (this.unloaded) return
      return this.refresh(opts)
    }
    if (opts.silent && (this.data.fanBusy || this.data.autoBusy)) return
    this.refreshing = true
    this.refreshBarrier = new Promise((resolve) => {
      this.finishRefresh = resolve
    })
    try {
      if (!opts.silent) {
        this.setData({ refreshing: true, loading: !this.data.view })
      }
      const res = await device.refresh()
      if (this.unloaded) return
      if (res && res.ok && res.view) {
        const patch = viewPatch(res.view)
        patch.loading = false
        patch.error = null
        patch.receipt = receiptOf(device.getLastCommand())
        this.setData(patch)
      } else {
        this.applyRefreshError(res && res.error)
      }
    } catch (err) {
      if (!this.unloaded) this.applyRefreshError(err)
    } finally {
      this.refreshing = false
      if (this.finishRefresh) {
        this.finishRefresh()
        this.finishRefresh = null
        this.refreshBarrier = null
      }
      if (!this.unloaded) this.setData({ refreshing: false })
    }
  },

  onRefreshTap() {
    if (this.data.fanBusy || this.data.autoBusy) return
    this.refresh({ silent: false })
  },

  async onFanChange(e) {
    const view = this.data.view
    if (!view || this.data.fanBusy || this.data.autoBusy) return
    const next = !!(e.detail && e.detail.value)
    const previous = !!view.fan.on
    this.setData({ 'view.fan.on': next, fanBusy: true, fanError: '' })
    let result = null
    try {
      result = await device.setFan(next)
    } catch (err) {
      result = { ok: false, error: errorOf(err) }
    }
    if (this.unloaded) return
    const receipt = receiptOf(device.getLastCommand())
    if (!result || !result.ok) {
      const reason = (result && result.error) || { message: '风扇控制失败', hint: '' }
      this.setData({
        'view.fan.on': previous,
        fanBusy: false,
        receipt: receipt,
        fanError: errorTextOf(reason)
      })
      toast(reason.message || '风扇控制失败')
      this.refresh({ silent: true })
      return
    }
    this.setData({ fanBusy: false, receipt: receipt, fanError: '' })
    toast(next ? '风扇已开启' : '风扇已关闭')
    this.refresh({ silent: true })
  },

  async onAutoChange(e) {
    const view = this.data.view
    if (!view || this.data.fanBusy || this.data.autoBusy) return
    const next = !!(e.detail && e.detail.value)
    const previous = !!view.mode.isAuto
    this.setData({ 'view.mode.isAuto': next, autoBusy: true, autoError: '' })
    let result = null
    try {
      result = await device.setAutoMode(next)
    } catch (err) {
      result = { ok: false, error: errorOf(err) }
    }
    if (this.unloaded) return
    const receipt = receiptOf(device.getLastCommand())
    if (!result || !result.ok) {
      const reason = (result && result.error) || { message: '自动模式切换失败', hint: '' }
      this.setData({
        'view.mode.isAuto': previous,
        autoBusy: false,
        receipt: receipt,
        autoError: errorTextOf(reason)
      })
      toast(reason.message || '自动模式切换失败')
      this.refresh({ silent: true })
      return
    }
    this.setData({ autoBusy: false, receipt: receipt, autoError: '' })
    toast(next ? '已切换到自动模式' : '已切换到手动模式')
    this.refresh({ silent: true })
  },

  onGoProvisioning() {
    wx.switchTab({ url: '/pages/provisioning/provisioning' })
  },

  onGoSettings() {
    wx.switchTab({ url: '/pages/settings/settings' })
  },

  onGoSecurity() {
    wx.switchTab({ url: '/pages/security/security' })
  },

  onGoDiagnostics() {
    wx.navigateTo({ url: '/pages/diagnostics/diagnostics' })
  }
})
