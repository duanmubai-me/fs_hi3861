// pages/security/security.js
// 安防页：气体环境、火焰报警、电机方向、确认解除报警与 mock 演示。
// 页面只调用 services/device 业务门面；不发请求、不直接读写 Storage。

const device = require('../../services/device')

const DEFAULT_POLL_MS = 5000

const QUALITY_LEVEL = {
  ok: 'ok',
  warming_up: 'warn',
  not_configured: 'muted',
  error: 'err'
}

// 气体项的 data-testid 必须是字面值（契约 §5.4），供自动化测试稳定选择。
const GAS_TEST_IDS = {
  eco2: 'sec-eco2',
  tvoc: 'sec-tvoc',
  combustible: 'sec-combustible'
}

function badgeClass(level) {
  return 'badge-' + (level || 'muted')
}

function qualityClass(quality) {
  return badgeClass(QUALITY_LEVEL[quality] || 'muted')
}

function alarmClass(status) {
  if (status === 'active') return 'badge-err'
  if (status === 'suspected' || status === 'clearing') return 'badge-warn'
  if (status === 'normal') return 'badge-ok'
  return 'badge-muted'
}

/**
 * 顶部总体状态 banner（与 models/state#overallStatus 语义一致）。
 * 页面只依赖视图模型字段，不自行格式化单位/时间。
 * @param {object} view
 * @returns {{level:string, text:string}|null}
 */
function buildBanner(view) {
  if (!view) return null
  if (!view.online) {
    return { level: 'err', text: '设备离线，显示的是最后一次缓存状态（数据年龄 ' + view.ageText + '）' }
  }
  if (view.alarm.active) return { level: 'err', text: '火焰报警中：已停止灌溉输出，请现场确认' }
  if (view.stale) return { level: 'warn', text: '数据已过期（' + view.ageText + '），请等待设备上报' }
  return { level: 'ok', text: '数据正常 · 数据年龄 ' + view.ageText }
}

/**
 * 命令进行中相关按钮文案与禁用状态。
 * @param {boolean} busy
 * @param {string} action
 * @param {boolean} canAck
 * @returns {object}
 */
function commandUi(busy, action, canAck) {
  const isBusy = !!busy
  const current = action || ''
  return {
    ackDisabled: isBusy || !canAck,
    ackText: isBusy && current === 'ack' ? '正在确认…' : '确认解除报警',
    mockActiveText: isBusy && current === 'mock-active' ? '模拟中…' : '模拟火焰报警',
    mockClearingText: isBusy && current === 'mock-clearing' ? '模拟中…' : '模拟解除条件'
  }
}

/**
 * 视图模型 → 页面直接可用的扁平字段（避免 WXML 里做复杂表达式）。
 * @param {object} view
 * @param {boolean} busy
 * @param {string} action
 * @returns {object}
 */
function buildUi(view, busy, action) {
  const canAck = !!(view.alarm && view.alarm.canAcknowledge)
  return Object.assign(
    {
      onlineText: view.online ? '在线' : '离线',
      onlineClass: view.online ? 'badge-ok' : 'badge-err',
      freshnessText: view.stale ? '数据过期' : '数据新鲜',
      freshnessClass: view.stale ? 'badge-warn' : 'badge-muted',
      gasItems: (view.gas.items || []).map(function (item) {
        return Object.assign({}, item, { testId: GAS_TEST_IDS[item.key] || 'sec-' + item.key })
      }),
      gasQualityClass: qualityClass(view.gas.quality),
      flameQualityClass: qualityClass(view.flame.quality),
      alarmClass: alarmClass(view.alarm.status),
      canAck: canAck
    },
    commandUi(busy, action, canAck)
  )
}

/**
 * 命令失败提示（ALARM_LOCKED 表示报警仍未解除）。
 * @param {object} error models/errors.js 描述对象
 * @param {string} fallbackText
 * @returns {{level:string, text:string, hint:string}}
 */
function buildNotice(error, fallbackText) {
  const err = error || {}
  if (err.code === 'ALARM_LOCKED') {
    return {
      level: 'err',
      text: '确认失败：报警仍未解除',
      hint: '报警中设备会拒绝解除，需先排除火情并满足解除条件后再确认。'
    }
  }
  return {
    level: 'err',
    text: err.message || fallbackText || '操作失败',
    hint: err.hint || ''
  }
}

Page({
  data: {
    loading: true,
    refreshing: false,
    view: null,
    isMock: false,
    gasItems: [],
    banner: null,
    error: null,
    notice: null,
    busy: false,
    busyAction: '',
    onlineText: '--',
    onlineClass: 'badge-muted',
    freshnessText: '--',
    freshnessClass: 'badge-muted',
    gasQualityClass: 'badge-muted',
    flameQualityClass: 'badge-muted',
    alarmClass: 'badge-muted',
    canAck: false,
    ackDisabled: true,
    ackText: '确认解除报警',
    mockActiveText: '模拟火焰报警',
    mockClearingText: '模拟解除条件'
  },

  onShow() {
    this.unloaded = false
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
   * 先立即刷新一次，再按 env.pollIntervalMs 轮询。
   */
  startPolling() {
    this.stopPolling()
    const env = device.getEnv()
    this.setData({ isMock: env.mode === 'mock' })
    this.refresh()
    const interval = Number(env.pollIntervalMs)
    const delay = interval > 0 ? interval : DEFAULT_POLL_MS
    this.timer = setInterval(() => {
      this.refresh()
    }, delay)
  },

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /**
   * 拉取状态。失败时保留最后一次成功的 view，并展示数据年龄。
   * @param {boolean} [force] 命令成功后强制刷新（此时后发起的刷新优先）
   */
  async refresh(force) {
    if (this.data.refreshing && !force) return
    this.refreshSeq = (this.refreshSeq || 0) + 1
    const seq = this.refreshSeq
    const hadView = !!this.data.view
    this.setData({ refreshing: true, loading: !hadView })

    let result
    try {
      result = await device.refresh()
    } catch (e) {
      result = {
        ok: false,
        error: { message: '读取设备状态失败', hint: '请检查设备供电、网络与应用服务地址' }
      }
    }

    if (seq !== this.refreshSeq) return
    if (this.unloaded) return

    if (!result || !result.ok || !result.view) {
      const env = device.getEnv()
      const err = (result && result.error) || {}
      this.setData({
        refreshing: false,
        loading: false,
        isMock: env.mode === 'mock',
        error: {
          message: err.message || '读取设备状态失败',
          hint: err.hint || '',
          ageText: hadView ? this.data.view.ageText : ''
        }
      })
      return
    }

    const view = result.view
    const env = result.env || device.getEnv()
    this.setData(
      Object.assign(
        {
          refreshing: false,
          loading: false,
          view: view,
          isMock: env.mode === 'mock',
          error: null,
          banner: buildBanner(view)
        },
        buildUi(view, this.data.busy, this.data.busyAction)
      )
    )
  },

  /**
   * 统一维护命令进行中状态（按钮防重复点击）。
   * @param {boolean} busy
   * @param {string} action
   */
  setBusy(busy, action) {
    const patch = {
      busy: !!busy,
      busyAction: busy ? action || '' : ''
    }
    this.setData(Object.assign(patch, commandUi(busy, action, this.data.canAck)))
  },

  async onRefreshTap() {
    if (this.data.refreshing) return
    this.setData({ notice: null })
    await this.refresh()
  },

  /**
   * 确认解除报警：仅在 canAcknowledge 时可点（disabled 已兜底，这里再判一次）。
   */
  async onAcknowledge() {
    if (this.data.busy) return
    const view = this.data.view
    if (!view) return
    if (!view.alarm.canAcknowledge) {
      this.setData({ notice: buildNotice({ code: 'ALARM_LOCKED' }) })
      return
    }

    this.setData({ notice: null })
    this.setBusy(true, 'ack')
    let result
    try {
      result = await device.acknowledgeAlarm()
    } catch (e) {
      result = { ok: false, error: { message: '确认解除失败', hint: '请稍后重试并刷新状态' } }
    }
    this.setBusy(false, '')
    if (this.unloaded) return

    if (!result || !result.ok) {
      this.setData({ notice: buildNotice(result && result.error, '确认解除失败') })
      return
    }

    this.setData({
      notice: {
        level: 'ok',
        text: '已确认解除报警',
        hint: '报警锁已清除，灌溉输出不会自动恢复，请到总览页手动开启。'
      }
    })
    await this.refresh(true)
  },

  onMockActive() {
    this.runMockAlarm('active')
  },

  onMockClearing() {
    this.runMockAlarm('clearing')
  },

  /**
   * mock 演示入口：仅在 mock 环境可用，成功后刷新状态。
   * @param {'active'|'clearing'} status
   */
  async runMockAlarm(status) {
    if (this.data.busy) return
    if (!this.data.isMock) return
    const action = status === 'active' ? 'mock-active' : 'mock-clearing'

    this.setData({ notice: null })
    this.setBusy(true, action)
    let result
    try {
      result = await device.mockTriggerAlarm(status)
    } catch (e) {
      result = { ok: false, error: { message: '模拟操作失败', hint: '请稍后重试' } }
    }
    this.setBusy(false, '')
    if (this.unloaded) return

    if (!result || !result.ok) {
      this.setData({ notice: buildNotice(result && result.error, '模拟操作失败') })
      return
    }

    this.setData({
      notice: {
        level: 'ok',
        text: status === 'active' ? '已模拟火焰报警' : '已模拟解除条件',
        hint: status === 'active' ? '模拟设备已停止灌溉输出，可继续“模拟解除条件”。' : '现在可以确认解除报警。'
      }
    })
    await this.refresh(true)
  }
})
