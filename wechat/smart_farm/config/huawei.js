// 华为云直连配置。真实账号保存在被 Git 忽略的 local.js，不放进 Storage 或日志。
const local = require('./local')

function getHuaweiConfig() {
  const input = local.huawei || local
  return {
    iamEndpoint: input.iamEndpoint || '',
    iamDomain: input.iamDomain || input.userName || '',
    iamUserName: input.iamUserName || '',
    iamPassword: input.iamPassword || input.iamUserPassword || '',
    projectId: input.projectId || input.project_id || '',
    projectName: input.projectName || input.productName || '',
    iotdaEndpoint: input.iotdaEndpoint || input.iotDAEndpoint || '',
    deviceId: input.deviceId || input.device_id || '',
    requestTimeoutMs: 25000
  }
}

function getPublicConfig() {
  const cloud = getHuaweiConfig()
  return {
    baseUrl: cloud.iotdaEndpoint ? 'https://' + cloud.iotdaEndpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '',
    deviceId: cloud.deviceId
  }
}

module.exports = { getHuaweiConfig, getPublicConfig }
