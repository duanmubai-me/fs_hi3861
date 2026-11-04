'use strict'

// gateway 入口：读取配置 → 组装 provider/registry/命令存储 → 监听并打印真实地址。
// 直接运行：node gateway/src/index.js
// 环境变量：GATEWAY_HOST / GATEWAY_PORT / GATEWAY_PROVIDER

const api = require('./api')
const configModule = require('./config')
const { createMockProvider } = require('./providers/mock')
const { createHuaweiProvider } = require('./providers/huawei')
const { createLocalProvider } = require('./providers/local')

function createProvider(config) {
  if (config.provider === 'mock') {
    return createMockProvider({ deviceId: config.deviceId })
  }
  if (config.provider === 'huawei') {
    return createHuaweiProvider(config)
  }
  if (config.provider === 'local') {
    return createLocalProvider(config)
  }
  throw new Error('未知 provider：' + config.provider)
}

function formatAddress(server) {
  const address = server.address()
  if (!address || typeof address === 'string') return String(address || '')
  const host = address.family === 'IPv6' && address.address.indexOf(':') >= 0
    ? '[' + address.address + ']'
    : address.address
  return 'http://' + host + ':' + address.port
}

/**
 * 启动网关并返回实际监听地址。测试传入 port:0 即可使用随机端口。
 * @param {{config?:object, provider?:object, logger?:Function|false}} [options]
 * @returns {Promise<{server:import('node:http').Server, config:object, provider:object, url:string, address:object|string}>}
 */
function startGateway(options) {
  const opts = options || {}
  const config = opts.config || configModule.loadConfig()
  const provider = opts.provider || createProvider(config)
  const server = api.createServer({
    config: config,
    provider: provider,
    logger: opts.logger
  })

  return new Promise(function (resolve, reject) {
    function onError(err) {
      server.removeListener('listening', onListening)
      reject(err)
    }
    function onListening() {
      server.removeListener('error', onError)
      resolve({
        server: server,
        config: config,
        provider: provider,
        url: formatAddress(server),
        address: server.address()
      })
    }
    server.once('error', onError)
    server.once('listening', onListening)
    try {
      server.listen(config.port, config.host)
    } catch (err) {
      server.removeListener('error', onError)
      server.removeListener('listening', onListening)
      reject(err)
    }
  })
}

async function main() {
  try {
    const started = await startGateway()
    console.log(
      '[smart-farm-gateway] listening on ' + started.url +
      ' (provider=' + started.config.provider + ', deviceId=' + started.config.deviceId + ')'
    )
  } catch (err) {
    console.error('[smart-farm-gateway] failed to start: ' + (err && err.message ? err.message : String(err)))
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  createProvider,
  startGateway
}
