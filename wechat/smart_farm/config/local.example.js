// config/local.example.js
// 仅作说明模板：把需要的真实值抄到「本地」配置（不要提交真实值）。
// 当前版本不直接 require 本文件，运行参数由 config/index.js 的默认值 + 开发者工具
// 「诊断」页保存到本机 Storage 的覆盖值组成。
module.exports = {
  // mock：应用内模拟设备（默认，无需后端）
  // gateway：本机应用服务（仓库根目录 gateway/，默认 http://127.0.0.1:8080）
  mode: 'gateway',

  // 只填脱敏/局域网地址；不要填公网长期凭据
  baseUrl: 'http://192.168.1.10:8080',

  // 与设备侧/应用服务约定的设备 ID
  deviceId: 'farm-001',

  // 轮询与过期（毫秒）。云主线建议 5000 / 90000，最终以团队协议冻结值为准。
  pollIntervalMs: 5000,
  staleAfterMs: 90000,
  commandTimeoutMs: 9000
}
