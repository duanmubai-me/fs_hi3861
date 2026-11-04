#!/usr/bin/env node
/**
 * 检查构建生成的 normal NV 镜像是否包含 Smart Farm 的 0xA0/0xA1（长度 64）。
 *
 * 用法（在 R:\src 构建之后）：
 *   node sdk-patches/nv-config-store/check-hnv.js
 *   node sdk-patches/nv-config-store/check-hnv.js --hnv "R:\src\build\build_tmp\nv\xxx_normal.hnv"
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const HERE = __dirname
const REPO = path.resolve(HERE, '..', '..')
const DEFAULT_HNV_DIRS = [
  'R:/src/device/hisilicon/hispark_pegasus/sdk_liteos/build/build_tmp/nv',
  'R:/src/device/hisilicon/hispark_pegasus/sdk_liteos/tools/nvtool/out_nv_bin/sta/nv/hnv',
  'R:/src/build/build_tmp/nv'
]

function getArg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function findNormalHnv() {
  const explicit = getArg('--hnv')
  if (explicit) return [explicit]
  const found = []
  for (const dir of DEFAULT_HNV_DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (/normal\.hnv$/i.test(name)) found.push(path.join(dir, name))
    }
  }
  return found
}

function parseIndex(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 32) return null
  const magic = buf.readUInt32LE(0)
  // HNV_MAGIC = 0x24564E48 ("HNV$" little endian)；不同 SDK 版本头部字段可能微调，
  // 这里以 total_num 与索引区反推，不再强依赖 magic。
  const totalNum = buf.readUInt16LE(10)
  if (!totalNum || totalNum > 1024) return null
  const items = []
  for (let i = 0; i < totalNum; i += 1) {
    const off = 32 + i * 4
    if (off + 4 > buf.length) break
    items.push({
      id: buf.readUInt8(off),
      len: buf.readUInt8(off + 1),
      offset: buf.readUInt16LE(off + 2)
    })
  }
  return { magic: magic.toString(16), totalNum, items }
}

let ok = false
const files = findNormalHnv()
if (files.length === 0) {
  console.error('未找到 *_normal.hnv；请先在 R:\\src 执行 hb build -f（或使用 --hnv 指定路径）')
  process.exit(1)
}
for (const file of files) {
  const parsed = parseIndex(file)
  if (!parsed) {
    console.log('[skip] 无法解析（可能是 factory 或旧格式）：' + file)
    continue
  }
  const a = parsed.items.filter((it) => it.id === 0xa0)[0]
  const b = parsed.items.filter((it) => it.id === 0xa1)[0]
  console.log(
    file + '  items=' + parsed.totalNum + ' | 0xA0=' + (a ? 'len ' + a.len : '缺失') + ' | 0xA1=' + (b ? 'len ' + b.len : '缺失')
  )
  if (a && b && a.len === 64 && b.len === 64) ok = true
}
if (!ok) {
  console.error('检查失败：normal NV 镜像中没有 0xA0/0xA1 且长度 64 的项')
  process.exit(1)
}
console.log('NV 检查通过：0xA0/0xA1 len=64 已包含在 normal NV 镜像中')
