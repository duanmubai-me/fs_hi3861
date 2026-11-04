# smart_farm 小程序（mock 优先开发版）

智慧农业课程项目的小程序端。当前阶段：**无 AppID、无云实例、无实物**，因此默认使用应用内模拟设备（mock），
把 5 项必选功能与 3 项可选功能的界面/交互/错误路径全部跑通；接入真实环境时切换 gateway 模式。

## 快速开始

1. 微信开发者工具 → 导入项目，目录选本文件夹（`wechat/smart_farm`）。
2. AppID 处选择“测试号/游客模式”，或替换 `project.config.json` 里的 `appid` 为你自己的开发身份。
   真机预览、NFC 需要自己的开发身份与登录；**不要**复用老师示例的 AppID。
3. 首页默认 `mock` 模式：所有数据来自应用内模拟设备，不需要后端、不需要联网。

## 两种运行模式

| 模式 | 用途 | 数据来源 |
| --- | --- | --- |
| `mock`（默认） | 页面/交互/失败路径开发与演示 | `services/mock-device.js`（应用内模拟） |
| `gateway` | 联调本机应用服务 | 仓库根目录 `gateway/`（默认 `http://127.0.0.1:8080`） |

在「总览 → 诊断」页可切换模式、填 baseUrl/deviceId，并做健康检查、故障注入、重置 mock。

启动应用服务：

```bash
node gateway/src/index.js
# 默认 http://127.0.0.1:8080，provider=mock
```

真机访问时 `baseUrl` 填电脑局域网 IP，不能填 `127.0.0.1`；开发者工具里可关闭“校验合法域名”。

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

- 没有 AppID/登录：只能开发者工具内运行；NFC 真机与真机网络需开发者身份。
- 已在微信开发者工具用 miniprogram-automator 跑通 mock 模式的 13 项 UI 冒烟（页面渲染、刷新、风扇开关、阈值保存、模拟报警/解除、NFC 模拟写入、健康检查、无 console 异常），截图见 `tests/ui/artifacts/`；真机仍未验证。
- NFC 实机适配未验证：记录格式按既定基线实现（单 record、TNF=2、type=`t`、时间戳 id、JSON、str2ab），
  mock 模式只验证记录构造与流程，不代表板端可读。
- 云端：`huawei`/`local` provider 仅有骨架，等团队冻结协议与实例后再接。
- 密码/云凭据不入 Git；`config/local.example.js` 仅模板。
