# tests/ —— 小程序 + 网关测试套件

纯 Node（CommonJS，零第三方依赖）测试，覆盖 `wechat/smart_farm/` 的纯逻辑层与 `services/device` 门面。
不 require 任何页面文件，不需要微信开发者工具 / `miniprogram-automator`。

## 运行

在 `fs_hi3861/` 目录（或任意目录，runner 按自身位置解析路径）执行：

```powershell
node tests/run-all.js
```

只跑单个文件：

```powershell
node tests/miniprogram/utils.test.js
node tests/miniprogram/nfc-codec.test.js
node tests/miniprogram/errors.test.js
node tests/miniprogram/state.test.js
node tests/miniprogram/mock-device.test.js
node tests/miniprogram/device.test.js
node tests/miniprogram/regression.test.js
```

`run-all.js` 行为：

1. 依次 spawn 上面 7 个小程序单测文件（子进程退出码即结果）；
2. 再 spawn `node gateway/tests/smoke.js`（cwd 为 `fs_hi3861/`）；
3. 全部通过打印 `ALL TESTS PASSED` 并以 0 退出；任一失败以非 0 退出；
4. `gateway/tests/smoke.js` 是交付物的一部分，缺失时判失败（不再 SKIP）。

Node ≥ 18（使用 `node:assert` / `node:child_process`），已在 Node 24 验证。

## 目录

```text
tests/
├─ run-all.js                 汇总入口（小程序单测 + gateway smoke）
├─ README.md                  本文
├─ ui/
│  ├─ smoke.js                真机模拟器 UI 冒烟（需要微信开发者工具登录 + 服务端口）
│  └─ artifacts/              UI 冒烟截图（gitignore，不入库）
└─ miniprogram/
   ├─ harness.js              极简 harness：describe/it/knownIssue + 计数 + 失败汇总
   ├─ utils.test.js           utils/time.js、utils/units.js
   ├─ nfc-codec.test.js       utils/nfc-codec.js
   ├─ errors.test.js          models/errors.js
   ├─ state.test.js           models/state.js
   ├─ mock-device.test.js     services/mock-device.js
   ├─ device.test.js          services/device.js
   └─ regression.test.js      第二轮复核缺陷的回归用例
```

## 覆盖范围

| 文件 | 覆盖点 |
| --- | --- |
| `utils.test.js` | `parsePercentInt` 0–100/整数/空值边界；`round1` 四舍五入；`formatHumidity` / `formatTemperature` / `formatRaw` / `formatConcentration`；`humidityUnit` / `sensorKindText`；`time.formatAge` 刚刚/秒/分钟/小时/天分档边界；`isStale` 恰好等于 `staleAfterMs` 的边界；`formatTime` / `formatDateTime` |
| `nfc-codec.test.js` | 正常记录（`tnf=2`、`type='t'` 0x74、13 位时间戳 id、紧凑 JSON payload、字节顺序/长度/总计）；显式时间戳 0 与默认时间戳；中文/全角/引号/反斜杠/控制字符/超长（SSID 32、密码 63）/缺字段/非字符串拒绝；短密码与空密码 warning；`str2ab` 低 8 位语义（非 UTF-8）、`ab2str`、`byteLength`、`toHex`；`describeRecord`（含 null）；`buildPayload` / `parsePayload` 往返 |
| `errors.test.js` | `DESCRIPTIONS` 覆盖全部 `CODES` 且字段类型正确；每个已知码的 message/hint/retryable 映射；未知码/空值兜底 `UNKNOWN`；`errorCode` 回退；detail 规则（差异 message、相同 message 不重复、`err.detail`、字符串 detail、`Error.message`、fallbackMessage）；`createError` 的 code/默认文案/自定义文案/附加字段/'未知码→UNKNOWN'；`createError` → `describeError` 往返 |
| `state.test.js` | 正常 RawState 归一化（湿度/温度文本与单位、风扇/电机/模式、报警、配置、气体三项、火焰、能力透传）；`soil_relative` 单位；空 raw 容错；`stale` 恰好 90000ms 边界与显式 `raw.stale`；离线优先级；`active` / `clearing` / `suspected` 组合；`overallStatus` ok/warn/err 三档及优先级；气体能力未配置（全部未配置 / 仅可燃气体未标定）；火焰不可用与方向；电机能力位；`configStatusText` 四态；`isSensorValid` / `qualityText` |
| `mock-device.test.js` | 默认配置与完整 RawState/能力；`set_thresholds` 成功（saved/revision/回读）、sensorKind、非法区间/小数/越界拒绝、值未变不涨 revision、相同 requestId 幂等、同 ID 不同参数 `DUPLICATE_CONFLICT`、`expectedRevision` 冲突/成功；NV 写失败/回读校验失败；`set_security_config` 成功与非法/越界；`set_fan`/`set_mode` 成功与非法值；自动模式方向（99/100 必开、0/1 必关、19/100 区间保持）；报警 `active` 锁 `set_fan`/`set_mode auto`/`acknowledge_alarm`；`clearing` 确认后清锁；离线拒绝命令、健康检查、恢复；传感器故障 `SENSOR_INVALID`；故障表读回；同 storage 新实例恢复配置/revision 且最后 requestId 幂等；`reset()` 回默认并落盘 |
| `device.test.js` | `getEnv` 默认值与 transport 名称；`validateThresholds` 0/100 边界、相等/倒置、小数、越界、空值错误码；`validateSecurityConfig` 边界与 `trip<=clear`；`resultSummary` 对 applied+saved / applied / rejected / error / 无记录 的文案；`saveThresholds` 客户端校验失败返回 `invalid:true` 且不产生命令；mock 下保存成功、`saved=true`、revision 增长、回读；`expectedRevision` 冲突；`saveSecurityConfig` 校验短路与成功；`refresh` / `setFan` / `setAutoMode`；transport 抛错时 `refresh` 与 `send` 的错误归一化 |
| `regression.test.js` | null/布尔安全（units/state）、`set_fan` expectedRevision、`set_security_config` NV 回读失败、报警时 manual 也被拒绝、NV 失败置 `configStatus=write_failed`、`validateSecurityConfig` 拒绝小数、gateway 404 `STALE_COMMAND` 映射、NFC 既定记录布局 |

## 无 wx 依赖说明

- 被测模块全部是纯 CommonJS：`utils/*`、`models/*`、`services/mock-device.js` 不引用 `wx`；
  `config/index.js`、`services/transport-mock.js`、`services/transport-gateway.js` 只在函数体内用
  `typeof wx !== 'undefined'` 做能力判断，Node 下 require 不会触发。
- 测试只 require 上述模块与 `services/device.js`、`services/transport.js`，**不 require** 页面文件、`app.js`，
  因此不会触碰 `Page()` / `getApp()` / `wx.*`。
- 不使用 jsdom、不伪造全局 `wx`（`device.test.js` 的异常路径通过临时替换 `services/transport.js`
  的 `getTransport` 注入 stub，测试结束恢复）。
- 页面交互与真机模拟器冒烟由 `tests/ui/smoke.js` 覆盖（微信开发者工具登录 + 安全设置开启服务端口）；
  真实 NFC 射频、真实硬件与真机网络仍需实物验证。

## knownIssue 约定

`h.knownIssue(name, fn)` 仅用于“源码与契约不一致但本轮不修”的临时记录：

- 断言失败 → 打印 `KNOWN ISSUE`，计入 known issues，**不判失败**；
- 修复后断言通过 → 打印 `KNOWN-FIXED`，也不判失败；
- 真正的回归/契约违背用 `h.it`，失败即非 0 退出。

第二轮复核发现的 7 个缺陷（units 把 null 当 0、parsePercentInt 接受布尔、set_fan 忽略 revision、
set_security_config 未校验 nvVerify、报警时 manual 未拦截、validateSecurityConfig 四舍五入、
configStatusText 缺失回退错误）已全部修复，对应断言已收编为正式 `it`；当前套件不再有 KNOWN ISSUE。

## 约定

- `harness.js` 的 `SM_ROOT` 由 `__dirname` 相对定位，换机器/移动仓库无需修改。
- 测试只读源码，不写入源码目录；mock 设备的 storage 全部是内存实现。
- 输出为 ASCII 标题 + 中文断言文案，UTF-8；Windows 终端建议 `chcp 65001`。
