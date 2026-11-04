// pages/settings/settings.js
// 阈值设置页：设备已确认值与本地草稿分离，所有设备操作只走 services/device。
// 不直接访问底层传输、缓存或网络层，也不展示任何凭据。

const device = require('../../services/device')

const DEFAULT_POLL_MS = 5000

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function draftOf(value) {
  return value === null || value === undefined ? '' : String(value)
}

function parseBoundedInt(value, min, max) {
  if (isBlank(value)) return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  if (!isFinite(n) || Math.floor(n) !== n) return null
  if (n < min || n > max) return null
  return n
}

function parseInteger(value) {
  if (isBlank(value)) return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  if (!isFinite(n) || Math.floor(n) !== n) return null
  return n
}

function draftDiffers(draft, confirmed) {
  const text = isBlank(draft) ? '' : String(draft).trim()
  const hasConfirmed = confirmed !== null && confirmed !== undefined
  if (!hasConfirmed) return text !== ''
  const parsed = parseInteger(text)
  if (parsed === null) return true
  const n = Number(confirmed)
  if (!isFinite(n)) return true
  return parsed !== n
}

function validateHumidityDraft(lowerDraft, upperDraft) {
  const lower = parseBoundedInt(lowerDraft, 0, 100)
  const upper = parseBoundedInt(upperDraft, 0, 100)
  let lowerError = ''
  let upperError = ''

  if (isBlank(lowerDraft)) lowerError = '请输入湿度下限（0–100 的整数）'
  else if (lower === null) lowerError = '湿度下限需为 0–100 的整数'

  if (isBlank(upperDraft)) upperError = '请输入湿度上限（0–100 的整数）'
  else if (upper === null) upperError = '湿度上限需为 0–100 的整数'

  if (!lowerError && !upperError && lower >= upper) upperError = '湿度上限必须大于下限'

  return {
    ok: !lowerError && !upperError,
    lower: lower,
    upper: upper,
    lowerError: lowerError,
    upperError: upperError
  }
}

function validateFlameDraft(tripDraft, clearDraft) {
  const trip = parseBoundedInt(tripDraft, 0, 4095)
  const clear = parseBoundedInt(clearDraft, 0, 4095)
  let tripError = ''
  let clearError = ''

  if (isBlank(tripDraft)) tripError = '请输入火焰触发阈值（0–4095 的整数）'
  else if (trip === null) tripError = '触发阈值需为 0–4095 的整数'

  if (isBlank(clearDraft)) clearError = '请输入火焰解除阈值（0–4095 的整数）'
  else if (clear === null) clearError = '解除阈值需为 0–4095 的整数'

  if (!tripError && !clearError && trip <= clear) clearError = '解除阈值必须小于触发阈值'

  return {
    ok: !tripError && !clearError,
    trip: trip,
    clear: clear,
    tripError: tripError,
    clearError: clearError
  }
}

function statusBadgeClass(status) {
  if (status === 'ok') return 'badge-ok'
  if (status === 'incompatible' || status === 'write_failed') return 'badge-err'
  return 'badge-warn'
}

// 与 models/state.js#overallStatus 同义；页面只允许 require 业务服务，
// 这里用 view 字段拼 banner，不自行格式化时间/单位（ageText 等均来自 view）。
function bannerOf(view) {
  if (!view) return null
  if (!view.online) {
    return { level: 'err', className: 'banner-err', text: '设备离线，显示的是最后一次缓存状态', hint: '' }
  }
  if (view.alarm && view.alarm.active) {
    return { level: 'err', className: 'banner-err', text: '火焰报警中：已停止灌溉输出，请现场确认', hint: '' }
  }
  if (view.stale) {
    return {
      level: 'warn',
      className: 'banner-warn',
      text: '数据已过期（' + view.ageText + '），请等待设备上报',
      hint: ''
    }
  }
  if (!view.sensorValid) {
    const qualityText = (view.humidity && view.humidity.qualityText) || '未知'
    return { level: 'warn', className: 'banner-warn', text: '传感器数据无效：' + qualityText, hint: '' }
  }
  return null
}

// 刷新失败时优先保留设备离线/过期 banner（契约 §4.10），把刷新错误放在第二行。
function refreshErrorBanner(error, view) {
  const base = view ? bannerOf(view) : null
  if (!base) {
    return { level: 'err', className: 'banner-err', text: error.message, hint: error.hint }
  }
  const hint = error.message + (error.hint ? '；' + error.hint : '')
  return { level: base.level, className: base.className, text: base.text, hint: hint }
}

function normalizeError(error) {
  if (!error) return { code: 'UNKNOWN', message: '保存失败，请重试', hint: '' }
  if (typeof error === 'string') return { code: 'UNKNOWN', message: error, hint: '' }
  return {
    code: error.code || error.errorCode || 'UNKNOWN',
    message: error.message || '保存失败，请重试',
    hint: error.hint || ''
  }
}

function errorStatus(error) {
  const e = normalizeError(error)
  return {
    level: 'err',
    text: '保存失败（' + e.code + '）：' + e.message,
    hint: e.hint
  }
}

function savedStatus(result, fallbackRevision) {
  const data = result || {}
  const revision =
    data.configRevision === undefined || data.configRevision === null ? fallbackRevision : data.configRevision
  const revisionText = revision === undefined || revision === null ? '--' : revision
  if (data.saved === true) {
    return {
      level: 'ok',
      text: '已保存到设备（saved=true，revision ' + revisionText + '）',
      hint: ''
    }
  }
  return {
    level: 'warn',
    text: '设备已执行，但未确认落盘（saved=false，revision ' + revisionText + '）',
    hint: '请刷新状态核对配置是否生效'
  }
}

Page({
  data: {
    loading: true,
    refreshing: false,
    view: null,
    banner: null,
    humidityUnit: '',
    configStatusClass: 'badge-muted',

    lowerDraft: '',
    upperDraft: '',
    lowerError: '',
    upperError: '',
    humidityDirty: false,
    humidityValid: false,
    humiditySaving: false,
    humidityStatus: null,

    flameAvailable: true,
    flameTripDraft: '',
    flameClearDraft: '',
    flameTripError: '',
    flameClearError: '',
    flameDirty: false,
    flameValid: false,
    flameSaving: false,
    flameStatus: null,

    conflict: false,
    conflictSection: ''
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

  startPolling() {
    this.stopPolling()
    this.refresh()
    const env = device.getEnv() || {}
    const interval =
      typeof env.pollIntervalMs === 'number' && env.pollIntervalMs >= 1000 ? env.pollIntervalMs : DEFAULT_POLL_MS
    const that = this
    this.timer = setInterval(function () {
      that.refresh()
    }, interval)
  },

  stopPolling() {
    if (this.timer !== null && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  async refresh(options) {
    const opts = options || {}
    const manual = opts.manual === true
    if (this.refreshing) {
      if (manual) this.pendingManualRefresh = true
      return
    }
    this.refreshing = true
    this.setData({ refreshing: true })
    try {
      const res = await device.refresh()
      if (this.unloaded) return
      if (!res || !res.ok || !res.view) {
        const error = (res && res.error) || { code: 'UNKNOWN', message: '读取设备状态失败', hint: '' }
        this.setData({
          loading: false,
          refreshing: false,
          banner: refreshErrorBanner(error, this.data.view)
        })
        return
      }
      this.applyView(res.view, { manual: manual })
    } catch (e) {
      if (this.unloaded) return
      const error = normalizeError(e)
      this.setData({
        loading: false,
        refreshing: false,
        banner: refreshErrorBanner(error, this.data.view)
      })
    } finally {
      this.refreshing = false
      if (this.data.refreshing) this.setData({ refreshing: false })
      if (this.pendingManualRefresh) {
        this.pendingManualRefresh = false
        this.refresh({ manual: true })
      }
    }
  },

  applyView(view, options) {
    const opts = options || {}
    const manual = opts.manual === true
    const prev = this.data
    const config = view.config || {}
    const flameAvailable = !!(view.flame && view.flame.available)

    let lowerDraft = prev.lowerDraft
    let upperDraft = prev.upperDraft
    if (!prev.humidityDirty) {
      lowerDraft = draftOf(config.humidityLower)
      upperDraft = draftOf(config.humidityUpper)
    }
    const humidityCheck = validateHumidityDraft(lowerDraft, upperDraft)
    const humidityDirty =
      draftDiffers(lowerDraft, config.humidityLower) || draftDiffers(upperDraft, config.humidityUpper)

    let flameTripDraft = prev.flameTripDraft
    let flameClearDraft = prev.flameClearDraft
    if (!prev.flameDirty) {
      flameTripDraft = draftOf(config.flameTrip)
      flameClearDraft = draftOf(config.flameClear)
    }
    const flameCheck = validateFlameDraft(flameTripDraft, flameClearDraft)
    const flameDirty =
      flameAvailable &&
      (draftDiffers(flameTripDraft, config.flameTrip) || draftDiffers(flameClearDraft, config.flameClear))

    const patch = {
      loading: false,
      refreshing: false,
      view: view,
      banner: bannerOf(view),
      humidityUnit: (view.humidity && view.humidity.unit) || '',
      configStatusClass: statusBadgeClass(config.configStatus),
      lowerDraft: lowerDraft,
      upperDraft: upperDraft,
      lowerError: humidityCheck.lowerError,
      upperError: humidityCheck.upperError,
      humidityDirty: humidityDirty,
      humidityValid: humidityCheck.ok,
      flameAvailable: flameAvailable,
      flameTripDraft: flameTripDraft,
      flameClearDraft: flameClearDraft,
      flameTripError: flameAvailable ? flameCheck.tripError : '',
      flameClearError: flameAvailable ? flameCheck.clearError : '',
      flameDirty: flameDirty,
      flameValid: flameAvailable && flameCheck.ok
    }

    if (prev.conflict && manual) {
      patch.conflict = false
      patch.conflictSection = ''
      if (prev.conflictSection === 'humidity') {
        patch.humidityStatus = {
          level: 'warn',
          text: '已刷新设备状态，请核对草稿后再次保存',
          hint: ''
        }
      } else if (prev.conflictSection === 'flame') {
        patch.flameStatus = {
          level: 'warn',
          text: '已刷新设备状态，请核对草稿后再次保存',
          hint: ''
        }
      }
    }

    this.setData(patch)
  },

  updateHumidityDraft(lowerDraft, upperDraft) {
    const view = this.data.view
    const config = view ? view.config || {} : {}
    const check = validateHumidityDraft(lowerDraft, upperDraft)
    this.setData({
      lowerDraft: lowerDraft,
      upperDraft: upperDraft,
      lowerError: check.lowerError,
      upperError: check.upperError,
      humidityValid: check.ok,
      humidityDirty:
        draftDiffers(lowerDraft, config.humidityLower) || draftDiffers(upperDraft, config.humidityUpper)
    })
  },

  onLowerInput(event) {
    this.updateHumidityDraft(event.detail.value, this.data.upperDraft)
  },

  onUpperInput(event) {
    this.updateHumidityDraft(this.data.lowerDraft, event.detail.value)
  },

  async onSaveThresholds() {
    if (this.data.humiditySaving) return
    const view = this.data.view
    if (!view) return
    const check = validateHumidityDraft(this.data.lowerDraft, this.data.upperDraft)
    if (!check.ok) {
      this.setData({ lowerError: check.lowerError, upperError: check.upperError, humidityValid: false })
      return
    }

    this.setData({ humiditySaving: true, humidityStatus: null })
    let res = null
    try {
      res = await device.saveThresholds(
        { lower: check.lower, upper: check.upper, sensorKind: view.sensorKind },
        { expectedRevision: view.config.configRevision }
      )
    } catch (e) {
      this.onSaveFailure('humidity', e)
      return
    }

    if (!res || !res.ok) {
      this.onSaveFailure('humidity', res && res.error)
      return
    }

    const result = res.result || {}
    this.setData({
      humiditySaving: false,
      humidityDirty: result.saved !== true,
      humidityStatus: savedStatus(result, view.config.configRevision),
      conflict: false,
      conflictSection: ''
    })

    try {
      await this.refresh({ manual: true })
    } catch (e) {
      // 保存已成功；刷新失败由后续轮询或冲突刷新按钮兜底
    }
  },

  updateFlameDraft(flameTripDraft, flameClearDraft) {
    const view = this.data.view
    const config = view ? view.config || {} : {}
    const check = validateFlameDraft(flameTripDraft, flameClearDraft)
    this.setData({
      flameTripDraft: flameTripDraft,
      flameClearDraft: flameClearDraft,
      flameTripError: check.tripError,
      flameClearError: check.clearError,
      flameValid: check.ok,
      flameDirty:
        draftDiffers(flameTripDraft, config.flameTrip) || draftDiffers(flameClearDraft, config.flameClear)
    })
  },

  onFlameTripInput(event) {
    this.updateFlameDraft(event.detail.value, this.data.flameClearDraft)
  },

  onFlameClearInput(event) {
    this.updateFlameDraft(this.data.flameTripDraft, event.detail.value)
  },

  async onSaveFlame() {
    if (this.data.flameSaving || !this.data.flameAvailable) return
    const view = this.data.view
    if (!view) return
    const check = validateFlameDraft(this.data.flameTripDraft, this.data.flameClearDraft)
    if (!check.ok) {
      this.setData({ flameTripError: check.tripError, flameClearError: check.clearError, flameValid: false })
      return
    }

    this.setData({ flameSaving: true, flameStatus: null })
    let res = null
    try {
      res = await device.saveSecurityConfig(
        {
          flameTrip: check.trip,
          flameClear: check.clear,
          alarmEnabled: view.config.alarmEnabled !== false
        },
        { expectedRevision: view.config.configRevision }
      )
    } catch (e) {
      this.onSaveFailure('flame', e)
      return
    }

    if (!res || !res.ok) {
      this.onSaveFailure('flame', res && res.error)
      return
    }

    const result = res.result || {}
    this.setData({
      flameSaving: false,
      flameDirty: result.saved !== true,
      flameStatus: savedStatus(result, view.config.configRevision),
      conflict: false,
      conflictSection: ''
    })

    try {
      await this.refresh({ manual: true })
    } catch (e) {
      // 保存已成功；刷新失败由后续轮询或冲突刷新按钮兜底
    }
  },

  onSaveFailure(section, error) {
    const normalized = normalizeError(error)
    const isConflict = normalized.code === 'REVISION_CONFLICT'
    const patch = {
      conflict: isConflict || this.data.conflict,
      conflictSection: isConflict ? section : this.data.conflictSection
    }
    if (section === 'humidity') {
      patch.humiditySaving = false
      patch.humidityStatus = errorStatus(normalized)
    } else {
      patch.flameSaving = false
      patch.flameStatus = errorStatus(normalized)
    }
    this.setData(patch)
  },

  onRefreshTap() {
    return this.refresh({ manual: true })
  }
})
