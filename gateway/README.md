# smart-farm-gateway

智慧农业课程项目的**本机应用服务**。默认使用 mock provider，直接复用小程序侧的
`wechat/smart_farm/services/mock-device.js`，用于在没有云实例、没有实物板子的阶段做 HTTP 联调。
`huawei` provider 已实现华为云 IoTDA **应用侧** API（IAM 鉴权、设备/影子查询、同步命令），
需要在本机 `config/local.json` 的 `huawei` 段填写应用侧凭据后才可用；未配置时按降级语义
返回 `configured:false` / `501`，不会访问网络。

技术约束：Node.js >= 18、CommonJS、**零外部依赖**（仅 `node:http` / `node:fs` / `node:path` 等内置模块）。

## 启动

在 `fs_hi3861/` 目录下：

```bash
node gateway/src/index.js
# 默认 http://127.0.0.1:8080，provider=mock，deviceId=mock-farm-001
```

也可以在 `gateway/` 目录下：

```bash
npm start
npm test
```

启动成功后入口会打印实际监听地址（支持 `port: 0` 的随机端口，方便测试）：

```text
[smart-farm-gateway] listening on http://127.0.0.1:8080 (provider=mock, deviceId=mock-farm-001)
```

## 配置

配置优先级从低到高：

1. `config/default.json`（提交）
2. `config/local.json`（可选，本机覆盖，**不要提交**）
3. 环境变量 `GATEWAY_HOST` / `GATEWAY_PORT` / `GATEWAY_PROVIDER`

默认值：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `127.0.0.1` | 监听地址；真机访问需改为局域网可访问地址 |
| `port` | `8080` | HTTP 端口；`0` 表示由系统分配随机端口 |
| `provider` | `mock` | `mock` / `huawei` / `local`；`huawei` 需要额外的 `huawei` 段 |
| `deviceId` | `mock-farm-001` | 当前进程承载的单台设备 |
| `staleAfterMs` | `90000` | 数据过期阈值，随配置保存，供联调参考 |
| `commandTimeoutMs` | `8000` | 等待设备命令结果的上限 |

本机覆盖方式：

```bash
cp gateway/config/local.example.json gateway/config/local.json
# 修改后启动；local.json 不提交到 Git
GATEWAY_PORT=8081 GATEWAY_PROVIDER=mock node gateway/src/index.js
```

`config/local.example.json` 是脱敏模板，不包含 Wi-Fi 密码、华为云/IoTDA 凭据或其它密钥。
`huawei` provider 只读取 `huawei` 段中的字段值，不会把凭据写入代码、模板或日志；字段清单、
IAM scope 写法和命令/属性映射见下文“华为云 provider 配置与凭据”。

## HTTP 接口

所有接口前缀为 `/api/v1`，响应统一为 JSON。成功响应如无特别说明均为 `application/json; charset=utf-8`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/health` | 健康信息，HTTP 200 |
| `GET` | `/api/v1/devices/{id}/state` | 读取设备状态 RawState |
| `POST` | `/api/v1/devices/{id}/commands` | 接收异步命令，HTTP 202 |
| `GET` | `/api/v1/devices/{id}/commands/{requestId}` | 查询命令状态 |
| `OPTIONS` | 任意路径 | CORS 预检，HTTP 204 |

### 健康检查

```json
{
  "ok": true,
  "provider": "mock",
  "version": "mock-0.1.0",
  "deviceId": "mock-farm-001",
  "bootId": "boot-...",
  "uptimeMs": 1234,
  "serverTime": 1700000000000
}
```

`huawei` / `local` 的 health 固定为 HTTP 200，并额外带 `configured` 和 `note`。
provider 未实现（`local`）或已实现但未配置（`huawei` 缺少应用侧字段）时 `ok` 为 `false`，
不代表进程启动失败。`huawei` 配置完整时 `ok:true, configured:true`，但 health **不联网探测**
云端连通性，只做本机配置检查。health 的 `note` 只列出缺失字段名，不回显任何凭据值。

### 状态

`GET /api/v1/devices/{id}/state` 返回 `contract.md` §2.1 的 RawState。`receivedAt` 由 gateway
在返回前写成服务器当前毫秒数，不信任上游时钟。

未知设备返回 `404 {"error":{"code":"DEVICE_OFFLINE","message":"..."}}`。
mock 故障注入设置为 offline 时，设备仍是已知设备，接口会返回 200 且状态中的 `online: false`。

`huawei` provider 把设备详情 `status`（`ONLINE` / `OFFLINE` / `ABNORMAL` / `INACTIVE` / `FROZEN`）
与设备影子 `reported.properties` 归一化为 RawState。设备离线或影子接口 404 时仍返回 HTTP 200 的
RawState：`online:false`、`sensor.quality:'error'`，缺失的数值是 `null`（阈值等字段可能直接省略），
**不会把 null 补成 0**。属性映射与容错规则见下文。

### 命令

提交：

```json
{
  "requestId": "set_thresholds-abc123",
  "action": "set_thresholds",
  "params": { "lower": 30, "upper": 40 },
  "expectedRevision": 2
}
```

成功被接收（尚未执行完）：

```json
{
  "requestId": "set_thresholds-abc123",
  "status": "pending",
  "statusUrl": "/api/v1/devices/mock-farm-001/commands/set_thresholds-abc123"
}
```

轮询：

```json
{
  "requestId": "set_thresholds-abc123",
  "status": "applied",
  "result": {
    "requestId": "set_thresholds-abc123",
    "action": "set_thresholds",
    "status": "applied",
    "errorCode": null,
    "message": "",
    "saved": true,
    "configRevision": 3,
    "params": { "lower": 30, "upper": 40 },
    "appliedAt": 1700000001000
  }
}
```

`status` 取值为 `pending` / `applied` / `rejected` / `unknown`。`202` 只表示命令已入队，
客户端必须继续轮询到 `applied` / `rejected` / `unknown`。未知或已过期的 requestId 返回：

```json
{ "error": { "code": "STALE_COMMAND", "message": "命令不存在或已过期" } }
```

## 命令执行语义

- **串行**：每个设备一条队列，上一条 provider 命令结束后才执行下一条；gateway 不会并发调用同一设备的 `sendCommand`。
- **幂等**：相同 deviceId + requestId + action + params + expectedRevision 重复 POST 直接返回已有记录，
  不重新入队、不重新执行。响应仍是 HTTP 202，`status` 为该记录当前状态。
- **冲突**：同一 requestId 携带不同 action/params/expectedRevision 返回
  `409 DUPLICATE_CONFLICT`，不会覆盖原命令。
- **expectedRevision**：原样透传给 provider。revision 不匹配时命令的最终结果是
  `rejected + REVISION_CONFLICT`，通过轮询获取（HTTP 提交阶段仍为 202）。
- **静态校验（400）**：gateway 维护 action 白名单与基础参数校验，能在入队前判定的非法请求直接返回
  `400`，不占用设备命令名额：未知 action → `UNSUPPORTED_CAPABILITY`；参数类型/取值非法 →
  `INVALID_PAYLOAD`；阈值越界或下限≥上限、火焰触发≤解除 → `INVALID_THRESHOLD_RANGE`。
- **设备侧拒绝（202 → rejected）**：请求本身合法但设备拒绝（离线、报警锁定、revision 冲突、NV 失败、
  能力不支持等）时，POST 返回 `202`，轮询结果 `status=rejected` + `errorCode`。客户端必须区分
  “请求非法（400）”与“设备拒绝（202→rejected）”。
- **容量与保留**：每个设备最多保留最近 100 条命令；已完成且超过 30 分钟的记录会被清理
  （定时清理 + 访问时惰性清理）。待执行命令过多时新命令返回 `429 BUSY`。
- **超时**：超过 `commandTimeoutMs` 仍未拿到 provider 结果时，命令置为 `unknown`，
  `result.errorCode = "TIMEOUT"`，不伪造成功。
- **持久性**：命令记录在内存中，gateway 重启后丢失；mock 设备的配置也只在当前进程的内存 storage 中。

## 错误格式与 CORS

所有错误响应：

```json
{ "error": { "code": "INVALID_PAYLOAD", "message": "请求参数不合法" } }
```

| HTTP | 典型 code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_PAYLOAD` / `INVALID_THRESHOLD_RANGE` / `UNSUPPORTED_CAPABILITY` | 请求体畸形、requestId 缺失/非法、params 类型错误、阈值越界、未知 action |
| 404 | `DEVICE_OFFLINE` / `STALE_COMMAND` | 未知设备 / 未知或过期 requestId |
| 405 | `METHOD_NOT_ALLOWED` | 已知路径使用了不支持的方法 |
| 409 | `DUPLICATE_CONFLICT` | 同一 requestId 复用于不同命令 |
| 413 | `INVALID_PAYLOAD` | 请求体超过 32KB |
| 429 | `BUSY` | 待执行命令队列已满 |
| 501 | `NOT_IMPLEMENTED` | `local` 未实现；`huawei` 缺少应用侧字段时的 state / 命令结果 |
| 503 | `DEVICE_OFFLINE` / `PROVIDER_UNAVAILABLE` | provider 调用失败、上游不可用（`huawei` 的 401/403/5xx/网络/超时/设备不存在等） |
| 500 | `INTERNAL_ERROR` | 未归类的内部错误 |

CORS：所有响应（含错误响应）带 `Access-Control-Allow-Origin: *`、
`Access-Control-Allow-Headers: content-type`；`OPTIONS` 预检直接返回 204。
请求体上限为 32KB（32768 字节），超限返回 413。

## Provider

### mock（默认，完整可用）

`src/providers/mock.js` 直接 `require` 小程序的
`wechat/smart_farm/services/mock-device.js`，使用 `createMemoryStorage()` 和
`createMockDevice({ latencyMs: 300, storage, deviceId })`。状态、命令、revision、幂等、
报警/自动模式等语义与小程序 mock 完全一致。代码不复制一份 mock 设备实现。

### huawei（已实现，需本机配置）

`src/providers/huawei.js` 使用华为云 IoTDA 应用侧 HTTPS API，不依赖设备侧 MQTT 客户端：

- **IAM**：`POST https://{iamEndpoint}/v3/auth/tokens?nocatalog=true`，从响应头
  `X-Subject-Token` 取 token，按 `token.expires_at` 缓存（提前 60 秒过期）；业务请求带
  `X-Auth-Token`，遇到 401 强制刷新一次并重试。token 只存在 provider 实例内存中。
- **getState**：`GET /v5/iot/{projectId}/devices/{deviceId}` 取在线状态，
  `GET /v5/iot/{projectId}/devices/{deviceId}/shadow` 取 `reported.properties`，
  归一化为 contract §2.1 RawState。
- **sendCommand**：`POST /v5/iot/{projectId}/devices/{deviceId}/commands`，
  `service_id=control`；平台 `command_id` 记录为 `result.platformCommandId`，
  设备 `response.result_code` / `response.paras` 映射为 applied/rejected 与 saved/revision。
- **未配置时**：`implemented` 仍为 `true`，但 health 返回 `configured:false`，
  state / 命令结果抛 `NOT_IMPLEMENTED`（HTTP 501 或 202→rejected），不会访问真实网络。
- 配置字段、IAM scope、属性/命令映射与失败语义见下一节。

### local（骨架）

`src/providers/local.js` 仍未实现：health 返回 `ok:false / configured:false / note`；
`getState`、`sendCommand` 抛 `NOT_IMPLEMENTED`（HTTP 501）。文件内注释标出本地 MQTT broker、
状态订阅、命令 publish、回执订阅和 broker 凭据的适配位置。

当前 gateway 每个进程只注册 `config.deviceId` 一台设备；多设备需要在 registry 和 provider
层扩展。`huawei` provider 也遵循这个单设备约束。

## 华为云 provider 配置与凭据

本节说明 `huawei` provider 的真实接入方式。仓库、README、模板、测试中**不写任何真实值**；
真实值只存在于本机 `config/local.json`（不提交、不发群、不贴日志）。

### 配置来源与字段

gateway 启动时读取 `config/default.json`，再合并本机 `config/local.json`，把其中的
`huawei` 段原样交给 `src/providers/huawei.js`。`createHuaweiProvider(config, deps)` 也支持
`deps.huaweiConfig` 显式覆盖（单测用；`null` 表示强制未配置）。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `iotdaEndpoint` | 是 | IoTDA 应用侧接入域名，如 `xxxxx.iotda.cn-north-4.myhuaweicloud.com`；可带 `https://`，末尾斜杠会被去掉 |
| `projectId` | 是 | 资源空间/项目 ID，用于 `/v5/iot/{projectId}/...`，也是 IAM `scope.project.id` 的默认值 |
| `iamEndpoint` | 是 | IAM 域名，如 `iam.cn-north-4.myhuaweicloud.com` |
| `iamDomain` | 是 | IAM 用户的账号/domain 名，写入 `user.domain.name` |
| `iamUserName` | 是 | IAM 用户名，写入 `user.name` |
| `iamPassword` | 是 | IAM 密码，只在本机内存中使用；**不要提交、不要打印** |
| `deviceId` | 否 | 覆盖 gateway 顶层 `deviceId`，作为 IoTDA 设备 ID |
| `projectName` / `iamProjectName` | 否 | 非空时 IAM scope 改用 `project.name`；为空则用 `project.id`（见下） |
| `verifyTls` | 否 | 默认 `true`；`false` 的注意事项见“TLS 说明” |
| `requestTimeoutMs` | 否 | 单次 HTTPS 请求超时，默认取 `commandTimeoutMs`，再退回 8000ms |
| `mqttEndpoint` / `mqttPort` | 否 | **仅设备侧 MQTT 接入信息**；`huawei` provider 不使用，也不能替代应用侧凭据 |

`deviceId` 优先取 `huawei.deviceId`，否则用 gateway 顶层 `deviceId`。`mqttEndpoint` /
`mqttPort` 只是设备侧 MQTT broker 信息（设备连 IoTDA 用），和应用侧 IAM/IoTDA API 凭据是
两套东西：**只有设备侧 MQTT 用户名/密码/设备密钥无法调用应用侧 API**；反过来，应用侧
IAM 用户也需要在华为云上具备 IoTDA 的访问权限，且产品模型里存在 `control` 服务与相应命令。

### IAM 鉴权

请求：

```text
POST https://{iamEndpoint}/v3/auth/tokens?nocatalog=true
Content-Type: application/json;charset=utf8
```

请求体（占位符，不要填真实值）：

```json
{
  "auth": {
    "identity": {
      "methods": ["password"],
      "password": {
        "user": {
          "name": "<iamUserName>",
          "password": "<iamPassword>",
          "domain": { "name": "<iamDomain>" }
        }
      }
    },
    "scope": {
      "project": { "id": "<projectId>" }
    }
  }
}
```

两种 scope 写法（二选一，provider 自动选择）：

```json
"scope": { "project": { "id": "<projectId>" } }
```

```json
"scope": { "project": { "name": "<region project name>" } }
```

如果只有 `projectId`，用 `scope.project.id` 即可（本仓库模板默认这样）；如果拿到了
IAM 项目名，可在 `huawei.projectName` 填项目名，provider 会改用 `scope.project.name`。
注意两者不是同一个概念：`projectId` 同时用于 IoTDA URL，`project.name` 只用于 IAM scope。

响应头 `X-Subject-Token` 是 token；响应体 `token.expires_at` 用于计算过期时间。provider
在实例内缓存 token（提前 60 秒过期），业务请求带 `X-Auth-Token`；收到 401 时强制刷新一次
并重试。token 和密码都不会进入日志、health 或命令结果。

### 属性 → RawState 映射

属性键名容错：比较时忽略大小写、下划线、连字符和空格，因此 `humi_down` / `humiDown` /
`HIMI_DOWN` 等价；也支持把属性放在 `sensor` / `config` / `gas` / `flame` / `actuators`
等嵌套对象里（摊平深度 ≤ 2）。设备影子若返回多个 service，`control` service 的同名属性优先。

| IoTDA `reported.properties` 键（含容错写法） | RawState 字段 | 说明 |
| --- | --- | --- |
| `humidity` / `humi` / `humidityValue` / `airHumidity` / `soilHumidity` | `sensor.humidity` | 数值或 `null`；不补 0 |
| `temperature` / `temp` / `temperatureValue` / `airTemperature` | `sensor.temperature` | 数值或 `null` |
| `sensorKind` / `sensorType` | `sensor.kind`、`config.sensorKind` | `air_rh` / `soil_relative`（也接受 air/soil） |
| `fan` / `fanStatus` / `fanState` / `fanSwitch` | `actuators.fan` | ON/OFF → `on`/`off`；缺失时 `off` |
| `motor` / `motorStatus` / `motorState` / `motorDirection` | `actuators.motor` | stopped/forward/reverse；缺失时 `null` |
| `autoMode` / `mode` / `workMode` | `mode` | ON→`auto`，OFF→`manual`；缺失时 `manual` |
| `humi_down` / `humidityLower` / `humiLower` / `lower` | `config.humidityLower` | 整数；缺失时字段省略 |
| `humi_up` / `humidityUpper` / `humiUpper` / `upper` | `config.humidityUpper` | 整数；缺失时字段省略 |
| `flameTrip` / `flameThreshold` | `config.flameTrip` | 整数；缺失时字段省略 |
| `flameClear` / `flameClearThreshold` | `config.flameClear` | 整数；缺失时字段省略 |
| `alarmEnabled` | `config.alarmEnabled` | 布尔；缺失时字段省略 |
| `configRevision` / `cfgRevision` / `revision` | `config.configRevision` | 整数或 `null`；用于 expectedRevision |
| `configStatus` / `configUpdatedAt` | `config.configStatus` / `config.updatedAt` | 可省略 |
| `eco2` / `co2` / `equivalentCo2` | `gas.eco2` | 数值或 `null` |
| `tvoc` / `voc` | `gas.tvoc` | 数值或 `null` |
| `combustibleRaw` / `combustible` / `gasRaw` | `gas.combustibleRaw` | 数值或 `null` |
| `flameRaw` / `flame` / `flameValue` / `flameAdc` | `flame.raw` | 数值或 `null` |
| `alarmStatus` / `alarmState` / `alarm` | `alarm.status` | normal/suspected/active/clearing；`alarm` 为对象时读取其 `status` |
| `alarmId` / `alarmSince` / `alarmMuted` | `alarm.id` / `alarm.since` / `alarm.muted` | 可选 |
| `bootId` / `seq` / `uptimeMs` / `sampledAt` | 顶层或 `sensor.sampledAt` | 可选；`event_time` 作为 sampledAt 兜底 |
| `board` / `boardName` / `firmware` / `fwVersion` / `swVersion` | `capabilities.board` / `capabilities.firmware` | 缺失时 `null` |
| `supportsMotorReverse` / `motorReverseSupported` | `capabilities.supportsMotorReverse` | 显式声明优先；否则有 `motor` 属性时为 `true` |
| `flameAvailable` / `flameSupported` | `capabilities.flame.available` | 显式声明优先；否则按 `flame*` 属性是否存在 |
| `capabilities`（对象/JSON 字符串） | `capabilities.*` | 可携带 `board`、`firmware`、`gas`、`flame.rawRange/direction`、`calibrated` |

能力位规则：

- `capabilities.gas.eco2/tvoc/combustible`：对应属性存在则为 `true`；若设备在 `capabilities.gas`
  中显式声明 `false`，以声明为准。
- `capabilities.flame.available`：`flame` 类属性存在或显式声明；`rawRange` 默认 `[0,4095]`，
  `direction` 默认 `up`。
- `capabilities.calibrated.combustible`：显式声明，否则 `false`。
- `capabilities.board` / `firmware` 未上报时为 `null`（占位，不伪造型号）。

质量位规则：

- 设备离线（平台 status 不是 `ONLINE`）→ `sensor.quality:'error'`；影子里的旧值仍保留，
  但 online=false，小程序会显示“设备离线，显示的是最后一次缓存状态”。
- 设备在线但影子 404/不存在 → `sensor.quality:'error'`。
- 影子存在但没有湿度/温度 → `sensor.quality:'not_configured'`。
- 没有任何气体属性 → `gas.quality:'not_configured'` 且 `capabilities.gas.*` 均为 `false`。
- `null` 与“字段缺失”都不会变成 0：数值字段缺失时为 `null`，配置阈值/能力位缺失时直接省略。

### 命令映射

所有命令固定 `service_id: "control"`：

| gateway action | IoTDA command_name | IoTDA paras |
| --- | --- | --- |
| `set_fan` | `fan` | `{ "value": "ON" \| "OFF" }` |
| `set_mode` | `autoMode` | `{ "value": "ON" \| "OFF" }`（auto→ON，manual→OFF） |
| `set_thresholds` | `humidity` | `{ "up": upper, "down": lower }` |
| `set_security_config` | `securityConfig` | `{ "flameTrip", "flameClear", "alarmEnabled" }` |
| `acknowledge_alarm` | `acknowledgeAlarm` | `{}` |
| `mock_alarm` / 其它 action | — | 不发送云命令，返回 `rejected / UNSUPPORTED_CAPABILITY` |

请求体示例：

```json
{
  "service_id": "control",
  "command_name": "humidity",
  "paras": { "up": 40, "down": 30 }
}
```

同步命令响应映射：

- 平台 `command_id` → `result.platformCommandId`；
- 设备 `response.result_code` → `result.platformResultCode`；`0` → `applied`，
  非 `0` → `rejected`，`errorCode` 优先取 `response.paras.errorCode`，否则 `HARDWARE_ERROR`；
- `response.paras.saved` / `configRevision` / 最终阈值 / `mode` 等存在时映射进
  `result.saved`、`result.configRevision`、`result.params`；
- `result.saved=true` 必须有设备回执证据（`saved` 显式值、`configRevision` 或最终值），
  `result_code=0` 本身不推断“已落盘”；也**不会**把命令下发前的旧影子值当成保存成功证据；
- 没有 `response`（设备未回执/离线/平台超时）→ `status:"unknown", errorCode:"TIMEOUT"`，
  不伪造 applied；`response` 存在但缺少 `result_code` → `rejected / HARDWARE_ERROR`。

`expectedRevision`：provider 先读当前影子 `reported.properties.configRevision` 再比对；
不一致 → 直接 `rejected / REVISION_CONFLICT`，**不发送云命令**。影子缺失/没有
`configRevision` 时同样按 `REVISION_CONFLICT` 拒绝（无法确认版本）。HTTP 提交阶段仍是
`202`，冲突通过轮询结果表达，符合上文的异步契约。

### 失败语义

| 场景 | 结果 |
| --- | --- |
| 缺少应用侧字段 | health `configured:false`；state 501 `NOT_IMPLEMENTED`；命令 202→rejected `NOT_IMPLEMENTED`；零网络请求 |
| IAM 401 / 业务 401 | 刷新 token 重试一次；仍 401 → `PROVIDER_UNAVAILABLE` |
| 403（IAM 权限/IoTDA 未授权） | `PROVIDER_UNAVAILABLE` |
| 设备/命令 404 | `getState` 503 `DEVICE_OFFLINE`；命令 rejected `DEVICE_OFFLINE` |
| 影子 404（设备存在） | `getState` 仍返回 RawState（online 按设备详情，quality=error） |
| 429 | 命令 rejected `BUSY`（`getState` 由 HTTP 层归为 503 `PROVIDER_UNAVAILABLE`） |
| 5xx / 网络错误 / 请求超时 | `PROVIDER_UNAVAILABLE`，不伪造 applied |
| 设备 `result_code != 0` | rejected，保留平台与设备错误码/消息 |

### TLS 说明

`huawei.verifyTls` 默认 `true`。Node 内置 `fetch` 不直接接受 `https.Agent`，因此
`verifyTls:false` 在默认实现下**不会真正关闭证书校验**（health 的 note 会提示）。本机确实
需要跳过校验时，可通过 `createHuaweiProvider(config, { dispatcher })` 注入 undici dispatcher，
或在**仅本机**临时设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`（有中间人风险，不要用于公网）。
无论哪种方式，都不要把证书/密码/私钥写进仓库。

### 离线测试

```bash
node gateway/tests/huawei.test.js
```

测试通过 `createHuaweiProvider(config, { fetchImpl, now })` 注入假 fetch 和固定时钟，
不读取 `config/local.json`、不访问真实华为云；所有请求都断言只发往 `*.example.test`。
覆盖：缺配置降级、IAM 登录取 token/请求头/缓存、设备+影子映射、离线/影子缺失容错、
命令请求体与 command_id/result_code 映射、expectedRevision 本地拒绝、401 刷新重试、
429/404/5xx/网络/超时映射。测试中的 `test-password` 等均为假值。

## 日志与安全

- 请求日志只包含：HTTP 方法、路径（不含 query/body）、状态码、`requestId`，例如：
  `POST /api/v1/devices/mock-farm-001/commands 202 requestId=set_thresholds-abc123`。
- 不打印请求体、Wi-Fi 密码、云凭据；`huawei` provider 自身不写日志，错误信息只包含字段名、
  HTTP 状态码和上游 `error_code`/`error_msg`，不拼接 token/password。
- 默认只监听 `127.0.0.1`。CORS 为 `*` 且没有鉴权，**不要直接暴露到公网**；真机联调只在可信局域网使用。
- 不把 `config/local.json` 或真实凭据提交到仓库；`config/local.example.json` 只保留占位符。

## 测试

```bash
node gateway/tests/smoke.js
node gateway/tests/huawei.test.js
# 或 cd gateway && npm test   # 依次运行两个离线测试
```

`smoke.js` 使用纯 Node（`node:assert` + `node:http`），启动真实 HTTP server 到端口 0，覆盖：

1. health 200 且 `provider=mock`；
2. state 200，包含 `sensor` / `config` / `capabilities`，`receivedAt` 由服务器写入；
3. CORS 预检 204；
4. 非法 action：网关静态校验返回 **400 / `UNSUPPORTED_CAPABILITY`**（不入队）；
4b. 阈值越界：网关静态校验返回 **400 / `INVALID_THRESHOLD_RANGE`**；
5. 保存阈值 `{lower:30, upper:40}` → 202，轮询 applied、`saved=true`、revision 增长；
6. 同一 requestId 重复 POST → 终态一致、appliedAt 不变、revision 不变；
7. expectedRevision 冲突 → rejected / `REVISION_CONFLICT`，设备配置不变；
8. 未知设备 404 / `DEVICE_OFFLINE`；
9. 未知 requestId 404 / `STALE_COMMAND`；
10. 畸形 JSON 400、超过 32KB 413、requestId 缺失 400；
11. `huawei` 未配置：health `configured:false`，state 501，命令 202→rejected / `NOT_IMPLEMENTED`；
    `local` 骨架：health `configured:false`，state / command 501。

全部通过后打印：

```text
SMOKE OK
```

并返回退出码 0；失败打印断言细节并以非 0 退出。

`huawei.test.js` 是纯离线单测：注入假 fetch 与固定时钟，不读取 `config/local.json`、不访问
真实华为云。覆盖缺配置降级、IAM 登录取 token 与请求头/缓存、设备+影子映射、离线/影子缺失、
命令请求体、command_id/result_code 映射、expectedRevision 本地拒绝、401 刷新重试，以及
429/404/5xx/网络/超时错误映射。通过后打印 `HUAWEI OK (8 groups)` 并返回 0。

> 关于第 5 项：mock-device 的出厂阈值恰好是 30/40，而 `set_thresholds` 在值未改变时不会增加
> `configRevision`。为了让“30/40 的保存确实有变化”，测试先保存 35/45 作为基线，再执行要求的
> 30/40 保存，并验证 revision 继续增长。这是 mock 语义而不是测试绕过。

## 已知限制

- `local` 仍是骨架，不能控制真实设备。`huawei` 只实现应用侧 HTTPS API（轮询设备详情/影子、
  同步命令），没有实现设备侧 MQTT 订阅、属性主动推送和平台命令状态轮询。
- `huawei` 的 IAM token 只缓存在进程内，重启后重新鉴权；没有跨进程/文件缓存。
- `huawei` 的 `saved=true` 依赖设备在命令响应里回传 `saved`/`configRevision`/最终值；
  设备不回传时按 `saved=false` 处理，避免把“命令已执行”误报成“已保存”。
- `verifyTls:false` 在 Node 内置 `fetch` 下不会自动关闭证书校验，需要注入 dispatcher 或
  临时环境变量，详见“TLS 说明”。
- 无数据库/文件持久化：命令记录、mock 配置、启动信息都在内存，重启即清空。
- 无鉴权、无 TLS、CORS `*`，只适合本机/可信局域网联调。
- 单设备注册；多设备、设备分组、真实 ACK 重试均未实现。
- 无外部依赖，因此没有引入 MQTT 客户端；`local` 的后续实现需要自行决定最小客户端或可选依赖。
- `expectedRevision` 冲突通过异步命令结果表达，而不是 HTTP POST 直接返回 409；这是为了保持
  “202 表示已接收、轮询得到设备结果”的契约。
