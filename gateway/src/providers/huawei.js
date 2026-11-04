'use strict'

// 华为云 IoTDA provider（骨架，未实现）。
//
// 后续接入点：
// 1. 设备侧：真实设备通过 IoTDA MQTT 接入，至少需要
//    - 属性上报 topic（如 $oc/devices/{device_id}/sys/properties/report）→ 缓存为 RawState；
//    - 平台下行命令 topic（request_id 即平台的 command_id）→ 解析 action/params；
//    - 命令响应 topic（$oc/devices/{device_id}/sys/commands/response/request_id={request_id}）
//      → 回传 applied/rejected、errorCode、saved、configRevision。
// 2. 应用侧：使用 IoTDA 应用 API 创建设备命令，例如
//    POST /v5/iot/{project_id}/devices/{device_id}/commands；用返回的 command_id 查询命令状态。
//    认证凭据从本机环境/未提交的 config/local.json 读取，不写入代码或模板。
// 3. command_id ↔ requestId 映射：应用 API 创建命令时，把网关 requestId 写入命令的
//    service_id/command_name/paras 或本地映射表；设备回执中的 request_id/command_id 再映射回
//    requestId，供 GET /commands/{requestId} 返回。若平台生成新的 command_id，
//    需在“已下发命令”表中持久化 {requestId, command_id, deviceId, action}。
// 4. expectedRevision：下发给设备前与设备上报的 configRevision 比对，冲突时构造
//    status=rejected, errorCode=REVISION_CONFLICT 的命令结果；不要依赖云端偷偷重试。
// 5. getState：将 IoTDA 影子/属性上报归一化为 contract.md §2.1 RawState；
//    health：检查项目/设备凭据与连接状态；未配置时保持 configured:false。
//
// 当前阶段只提供健康信息，所有设备/命令调用都返回 501 NOT_IMPLEMENTED。

const PROVIDER = 'huawei'

function notImplemented(operation) {
  const err = new Error('华为云 IoTDA provider 尚未实现：' + operation)
  err.code = 'NOT_IMPLEMENTED'
  return Promise.reject(err)
}

function createHuaweiProvider() {
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
        note: '未配置华为云 IoTDA 实例；当前 huawei provider 仅为骨架，请先实现设备接入与凭据管理。'
      })
    }
  }
}

module.exports = {
  createHuaweiProvider
}
