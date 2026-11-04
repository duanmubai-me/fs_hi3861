#!/usr/bin/env node
/**
 * 给 Hi3861 SDK 注册 Smart Farm 配置 NV 项（0xA0/0xA1，各 64 字节）。
 *
 * 用法（在 Team 仓库根 fs_hi3861 下执行）：
 *   node sdk-patches/nv-config-store/apply.js            # 应用补丁
 *   node sdk-patches/nv-config-store/apply.js --revert   # 还原
 *   node sdk-patches/nv-config-store/apply.js --sdk "D:\path\to\sdk_liteos"
 *
 * 修改内容（仅两个 SDK 文件）：
 *   1. sdk_liteos/tools/nvtool/h_file/nv/nv_app_struct_def.txt
 *      追加 typedef struct smart_farm_config_nv { hi_u8 cfg_byte0..63; }
 *   2. sdk_liteos/tools/nvtool/xml_file/mss_nvi_db.xml
 *      追加 GROUP NAME="App"（ID=0x4），含 NV ID=0xA0/0xA1，
 *      PARAM_NAME=smart_farm_config_nv，长度 64，默认全 0。
 *
 * 注意：该脚本只改 SDK 的 NV 描述文件；构建时会由 nvtool 重新生成
 * build/build_tmp/nv/*_normal.hnv，使 hi_nv_write(0xA0/0xA1, ..., 64) 可用。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const HERE = __dirname
const DEFAULT_SDK =
  'E:/School_Meaningless_Projrct/hi3861_hdu_iot_application240515/src/device/hisilicon/hispark_pegasus/sdk_liteos'

function getArg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const SDK = getArg('--sdk') || process.env.SMART_FARM_SDK || DEFAULT_SDK
const REVERT = process.argv.indexOf('--revert') >= 0
const STRUCT_FILE = path.join(SDK, 'tools/nvtool/h_file/nv/nv_app_struct_def.txt')
const XML_FILE = path.join(SDK, 'tools/nvtool/xml_file/mss_nvi_db.xml')
const BACKUP_DIR = path.join(HERE, 'original')

function fail(msg) {
  console.error('[nv-config-store] ' + msg)
  process.exit(1)
}

if (!fs.existsSync(STRUCT_FILE) || !fs.existsSync(XML_FILE)) {
  fail('找不到 SDK NV 文件，请用 --sdk 指定 sdk_liteos 目录：' + SDK)
}

fs.mkdirSync(BACKUP_DIR, { recursive: true })

function backupOnce(src, name) {
  const dst = path.join(BACKUP_DIR, name)
  if (!fs.existsSync(dst)) {
    fs.copyFileSync(src, dst)
    console.log('已备份原始文件: ' + dst)
  }
}

function structBlock() {
  const lines = ['', '', '// ==== Smart Farm 应用配置（团队新增，NV 0xA0/0xA1，64 字节）====', 'typedef struct {']
  for (let i = 0; i < 64; i += 1) lines.push('    hi_u8 cfg_byte' + i + ';')
  lines.push('} smart_farm_config_nv;', '')
  return lines.join('\n')
}

function groupBlock() {
  const zeros = new Array(64).fill('0').join(', ')
  const mk = (id, name, desc) =>
    '    <NV ID="' + id + '" NAME="' + name + '" PARAM_NAME="smart_farm_config_nv" PARAM_VALUE="{' + zeros + '}" CATEGORY="APP" DEV="CCO-STA-NDM" DESCRIPTION="' + desc + '" />'
  return [
    '',
    '  <!-- Smart Farm 应用配置：A/B 两槽，64 字节；与 demo/smartFarm/services/config_store 对应 -->',
    '  <GROUP NAME="App" ID="0x4" FEATURE="1&lt;&lt;0,1&lt;&lt;4,1&lt;&lt;5" USEDMODE="0" PARAM_DEF_FILE="../nv/nv_app_struct_def.txt">',
    mk('0xA0', 'SMART_FARM_CONFIG_A', 'Smart Farm config slot A'),
    mk('0xA1', 'SMART_FARM_CONFIG_B', 'Smart Farm config slot B'),
    '  </GROUP>',
    ''
  ].join('\n')
}

if (REVERT) {
  const pairs = [
    [path.join(BACKUP_DIR, 'nv_app_struct_def.txt.orig'), STRUCT_FILE],
    [path.join(BACKUP_DIR, 'mss_nvi_db.xml.orig'), XML_FILE]
  ]
  for (const [src, dst] of pairs) {
    if (!fs.existsSync(src)) fail('缺少备份文件，无法还原: ' + src)
    fs.copyFileSync(src, dst)
    console.log('已还原: ' + dst)
  }
  process.exit(0)
}

backupOnce(STRUCT_FILE, 'nv_app_struct_def.txt.orig')
backupOnce(XML_FILE, 'mss_nvi_db.xml.orig')

let structText = fs.readFileSync(STRUCT_FILE, 'utf8')
if (structText.indexOf('smart_farm_config_nv') < 0) {
  fs.writeFileSync(STRUCT_FILE, structText.replace(/\s*$/, '\n') + structBlock(), 'utf8')
  console.log('已追加 struct smart_farm_config_nv 到 nv_app_struct_def.txt')
} else {
  console.log('nv_app_struct_def.txt 已包含 smart_farm_config_nv，跳过')
}

let xmlText = fs.readFileSync(XML_FILE, 'utf8')
if (xmlText.indexOf('SMART_FARM_CONFIG_A') < 0) {
  const closeTag = '</HISTUDIO>'
  const idx = xmlText.lastIndexOf(closeTag)
  if (idx < 0) fail('mss_nvi_db.xml 缺少 </HISTUDIO>，无法插入 GROUP')
  xmlText = xmlText.slice(0, idx) + groupBlock() + xmlText.slice(idx)
  fs.writeFileSync(XML_FILE, xmlText, 'utf8')
  console.log('已追加 GROUP App（NV 0xA0/0xA1）到 mss_nvi_db.xml')
} else {
  console.log('mss_nvi_db.xml 已包含 Smart Farm GROUP，跳过')
}

// 生成供人工审阅的片段（与写入内容一致）
fs.writeFileSync(path.join(HERE, 'nv_app_struct_def.snippet.txt'), structBlock(), 'utf8')
fs.writeFileSync(path.join(HERE, 'mss_nvi_db.group.snippet.xml'), groupBlock(), 'utf8')
console.log('补丁完成。重新构建后会生成带 0xA0/0xA1 的 normal NV 镜像。')
