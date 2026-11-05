# smart_farm 小程序（华为云直连测试版）

智慧农业课程项目的小程序端。2026-11-05 起默认 `gateway`，该模式现表示 **小程序通过 HTTPS 直接访问华为云 IAM 和 IoTDA**，不再经过电脑后端。`mock` 保留为主动选择的模拟演示模式。真实可用功能取决于板端已实现的上报和命令，不以界面存在作为完成依据。

## 快速开始

1. 微信开发者工具 → 导入项目，目录选本文件夹（`wechat/smart_farm`）。
2. 使用自己的测试号或小程序 AppID 登录。当前 AppID 已配置，勿复用老师示例身份。
3. 新电脑首次使用：将 `config/local.example.js` 复制为 `config/local.js`，填写本人获授权的华为云配置；真实文件已被 Git 忽略。当前电脑已按用户指定的工作区根目录 `app.js` 导入。
4. 编译后默认直连华为云；在“总览 → 诊断”查看状态，地址填写 IoTDA **应用侧 HTTPS** 域名，不能填写电脑 IP 或 MQTT 地址。IAM 域名独立来自本机配置。
5. 手机测试需要允许访问对应 HTTPS 域名。合法域名、证书和手机调试设置按微信实际运行环境配置。

## 两种运行模式

| 模式 | 用途 | 数据来源 |
| --- | --- | --- |
| `mock` | 页面/交互/失败路径开发与演示 | `services/mock-device.js`（应用内模拟） |
| `gateway`（默认） | 无电脑后端的华为云直连 | `services/transport-huawei.js` + `services/huawei-client.js` |

在「总览 → 诊断」页可切换模式、填 baseUrl/deviceId，并做健康检查、故障注入、重置 mock。

旧的 `gateway/` 后端和 `transport-gateway.js` 文件保留供独立测试/参考，目前小程序的模式选择不再调用它们。旧 Storage 中的 localhost 配置会迁移一次，主动选择 mock 后会保留选择。NFC 在支持的安卓真机上直接写标签，不经过云端；记录格式维持老师示例。

## 页面

- `pages/dashboard` 总览：在线/数据年龄、温湿度、风扇/自动开关、告警 banner、快捷入口
- `pages/provisioning` 配网：NFC 写标签（按既定 example-nfc-v1 记录），mock 下模拟写入并展示字节布局
- `pages/settings` 设置：湿度上下限、火焰阈值、草稿/已确认值、`saved` 与 revision
- `pages/security` 安防：eCO₂/TVOC/可燃气体、火焰原始值与报警、电机方向、确认解除
- `pages/diagnostics` 诊断：环境切换、健康检查、最近回执、能力位、mock 故障注入

## 目录

```text
app.js/json/wxss  project.config.json  sitemap.json
config/   index.js（运行时环境）、local.example.js（脱敏模板）
utils/    time units id nfc-codec
models/   errors（错误码/文案）、state（原始状态→视图模型）
services/ mock-device（纯逻辑模拟设备）、transport-mock/-gateway、transport、device、nfc
pages/    五个页面（四件套）
docs/     contract.md（页面/服务/网关契约）
```

## 测试

在 Team 仓库根 `fs_hi3861/` 下执行（或任意 cwd，runner 按自身位置解析）：

```bash
node tests/run-all.js
```

覆盖小程序纯逻辑（NFC 记录、状态归一化、mock 设备事务/幂等/报警/自动控制）、回归用例与网关 HTTP 冒烟。

真机模拟器 UI 冒烟（需微信开发者工具已登录、已开启「设置 → 安全设置 → 服务端口」）：

```bash
node tests/ui/smoke.js
```

会在 mock 模式下逐页检查渲染与关键交互并截图到 `tests/ui/artifacts/`。

## UI 设计

- 设计系统：[design-system/smart-farm/MASTER.md](design-system/smart-farm/MASTER.md)（UI-UX Pro Max：Agriculture/Farm Tech × Organic Biophilic，light-first）。
- 小程序实现口径：[docs/ui-spec.md](docs/ui-spec.md)（tokens、组件、五个页面布局、无障碍清单）。
- tabBar 图标由 [tools/gen-tabbar-icons.py](tools/gen-tabbar-icons.py) 用 Pillow 生成（81×81 PNG，普通 `#64748B` / 选中 `#15803D`）。
- 本阶段 light-only；深色模式需补 `theme.json` 与逐页验证，列为 TODO。

## 已知限制

- 当前已使用用户测试号编译；真机 NFC 仍需安卓设备和标签现场验证。
- 已在微信开发者工具用 miniprogram-automator 跑通 mock 模式的 13 项 UI 冒烟（页面渲染、刷新、风扇开关、阈值保存、模拟报警/解除、NFC 模拟写入、健康检查、无 console 异常），截图见 `tests/ui/artifacts/`；真机仍未验证。
- NFC 实机适配未验证：记录格式按既定基线实现（单 record、TNF=2、type=`t`、时间戳 id、JSON、str2ab），
  mock 模式只验证记录构造与流程，不代表板端可读。
- 华为云直连已通过 IAM、设备与影子只读查询；设备当时离线，不能据此声称真实控制已通过。固件基础字段兼容，新增 gas/flame/configRevision 仍需板端上报。
- 旧固件缺少 revision 时基础命令允许兼容；真实 `saved:true` 必须由设备明确回复，不能由阈值回显推断。扩展报警命令在能力未上报前禁止下发。
- 火焰 DO 是数字触发信号，不能假冒模拟强度；本客户端支持 `flameDetected` 与有效标志。数字检测不开放模拟阈值编辑。
- 密码/云凭据不入 Git、Storage 或日志；`config/local.example.js` 仅模板。用户要求的前端直连会将账号打包到测试小程序中。
- 详细板端修改步骤、完整发布函数和 Flash/协议对齐说明，见本工作区 `doc/22_小程序华为云直连与固件协议修改.md`。

## 本次验证（2026-11-05）

- `node tests/run-all.js`：9/9 组通过，其中直连离线测试 12 项。
- `node tests/ui/smoke.js`：13 项页面检查通过，使用模拟设备，无真实控制命令。
- 开发者工具内真实 `wx.request`：gateway 模式编译、IAM 鉴权、设备/影子查询与健康检查通过，无真实控制命令。
