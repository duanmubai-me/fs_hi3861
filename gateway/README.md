# smart-farm-gateway

智慧农业课程项目的**本机应用服务**。默认使用 mock provider，直接复用小程序侧的
`wechat/smart_farm/services/mock-device.js`，用于在没有云实例、没有实物板子的阶段做 HTTP 联调。

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
| `provider` | `mock` | `mock` / `huawei` / `local` |
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
当前骨架 provider 不读取任何云凭据。

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

`huawei` / `local` 的 health 固定为 HTTP 200，并额外带 `configured: false` 和 `note`。
provider 已声明但未配置时 `ok` 为 `false`，不代表进程启动失败。

### 状态

`GET /api/v1/devices/{id}/state` 返回 `contract.md` §2.1 的 RawState。`receivedAt` 由 gateway
在返回前写成服务器当前毫秒数，不信任上游时钟。

未知设备返回 `404 {"error":{"code":"DEVICE_OFFLINE","message":"..."}}`。
mock 故障注入设置为 offline 时，设备仍是已知设备，接口会返回 200 且状态中的 `online: false`。

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
| 501 | `NOT_IMPLEMENTED` | `huawei` / `local` 的设备或命令接口 |
| 503 | `DEVICE_OFFLINE` / `PROVIDER_UNAVAILABLE` | provider 调用失败、上游不可用 |
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

### huawei / local（骨架）

- `src/providers/huawei.js`：health 返回 `ok:false / provider:huawei / configured:false / note`；
  `getState`、`sendCommand` 抛出 `NOT_IMPLEMENTED`，HTTP 层返回 501。
  文件内注释标出 IoTDA 设备侧属性/命令 topic、应用侧创建设备命令 API，
  以及平台 `command_id` ↔ 网关 `requestId` 的映射位置。
- `src/providers/local.js`：同上，注释标出本地 MQTT broker、状态订阅、命令 publish、
  回执订阅和 broker 凭据的适配位置。
- 当前 gateway 每个进程只注册 `config.deviceId` 一台设备；多设备需要在 registry 和 provider
  层扩展。

## 日志与安全

- 请求日志只包含：HTTP 方法、路径（不含 query/body）、状态码、`requestId`，例如：
  `POST /api/v1/devices/mock-farm-001/commands 202 requestId=set_thresholds-abc123`。
- 不打印请求体、Wi-Fi 密码、云凭据。
- 默认只监听 `127.0.0.1`。CORS 为 `*` 且没有鉴权，**不要直接暴露到公网**；真机联调只在可信局域网使用。
- 不把 `config/local.json` 或真实凭据提交到仓库。

## 冒烟测试

```bash
node gateway/tests/smoke.js
# 或 cd gateway && npm test
```

测试使用纯 Node（`node:assert` + `node:http`），启动真实 HTTP server 到端口 0，覆盖：

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
11. `huawei` / `local` health 显示 `configured:false`，state / command 返回 501。

全部通过后打印：

```text
SMOKE OK
```

并返回退出码 0；失败打印断言细节并以非 0 退出。

> 关于第 5 项：mock-device 的出厂阈值恰好是 30/40，而 `set_thresholds` 在值未改变时不会增加
> `configRevision`。为了让“30/40 的保存确实有变化”，测试先保存 35/45 作为基线，再执行要求的
> 30/40 保存，并验证 revision 继续增长。这是 mock 语义而不是测试绕过。

## 已知限制

- `huawei` / `local` 仅有骨架，不能控制真实设备；health 的 `configured` 为 `false`。
- 无数据库/文件持久化：命令记录、mock 配置、启动信息都在内存，重启即清空。
- 无鉴权、无 TLS、CORS `*`，只适合本机/可信局域网联调。
- 单设备注册；多设备、设备分组、云端影子同步、真实 ACK 重试均未实现。
- 无外部依赖，因此没有引入 MQTT 客户端；`local` 的后续实现需要自行决定最小客户端或可选依赖。
- `expectedRevision` 冲突通过异步命令结果表达，而不是 HTTP POST 直接返回 409；这是为了保持
  “202 表示已接收、轮询得到设备结果”的契约。
