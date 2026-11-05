// 新电脑首次使用时复制为 config/local.js，填写本人授权的华为云课程测试账号。
// local.js 已被 Git 忽略。直连模式会把账号打包到测试小程序中。
module.exports = {
  huawei: {
    iamEndpoint: 'iam.cn-north-4.myhuaweicloud.com',
    iamDomain: '', iamUserName: '', iamPassword: '',
    projectId: '', projectName: 'cn-north-4',
    // 填 IoTDA 实例的应用侧 HTTPS 地址，不是设备侧 MQTT 域名。
    iotdaEndpoint: '', deviceId: ''
  }
}
