'use strict'

// 本地 MQTT/Broker provider（骨架，未实现）。
//
// 后续接入点：
// 1. 连接：从本机环境或未提交的 config/local.json 读取 broker URL、用户名/密码（只在本机使用），
//    在 provider 初始化时建立 MQTT 客户端；因本项目要求零外部依赖，后续可在此注入一个
//    自实现的 client，或把 mqtt 包作为“本地联调可选依赖”并保持 mock 默认路径不受影响。
// 2. 状态：订阅 smartfarm/{deviceId}/state（主题名以实现时冻结的协议为准），把 JSON
//    归一化为 RawState 并缓存；getState 返回缓存 + 服务器 receivedAt，断连时健康状态转为 false。
// 3. 命令：POST 对应 publish 到 smartfarm/{deviceId}/command，消息包含 requestId、action、
//    params、expectedRevision；requestId 同时写入 MQTT 消息属性或 payload 的 correlationId。
// 4. 回执：订阅 smartfarm/{deviceId}/command-result（或 command/{requestId}/result），
//    将设备回执映射为 CommandResult，并由 commandStore 轮询。commandStore 已负责串行执行与
//    幂等，本地适配层只负责传输与超时。
// 5. 安全：不要打印/提交 broker 密码；health 未配置时保持 configured:false。
//
// 当前阶段只提供健康信息，所有设备/命令调用都返回 501 NOT_IMPLEMENTED。

const PROVIDER = 'local'

function notImplemented(operation) {
  const err = new Error('本地 MQTT provider 尚未实现：' + operation)
  err.code = 'NOT_IMPLEMENTED'
  return Promise.reject(err)
}

function createLocalProvider() {
  return {
    provider: PROVIDER,
    implemented: false,
    getState: function () {
      return notImplemented('getState')
    },
    sendCommand: function () {
      return notImplemented('sendCommand')
    },
    health: function () {
      return Promise.resolve({
        ok: false,
        provider: PROVIDER,
        configured: false,
        note: '未配置本地 MQTT broker；当前 local provider 仅为骨架，设备/命令接口不可用。'
      })
    }
  }
}

module.exports = {
  createLocalProvider
}
