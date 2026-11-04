# UI 设计规范（UI-UX Pro Max 生成）

生成日期：2026-11-04。
设计系统来源：`ui-ux-pro-max` skill，命令：

```bash
python "<skills>/ui-ux-pro-max/scripts/search.py" \
  "agriculture farm tech monitoring mobile app organic biophilic light natural data" \
  --design-system --persist -p "Smart Farm" --output-dir "<repo>/wechat/smart_farm"
```

- 持久化 Master：[design-system/smart-farm/MASTER.md](../design-system/smart-farm/MASTER.md)
- 命中的产品类型：**Agriculture/Farm Tech**（colors.csv）
- 风格：**Organic Biophilic**（styles.csv）
- 补充查询：`--domain ux "mobile dashboard touch feedback loading disabled states"`、
  `--domain web "touch target safe area accessibilityLabel mobile"`
- 交付前参考：skill 的 `references/pro-rules.md`（App/移动端专用清单）

> 本文件是**小程序实现口径**；与 MASTER.md 冲突时以本文件的适配说明为准（原因见 §6）。

---

## 1. 设计方向

- 产品：农业物联网移动端监控/控制，户外白天使用为主 → **light-first**，本轮不做深色主题（TODO）。
- 风格：Organic Biophilic —— 自然绿、柔和圆角（32–48rpx）、自然阴影、克制留白；数据页保持卡片节奏。
- 气质：平静、可靠、田间工具感；**禁止** AI 紫粉渐变、emoji 当图标、玻璃拟态/AI 光效。
- 信息优先级：安全状态（报警/离线/过期）> 当前数据 > 控制操作 > 次要配置 > 技术细节。

## 2. Design Tokens（app.wxss 变量）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-primary` | `#15803D` | 主按钮、选中态、关键数字 |
| `--color-primary-strong` | `#166534` | 主按钮按下/强调文字 |
| `--color-on-primary` | `#FFFFFF` | 主色上的文字 |
| `--color-secondary` | `#22C55E` | 正常状态点、图表/进度填充 |
| `--color-accent` | `#A16207`（harvest gold） | 警告、阈值标记、模拟标识 |
| `--color-background` | `#F0FDF4` | 页面背景 |
| `--color-surface` | `#FFFFFF` | 卡片/输入背景 |
| `--color-foreground` | `#14532D` | 主文字 |
| `--color-muted` | `#E8F0F1` | 弱背景、chip、轨道 |
| `--color-muted-foreground` | `#64748B` | 次要文字（白底对比度 ≈4.7:1） |
| `--color-border` | `#BBF7D0` | 卡片/输入边框、分隔线 |
| `--color-destructive` | `#DC2626` | 报警、错误、危险操作 |
| `--color-warn-bg` | `#FEF3C7` | 警告 banner 背景 |
| `--color-danger-bg` | `#FEE2E2` | 错误/报警 banner 背景 |

**尺度**：750rpx 设计宽度，1px ≈ 2rpx。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--space-1` … `--space-6` | 8 / 16 / 24 / 32 / 48 / 64 rpx | 4/8dp 节奏（rpx 版） |
| `--radius-sm` | 16rpx | chip、小元素 |
| `--radius-md` | 32rpx | 卡片、输入、按钮 |
| `--radius-lg` | 48rpx | hero 卡 |
| `--radius-pill` | 999rpx | 状态 pill |
| `--shadow-sm` | `0 2rpx 8rpx rgba(20,83,45,.06)` | 输入/小元素 |
| `--shadow-md` | `0 8rpx 24rpx rgba(20,83,45,.08)` | 卡片 |
| `--shadow-lg` | `0 16rpx 40rpx rgba(20,83,45,.10)` | hero / 浮层 |
| `--motion-fast` | 160ms ease-out | 按压/颜色 |
| `--motion-base` | 220ms ease-out | 状态切换 |

**字体**：
- 不加载 Lora/Raleway（小程序网络字体与包体限制、中文回退不稳），改用系统字体栈：
  `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`。
- 字号：display 72rpx / 44rpx；title 34rpx；body 28rpx；caption 24rpx；micro 22rpx；行高 1.5。
- 数字/技术值：`font-variant-numeric: tabular-nums`，避免宽度跳动；大数字 700 字重。

**动效**：
- 只做颜色/透明度/阴影过渡（160–220ms）；不做位移动画、不做布局位移。
- 按压反馈用 `hover-class`（opacity 0.9 或背景加深），不做 scale。
- 不使用装饰性动画；进度/状态变化即时可读。

**图标**：
- 不引入图标库、不用 emoji 当结构图标。
- 用**文本 + 状态点 + 形状**表达：状态点 `.dot`、进度条 `.bar`、chevron 用纯文本 “›”。

## 3. 组件规范（app.wxss + 页面 wxss）

| 组件 | 规范 |
| --- | --- |
| 页面 | `.page`：padding 32rpx；底部 `padding-bottom: calc(48rpx + env(safe-area-inset-bottom))`；背景 `--color-background` |
| hero 卡 | 渐变 `linear-gradient(135deg,#DCFCE7 0%,#F0FDF4 55%,#FFFFFF 100%)`；1rpx border；48rpx 圆角；`--shadow-lg`；可含径向柔光伪元素（不抢内容） |
| 数据卡 | 白底、32rpx 圆角、32rpx 内边距、`--shadow-md`；大数字 72rpx/700 + 24rpx muted 单位 |
| 状态点 | 14rpx 圆点 + 文案；ok=#22C55E、warn=#A16207、danger=#DC2626、muted=#64748B；**颜色不是唯一指示** |
| chip | 高 44rpx、padding 0 18rpx、pill、`--color-muted` 背景、22rpx 文字；危险 chip 用 `--color-danger-bg`+destructive 文字 |
| banner | ok `#DCFCE7/#166534`；warn `#FEF3C7/#8A5300`；danger `#FEE2E2/#B3261E`；32rpx 圆角；16/24rpx padding |
| 主按钮 | 全宽或自适应，高 **88rpx**（≥44pt），32rpx 圆角，primary 背景，白字 30rpx/600；按下 hover 深色；disabled：opacity .45 + 不可点 |
| 次按钮 | 白底 + 2rpx primary 边框 + primary 文字 |
| 危险按钮 | 仅“确认解除/重置”等操作：#DC2626 背景白字，或白底 danger 边框 |
| 输入 | 高 88rpx，radius 20rpx，2rpx border；focus 边框 primary + 3rpx ring `rgba(21,128,61,.15)`；label 必须可见；hint 24rpx muted；错误 24rpx destructive，**在字段下方** |
| switch 行 | 整行可点、高 ≥96rpx；标题 + 状态说明；系统 switch `color="#15803D"`；命令中 disabled |
| 进度 stepper | 竖线 2rpx border 色，节点 20rpx 圆点；完成 secondary、当前 primary、未开始 border；右侧文字 + 可选 detail 24rpx muted |
| 进度条 | 轨道 12rpx muted，填充 2rpx 渐变 `#22C55E→#15803D`；阈值标记 2rpx `--color-accent` |
| 代码块 | 背景 `#14532D`、文字 `#DCFCE7`、radius 24rpx、padding 24rpx、等宽字体、横向 `scroll-view` 包裹 |
| mock 区 | 虚线 2rpx border，背景 `#F8FAFC`，顶部 chip “仅模拟环境” |

**实现备注（微信小程序特有限制）**：原生 utton 默认宽度约 184px，width: 100% 需要加 !important 才能整行铺满；tn-mini 用于需要小尺寸的按钮并显式 width: auto !important。\n\n## 4. 页面布局方案

### dashboard（总览）
1. hero 卡：文字在上（设备名 + 在线状态点 + 数据年龄），刷新按钮放在卡片最底部（宽度撑满、44pt 高；报警时改用 danger 边框）。
2. 主数据区：湿度大数字 + 单位；次列温度卡；sensorKind 与质量说明。
3. 控制卡：风扇 switch 行 + 自动模式 switch 行（各附状态说明，失败原因就地展示）。
4. 快捷入口：2×2 网格（配网 / 设置 / 安防 / 诊断），每格高 ≥120rpx，主标签 + 一行说明。
5. 最近回执行：mono 小字 + 状态 chip。
6. 报警激活：顶部替换为 danger hero（大标题“火焰报警中”+ 已停止输出说明 + 前往安防）。

### provisioning（配网）
1. 说明卡 + 平台能力 banner（iPhone/无 NFC 用 warn）。
2. 表单卡：SSID、密码；字段级错误；密码不回显。
3. 主操作：写入标签（primary）+ 取消（ghost）。
4. 步骤卡：stepper 展示 prepare→adapter→discovery→connect→write→verify→cleanup。
5. 结果卡：成功用 ok banner + 摘要 chips（tnf/type/id 长度/payload 长度/总字节）+ mock 警示；失败用 danger banner + error.message + hint。

### settings（阈值设置）
1. 设备已确认卡：上下限双列大数字、revision 与更新时间 chips、配置状态 chip。
2. 草稿卡：两个 number 输入并排；字段提示“0–100 整数，下限<上限”；错误就地；“保存到设备”primary；“撤销修改”ghost；保存中 disabled。
3. 火焰阈值卡：两个输入 + 说明（触发>解除）+ 保存（secondary）；未配置时整块禁用并说明。
4. 提示：冲突时 warn banner + “刷新后重试”按钮。

### security（安防）
1. 风险 hero：正常=green；报警=danger；显示状态文字 + 时间 + “已停止灌溉输出”。
2. 气体卡：三列 stat 小卡，未配置项显示“未配置”且弱化，不显示 0。
3. 火焰卡：原始值大数字 + 进度条（0–4095）+ 阈值标记 + 质量说明。
4. 电机卡：方向 chip + 说明（无反馈时标“驱动目标状态”）。
5. 报警操作：canAcknowledge 时“确认解除报警”（danger/secondary 视状态），否则禁用并说明“报警仍未解除”。
6. mock 区：虚线卡，“模拟火焰报警 / 模拟满足解除条件”两个按钮 + “仅模拟”chip。

### diagnostics（诊断）
1. 环境卡：mode picker + baseUrl/deviceId 输入 + 保存/重置；重置需 `wx.showModal` 二次确认。
2. 连接卡：transport 名称/描述 + 健康检查按钮 + 结果（provider/version/bootId/uptime）。
3. 最近回执卡：action/requestId（截断 mono）/status/saved/revision chips；error.code 可复制展示。
4. 能力卡：代码块展示 capabilities。
5. mock 故障卡：offline/sensorError/nvWriteError/nvVerifyError 四个 switch 行 + 重置 mock 按钮。

## 5. 无障碍与交付检查清单

- [ ] 触控目标 ≥88rpx（44pt）；相邻可点元素间距 ≥16rpx。
- [ ] 所有按钮/开关有可见文字标签，不用纯图标按钮。
- [ ] 正文对比度 ≥4.5:1（#14532D on #FFFFFF/#F0FDF4；muted #64748B on white ≈4.7:1）。
- [ ] 状态同时用颜色 + 文案表达（在线/离线、报警中、未配置、过期）。
- [ ] 表单 label 可见、hint 与错误在字段附近；保存中 disabled + 进行中文案。
- [ ] 不使用 emoji 当图标；不使用图片图标（本轮）。
- [ ] 底部安全区：`env(safe-area-inset-bottom)`；滚动内容不被遮挡。
- [ ] 动效仅颜色/透明度/阴影，160–220ms；无布局位移。
- [ ] 375pt 小屏验证（开发者工具 iPhone 6/7/8），无横向滚动。
- [ ] 无 console 输出密码/完整 payload。
- [ ] 深色模式本轮不交付，已在 README/本文件记录 TODO（小程序 darkmode 需 theme.json 与逐页验证）。

## 6. 与 MASTER.md 的偏差（必须记录）

| MASTER 建议 | 本项目决定 | 原因 |
| --- | --- | --- |
| Heading Lora / Body Raleway | 系统字体栈 | 小程序加载 Google Fonts 不可靠、包体/中文回退成本高；数字用 tabular-nums 保留“数据感” |
| App Store Style Landing 页面结构 | 不采用 | 这是应用内 5 个功能页，不是落地页 |
| `cursor:pointer` / hover | `hover-class` 按压反馈 | 触屏无指针；按下反馈 80–150ms 内可感知 |
| SVG 图标库 | 文本 + 状态点 + 形状 | 小程序无内置 SVG 组件，避免引入图标库/字体；保持零依赖 |
| Dark mode（master 标注支持） | 本轮 light-only | 未做 theme.json 与逐页真实测试；后续再加 |
| 16–24px 圆角 | 32–48rpx（16–24px 等价） | rpx 换算 |
