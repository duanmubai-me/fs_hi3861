# 小程序与网关开发契约（v0.1，mock 优先）

本文是 `wechat/smart_farm/` 与 `gateway/` 的实现约定，**页面/服务/网关都按这里实现**。
协议依据：`doc/04`（小程序）、`doc/05`（Flash 语义）、`doc/07`（错误码/幂等/优先级）。
当前阶段没有 AppID、没有云实例、没有实物，因此：**默认 mock 模式必须完整可用**；gateway 的 huawei/local provider 只保留骨架。

---

## 1. 目录与归属

```text
wechat/smart_farm/
├─ app.js / app.json / app.wxss / sitemap.json / project.config.json  （已提供，勿改）
├─ config/index.js              运行时环境配置（已提供）
├─ config/local.example.js      脱敏模板（已提供）
├─ docs/contract.md             本文
├─ utils/time.js units.js id.js nfc-codec.js        （已提供）
├─ models/errors.js state.js                       （已提供）
├─ services/mock-device.js                          （已提供，纯逻辑）
├─ services/transport-mock.js transport-gateway.js transport.js device.js nfc.js （已提供）
└─ pages/<page>/<page>.{js,json,wxml,wxss}          （待实现，见 §5）
gateway/
├─ package.json / README.md / config/local.example.json
├─ src/index.js config.js api.js registry.js commandStore.js
├─ src/providers/mock.js huawei.js local.js
└─ tests/smoke.js
tests/miniprogram/                                   （待实现，见 §7）
```

页面文件只能写自己的 `pages/<page>/`；不要改 app.*、services/、models/、utils/、config/。
需要补公共能力时，在页面内实现或复用已有服务，不改公共层。

---

## 2. 统一数据形状

### 2.1 RawState（transport.getState() 返回，gateway/mock 一致）

```js
{
  deviceId: 'mock-farm-001',
  online: true,
  bootId: 'boot-...', seq: 12, uptimeMs: 123456,
  sensor: { kind:'air_rh'|'soil_relative', humidity: 45.1|null, temperature: 26.3|null,
            quality:'ok'|'warming_up'|'not_configured'|'error', sampledAt: 1700000000000 },
  actuators: { fan:'on'|'off', motor:'stopped'|'forward'|'reverse' },
  mode: 'manual'|'auto',
  alarm: { status:'normal'|'suspected'|'active'|'clearing', id: string|null, since: number|null, muted: boolean },
  config: { sensorKind, humidityLower: 30, humidityUpper: 40, flameTrip:160, flameClear:120,
            alarmEnabled:true, configRevision: 2, configStatus:'ok'|'defaulted'|'incompatible'|'write_failed',
            updatedAt: 1700000000000|null },
  gas: { eco2: 430|null, tvoc: 16|null, combustibleRaw: null, quality:'ok'|'not_configured'|'warming_up'|'error' },
  flame: { raw: 130|null, quality:'ok'|'error' },
  capabilities: {
    board, firmware, supportsMotorReverse: boolean,
    gas:{ eco2:boolean, tvoc:boolean, combustible:boolean },
    flame:{ available:boolean, rawRange:[0,4095], direction:'up'|'down' },
    calibrated:{ combustible:boolean }
  },
  receivedAt: 1700000000000
}
```

### 2.2 CommandResult（transport.sendCommand 返回 / gateway 轮询结果）

```js
{
  requestId: 'set_thresholds-...',
  action: 'set_fan'|'set_mode'|'set_thresholds'|'set_security_config'|'acknowledge_alarm'|'mock_alarm',
  status: 'applied'|'rejected',
  errorCode: null|'INVALID_THRESHOLD_RANGE'|'REVISION_CONFLICT'|'DEVICE_OFFLINE'|'ALARM_LOCKED'|...,
  message: '',
  saved: true|false,          // 只有确实落盘（mock 模拟回读通过）才 true
  configRevision: 2,
  params: {},
  appliedAt: 1700000000000,
  device?: { mode, fan, alarm }
}
```

### 2.3 View Model（`services/device.js#refresh()` 返回 `view`）

`device.refresh()` → `{ok, raw, view, error, env, transportName}`。
`view` 由 `models/state.js` 归一化，页面直接用，**不要再自己格式化单位/时间/过期**：

```js
view = {
  deviceId, online, stale, receivedAt, receivedAtText, ageText, bootId, seq,
  sensorKind, sensorKindText, sensorValid,
  humidity: { value, text, unit, quality, qualityText },
  temperature: { value, text, unit, available },
  sampledAt, sampledAtText,
  fan: { on, text }, motor: { value, text, available },
  mode: { value, text, isAuto },
  alarm: { status, active, text, id, sinceText, canAcknowledge, muted },
  config: { sensorKind, humidityLower, humidityUpper, lowerText, upperText,
            flameTrip, flameClear, flameTripText, flameClearText, alarmEnabled,
            configRevision, configStatus, configStatusText, updatedAt, updatedAtText },
  gas: { items:[{key,label,available,value,text,unit}], available, quality, qualityText },
  flame: { available, raw, text, quality, qualityText, direction },
  capabilities
}
```

`models/state.js#overallStatus(view)` → `{level:'ok'|'warn'|'err', text}`，首页 banner 直接使用。
`services/device.js#resultSummary(command)` → `{level, text}`，用于命令回执提示。

---

## 3. 服务 API（页面只调用这些）

`const device = require('../../services/device')`

| API | 说明 |
| --- | --- |
| `getEnv()` | `{mode:'mock'|'gateway', baseUrl, deviceId, pollIntervalMs, staleAfterMs, commandTimeoutMs}` |
| `setEnv(patch)` | 修改并持久化环境，重建 transport |
| `transportName()` / `transportDescribe()` | 诊断页展示 |
| `refresh()` | 拉状态并归一化，见 §2.3 |
| `setFan(on, {expectedRevision})` | 手动开/关（原子：设备侧退出自动） |
| `setAutoMode(on, {expectedRevision})` | 自动/手动 |
| `saveThresholds({lower, upper, sensorKind}, {expectedRevision})` | 阈值保存，客户端先校验 |
| `saveSecurityConfig({flameTrip, flameClear, alarmEnabled}, {expectedRevision})` | 火焰阈值 |
| `acknowledgeAlarm()` | 确认解除报警（不能解除仍触发的报警） |
| `mockTriggerAlarm('active'|'clearing'|'normal')` | mock 演示用 |
| `validateThresholds(lower, upper)` | `{ok, value?, error?}` |
| `validateSecurityConfig(input)` | 同上 |
| `health()` | `{ok, health, error}` |
| `setFaults({offline,sensorError,nvWriteError,nvVerifyError,slowMs})` / `getFaults()` | 仅 mock |
| `resetMock()` | 仅 mock，恢复默认配置 |
| `getLastCommand()` | `{action, requestId, result, error, at, saved, status}` |
| `resultSummary(command)` | 一句话回执 |

返回形状统一为 `{ok, requestId, result, error}`（`save*` 的客户端校验失败为 `{ok:false, error, invalid:true}`）。
`error` 形态：`{code, message, hint, retryable, detail}`，页面必须展示 `message`（可加 `hint`），并在诊断页保留 `code`/`requestId`。

NFC：`const nfc = require('../../services/nfc')`

| API | 说明 |
| --- | --- |
| `getCapability()` | `{platform, hasApi, supported, canSimulate, note}` |
| `writeWifi({ssid, passwd}, {env, onProgress})` | mock 环境自动模拟；真机走真实 NFC；失败 reject Error（`code` 为 NFC_*/INVALID_INPUT） |
| `previewRecord({ssid, passwd}, timestamp)` | 只构造记录，返回 `encodeWifiRecord` 结果 |

`onProgress({step,text,detail})`，`step` 依次可能为
`prepare → adapter → discovery → connect → write → verify → done → cleanup`。
**成功含义分层**：标签写入成功 ≠ 板端读取成功 ≠ Wi-Fi 连接成功 ≠ 云上线；UI 只能宣称文案可证实的那一步。

---

## 4. 页面通用要求

1. 每个页面四件套 `.js/.json/.wxml/.wxss` 齐全，`.json` 至少 `{"navigationBarTitleText":"..."}`；根节点统一用 `class="page"`，视觉规范见 `docs/ui-spec.md`（UI-UX Pro Max 生成）。
2. **轮询生命周期**：`onShow` 启动（先立即 `refresh()` 再 `setInterval`），`onHide`/`onUnload` 必须 `clearInterval`；不允许在 `onLoad` 里启动永不清理的定时器。
3. 页面内禁止：`wx.request`、直接 `require('../../services/transport')`、直接 `require('../../services/mock-device')`、读写 `wx.setStorageSync`（除诊断页改环境用 `device.setEnv`）。
4. 所有异步操作要有 loading/结果状态；按钮在命令进行中 `disabled`，防止重复点击。
5. 错误展示：`error.message` +（`error.hint` 存在时）第二行；诊断页额外显示 `error.code` 与 `requestId`。
6. 不打印 Wi-Fi 密码；不把密码写入 storage；日志不得含完整凭据。
7. 关键可交互元素加 `data-testid="..."`（供 miniprogram-automator 使用），见各页要求。
8. 单位、时间、过期、报警文案统一用 view model 字段，不自己拼。
9. WXML 里避免复杂表达式；在 js 中算好放 data。事件绑定命名 `onXxx` / `bindtap="onXxx"`。
10. 所有页面顶部若 `view.online === false` 或 `view.stale`，必须展示 `overallStatus` banner。

---

## 5. 页面清单与验收

### 5.1 dashboard（总览，首页）

- 顶部：`overallStatus` banner + 设备在线/离线 badge + 数据年龄 `view.ageText`。
- 湿度卡片：`view.humidity.text + .unit`，副标题 `view.sensorKindText`；无效时 `--` 并显示 `qualityText`。
- 温度卡片：`view.temperature.text ℃`（不可用显示 `--`）。
- 风扇开关（`switch`）：`checked=view.fan.on`，change → `device.setFan`；命令中禁用；失败回滚到设备状态并 toast 错误。
- 自动模式开关：`checked=view.mode.isAuto`，change → `device.setAutoMode`；失败回滚。
- 快捷入口：配网、设置、安防是 tabBar 页，必须用 `wx.switchTab`；只有诊断用 `wx.navigateTo`。
- 最近一次命令回执一行：`device.resultSummary(device.getLastCommand())`。
- 手动开/关在报警激活时必须提示被拒绝原因（`ALARM_LOCKED`）。
- `data-testid`：`dash-refresh`、`dash-fan-switch`、`dash-auto-switch`、`dash-humidity`、`dash-banner`。

### 5.2 provisioning（NFC 配网）

- SSID 输入、密码输入（`password` 属性，默认掩码）、平台能力提示（`nfc.getCapability().note`）。
- iPhone/无 NFC 环境：明确展示"需安卓辅助/模拟写入"，不能显示真实写成功。
- 点击“写入标签” → `nfc.writeWifi`；逐步骤展示进度（步骤名来自 `STEP_TEXT`），失败展示可读错误；完成后清理并允许重试。
- 模拟成功时展示：记录摘要（tnf/type/id/payload 长度、总字节）、警示"模拟写入不等于板端读取/联网"。
- 真实成功时展示 `verified` 结果与回读不一致提示。
- 不在界面/日志展示真实密码；展示 payload 时做脱敏（如 `{"ssid":"Lab24G","passwd":"***"}`）。
- `data-testid`：`prov-ssid`、`prov-passwd`、`prov-write`、`prov-progress`、`prov-result`。

### 5.3 settings（阈值设置）

- 显示设备已确认值：`view.config.lowerText/upperText`、`configRevision`、`updatedAtText`、`configStatusText`。
- 两个 number 输入（上下限草稿），初始值取设备值；输入校验（0–100 整数、下限<上限），错误就地展示。
- 显式“保存到设备”按钮：进行中禁用；成功后刷新状态并展示 `saved=true + revision`；失败展示 `error.code/message` 并保留草稿。
- 区分草稿与已确认值（例如"未保存"/"已保存"标记）。
- 附带火焰阈值设置：`flameTrip`/`flameClear`（0–4095 整数，触发>解除），保存调用 `saveSecurityConfig`；能力判定统一用 `view.flame.available`（能力位缺失按未配置处理），为 false 时显示“未配置”并禁用。
- 保存时携带 `expectedRevision: view.config.configRevision`，冲突时提示刷新后重试。
- `data-testid`：`set-lower`、`set-upper`、`set-save`、`set-status`、`flame-trip`、`flame-clear`、`flame-save`。

### 5.4 security（安防）

- 能力位驱动：`view.capabilities.gas` 决定显示 eCO₂/TVOC/可燃气体；没有的项显示"未配置"。
- 气体读数用 `view.gas.items`（text+unit），显示质量状态。
- 火焰：`view.flame.raw/text`，报警状态 `view.alarm.text`；报警中 banner（红）。
- 电机方向：`view.motor.available` 为 true 时显示方向文本；false 显示"未配置"。
- 报警操作：满足 `view.alarm.canAcknowledge` 时“确认解除报警”可点；未满足时禁用并说明原因；mock 模式提供"模拟报警/解除"按钮（仅 diagnostics 或本页 dev 区域，需标注 mock）。
- 断网/过期时仍展示最后状态并说明。
- `data-testid`：`sec-eco2`、`sec-tvoc`、`sec-combustible`、`sec-flame`、`sec-alarm`、`sec-ack`、`sec-mock-active`、`sec-mock-clearing`。

### 5.5 diagnostics（诊断）

- 环境：显示 `device.getEnv()`（mode/baseUrl/deviceId/pollIntervalMs/staleAfterMs）；提供输入/切换：
  - mock/gateway 切换、baseUrl、deviceId 编辑，保存调用 `device.setEnv`；保存后立即 `refresh()`。
- 健康检查：`device.health()` 结果（provider/version/bootId/uptime 或错误）。
- transport 名称/描述、小程序版本 `getApp().globalData.appVersion`。
- 最近回执：`device.getLastCommand()` 的 action/requestId/status/saved/configRevision/error.code。
- 设备能力 JSON（`view.capabilities`）折叠展示。
- mock 专用：故障注入开关（offline/sensorError/nvWriteError/nvVerifyError）、重置 mock、模拟报警；每次切换后刷新。
- 诊断信息只读展示，**不要**放真实密码/AppID。
- `data-testid`：`diag-mode`、`diag-baseurl`、`diag-deviceid`、`diag-save`、`diag-health`、`diag-command`、`diag-fault-offline`、`diag-reset`。

---

## 6. Gateway（应用服务）HTTP 契约

Node ≥ 18，**零外部依赖**（只用 `node:http`、`node:fs`、`node:path`），CommonJS。
默认 `127.0.0.1:8080`，`provider: 'mock'`；启动：`node gateway/src/index.js`。

### 6.1 配置

`gateway/config/default.json`（提交）：
```json
{
  "host": "127.0.0.1",
  "port": 8080,
  "provider": "mock",
  "deviceId": "mock-farm-001",
  "staleAfterMs": 90000,
  "commandTimeoutMs": 8000
}
```
`gateway/config/local.json`（不提交，可覆盖 host/port/provider 等）；`local.example.json` 给模板。
环境变量覆盖：`GATEWAY_PORT`、`GATEWAY_HOST`、`GATEWAY_PROVIDER`（可选）。

### 6.2 接口

统一 JSON；错误统一 `{"error":{"code":"...","message":"..."}}`，HTTP 状态：
400/404/409/429/500/501/503。

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/v1/health` | `200 {ok, provider, version, deviceId, bootId, uptimeMs, serverTime}`；provider 不可用时 `ok:false` |
| `GET /api/v1/devices/{id}/state` | `200` RawState（§2.1），`receivedAt` 为服务器写入时间；未知设备 `404 DEVICE_OFFLINE` |
| `POST /api/v1/devices/{id}/commands` | body `{requestId, action, params, expectedRevision?}`；成功 `202 {requestId, status:'pending', statusUrl}` |
| `GET /api/v1/devices/{id}/commands/{requestId}` | `200 {requestId, status:'pending'|'applied'|'rejected'|'unknown', result?}`；未知 requestId `404 {error:{code:'STALE_COMMAND'}}` |

命令执行语义：
- 每设备串行执行；同一 requestId 重复提交返回原状态（不得重复执行）；
- `expectedRevision` 透传给 provider；冲突时 `result.status='rejected', errorCode='REVISION_CONFLICT'`；
- 静态校验失败（请求格式/未知 action/参数越界）直接返回 `400`，不入队；请求合法但设备拒绝时返回 `202`，客户端轮询到 `applied`/`rejected` 才算结束；
- 命令保留最近 100 条；超过 30 分钟可清理。

provider：
- `mock`：**直接复用** `wechat/smart_farm/services/mock-device.js`（`createMockDevice({latencyMs:300, storage: memory})`），保证与小程序 mock 语义一致；对 `get_state` 无需命令。
- `huawei`：骨架，`health()` 返回 `{ok:false, provider:'huawei', configured:false, note:'未配置华为云实例...'}`；其他接口返回 `501 NOT_IMPLEMENTED`。注释写清后续接入点（IoTDA 设备/应用 API、command_id↔requestId）。
- `local`：骨架，同上，注释写清楚对接本地 MQTT 适配的位置。

### 6.3 CORS 与安全

- 允许 `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: content-type`、`OPTIONS` 预检返回 204（便于浏览器/调试工具自测，wx.request 不受 CORS 限制）。
- 日志不得输出请求体中的密码；不把真实云凭据写入代码/配置模板。
- 请求体上限 32KB，超限 413。

### 6.4 测试

`gateway/tests/smoke.js`：纯 Node（`node:test` 或自写断言），启动服务于端口 0，覆盖：
health、state、非法 action 400、阈值越界 400、保存成功 202→轮询 applied+`saved=true`+revision 增长、重复 requestId 幂等、revision 冲突通过轮询 rejected/REVISION_CONFLICT 表达、未知设备 404、未知 command 404、provider 未实现 501（如能切换）。
最后打印 `SMOKE OK` 并以 0 退出；失败非 0。

---

## 7. 单元测试（tests/miniprogram）

纯 Node，不依赖 wx。直接 `require` 小程序纯逻辑模块（它们不引用 wx）。
建议覆盖：
1. `utils/nfc-codec`：ASCII 正常记录字节与顺序；中文/引号/反斜杠/超长拒绝；时间戳 id；`str2ab` 行为；`describeRecord`。
2. `models/state`：正常状态归一化（单位/文本/过期/质量）；offline/stale/alarm 组合；`overallStatus`。
3. `models/errors`：码→文案、未知码兜底、`createError`。
4. `services/mock-device`：阈值保存成功 saved/revision；非法阈值拒绝；相同 requestId 幂等；不同参数 DUPLICATE_CONFLICT；expectedRevision 冲突；NV 故障注入；离线；自动模式规则（低湿开/高湿关/区间保持）；报警锁定时拒绝手动与自动；`acknowledge_alarm` 在 active 时拒绝、clearing 时清锁；重启后（新实例同 storage）配置恢复与最后 ID 幂等。
5. `services/device`：`validateThresholds`、`saveThresholds` 客户端校验、`resultSummary`（需要可注入 transport——device.js 目前用 config transport 单例，测试可通过 `device.setEnv` + mock 环境跑，或直接测 validate/resultSummary 纯函数）。
6. `utils/time`、`utils/units` 边界值。

入口：`tests/run-all.js` 先跑小程序单测，再 `node gateway/tests/smoke.js`；全部通过打印 `ALL TESTS PASSED`。

---

## 8. 工程红线

- 不提交 `node_modules`、`miniprogram_npm`、`project.private.config.json`、真实 Wi-Fi/云凭据。
- 不修改 `demo/BUILD.gn` 与设备端 C 代码（本阶段只做小程序+网关）。
- 页面中文文案，术语与 `doc/04` 一致（"保存到设备"而不是"保存本地"）。
- 代码 2 空格缩进、单引号、分号省略保持一致（参照已提供文件）。
- 每个新文件 UTF-8 无 BOM、LF 换行（仓库原有 GBK 文件不动）。
