# 新模块接入说明（手动步骤）

本仓库**没有修改任何拉取主线原有的文件**。下面全部是"你要在自己的工程里手动加"的步骤，
加起来大约 30 行代码，改完重新编译烧录即可。

涉及的新文件只有这些：

```
demo/smartFarm/include/smart_farm_config.h     功能开关 / 64 字节配置结构 / 默认值 / 周期
demo/smartFarm/include/smart_farm_state.h      全局运行状态（1 个结构体 + 读写函数）
demo/smartFarm/services/config_store.c/h       NV A/B 双槽 + CRC + 回读校验
demo/smartFarm/services/security_service.c/h   火焰阈值报警 + SGP30 气体
demo/smartFarm/services/motor_control.c/h      按键 GPIO14 控制正反转
demo/smartFarm/services/display_service.c/h    OLED 三页轮播
common/bsp/include/hal_bsp_motor.h             电机 BSP：PCF8574 方向位 + 两路 PWM
common/bsp/src/hal_bsp_motor.c
```

---

## 1. BUILD.gn：把新文件加进编译

`demo/smartFarm/BUILD.gn` 的 `sources` 里补上 4 个服务、电机 BSP，以及新用到的两个传感器驱动
（这两个驱动仓库里已经有，只是没被编进来）：

```gn
sources = [
    "smartFarm_demo.c",
    # ... 原有文件不动 ...

    "//vendor/hqyj/fs_hi3861/demo/smartFarm/services/config_store.c",
    "//vendor/hqyj/fs_hi3861/demo/smartFarm/services/security_service.c",
    "//vendor/hqyj/fs_hi3861/demo/smartFarm/services/motor_control.c",
    "//vendor/hqyj/fs_hi3861/demo/smartFarm/services/display_service.c",

    "//vendor/hqyj/fs_hi3861/common/bsp/src/hal_bsp_motor.c",
    "//vendor/hqyj/fs_hi3861/common/bsp/src/hal_bsp_ap3216c.c",
    "//vendor/hqyj/fs_hi3861/common/bsp/src/hal_bsp_sgp30.c",
]

include_dirs = [
    "./",
    "include",       # 新增：smart_farm_config.h / smart_farm_state.h
    "services",      # 新增：config_store.h / security_service.h / ...
    # ... 其余原有 include_dirs 不动 ...
]
```

> 注意：`hal_bsp_sgp30.c` 是老师原来的示例驱动，结尾少了 `return`，会有一条
> `-Wreturn-type` 警告，不影响功能，也不用为了它改主线文件。

---

## 2. smartFarm_demo.c：初始化 + 创建 3 个任务

在 `SF_peripheral_init()` 之后（此时 I2C、OLED、PCF8574 都初始化过了）调用新模块，
再按原有写法创建任务：

```c
#include "smart_farm_config.h"
#include "smart_farm_state.h"
#include "config_store.h"
#include "security_service.h"
#include "motor_control.h"
#include "display_service.h"

static void smart_farm_new_init(void)
{
    smart_farm_state_init();   /* 状态清零，quality = UNKNOWN */
    config_store_init();       /* 读 A/B 两槽，没有有效记录就用默认值 */
    security_service_init();   /* 探测火焰源(AP3216C)和 SGP30，关掉蜂鸣器/LED */
    motor_control_init();      /* CONFIG_MOTOR=0 时只打印"未启用" */
    display_service_init();    /* 初始化 OLED；失败只降级，不阻塞启动 */
}

/* 在 smartFarm_Project_example() 里，SF_peripheral_init() 和 mqtt_init() 之后： */
smart_farm_new_init();

options.name = "security_service_task";
options.stack_size = CONFIG_SECURITY_TASK_STACK;
options.priority = osPriorityAboveNormal;   /* 报警要快，优先级比其它任务高 */
security_task_id = osThreadNew((osThreadFunc_t)security_service_task, NULL, &options);

options.name = "motor_control_task";
options.stack_size = CONFIG_MOTOR_TASK_STACK;
options.priority = osPriorityNormal;
motor_task_id = osThreadNew((osThreadFunc_t)motor_control_task, NULL, &options);

options.name = "display_service_task";
options.stack_size = CONFIG_DISPLAY_TASK_STACK;
options.priority = osPriorityBelowNormal;   /* 刷屏最慢，别抢采集的 CPU */
display_task_id = osThreadNew((osThreadFunc_t)display_service_task, NULL, &options);
```

---

## 3. sensor_collect_task.c：把温湿度写进全局状态（1 行）

新模块不重复读 SHT20，直接复用主线已经采到的数据：

```c
SHT20_ReadData(&temperature, &humidity);
sys_msg_data.temperature = (int)temperature;
sys_msg_data.humidity = (int)humidity;
/* ↓ 新增这一行：农业页才显示得出温度/湿度；不加就显示 -- */
smart_farm_state_set_sensor((int16_t)temperature, (int16_t)humidity, SF_QUALITY_OK);
```

> 风扇的坑：主线每 100ms 会根据 `sys_msg_data.fanStatus` 重新 `set_fan()`，
> 所以火焰报警时本模块虽然调了 `set_fan(0)`，下一个周期主线可能又把风扇开回来。
> 想让"报警停风扇"一直有效，就把主线那段判断改成：
> `if (g_smart_farm_state.flame_alarm) { set_fan(0); } else { ...原来的逻辑... }`。
> 演示时更省事的办法：云端风扇命令发 OFF。

---

## 4. mqtt_recv_task.c：命令处理里调用新接口

都放在 `cJSON_Parse_Payload()` 已有的 `if (!strcmp(json_command_name->valuestring, ...))` 分支里：

```c
/* 湿度阈值：云端是整数百分比，本地存储是 0.1%，所以要乘 10 */
if (!strcmp(json_command_name->valuestring, "humidity")) {
    smart_farm_config_t cfg;
    cJSON *paras = cJSON_GetObjectItem(root, "paras");
    cJSON *up = cJSON_GetObjectItem(paras, "up");
    cJSON *down = cJSON_GetObjectItem(paras, "down");

    config_store_get(&cfg);
    if (down) { cfg.humidity_lower = (uint16_t)(down->valueint * 10); }
    if (up)   { cfg.humidity_upper = (uint16_t)(up->valueint * 10); }
    if (config_store_save(&cfg) != CONFIG_OK) {
        ret = 1;                    /* 保存失败：写 NV 失败或上下限关系不合法 */
    }
}

/* 电机：ON = 等价于短按一次（停止/正转/停止/反转），OFF = 立即停止 */
if (!strcmp(json_command_name->valuestring, "motor")) {
    cJSON *paras = cJSON_GetObjectItem(root, "paras");
    uint8_t value = 0;
    if (get_jsonData_value(paras, &value) == 0) {
        if (value != 0) { motor_control_next(); } else { motor_stop(); }
    }
}

/* 报警开关：cfg.alarm_enable = 1/0，同样走 config_store_save() */
```

> `config_store_save()` 内部是"写另一个槽 → 读回校验"，大约几十毫秒，
> 放在 MQTT 回调里可以接受（课程设计量级）；保存成功后 `configRevision` 会 +1，
> 安防任务下一轮就用到新阈值，不用重启。

---

## 5. 烧录后怎么确认接入成功

串口应依次看到（顺序可能交错）：

```
[config] 两个槽都没有有效配置，使用默认值（不写 Flash）
[security] 火焰数据源 = AP3216C 红外模拟：就绪
[security] 气体模块未配置（SGP30 无响应），气体页显示 --
[display] OLED 就绪：农业/气体/火焰 三页每 3000ms 轮播
[motor] CONFIG_MOTOR=0，电机功能未启用（接扩展板后把宏改成 1）
```

- 手靠近 AP3216C 到 `raw >= 2400`：蜂鸣器响、LED 亮，串口打印"火焰报警"；
  离开后掉到 `1600` 以下才解除（滞回）。
- 云端下发湿度命令：串口打印 `[config] 保存成功：槽B revision=1`，OLED 农业页 `CFG : #  1`。
- 想演示电机：把 `smart_farm_config.h` 里的 `CONFIG_MOTOR` 改成 1 重新编译，
  接好 H 桥扩展板后短按 K1 循环正转/反转，长按 1.5s 停止。

---

## 6. 已知限制（一句话版）

- 没有实物板卡，全部代码只做了 `-fsyntax-only` 语法检查，没上机跑过；
- I2C0 上挂了 OLED / SHT20 / AP3216C / SGP30 / PCF8574，靠"只有显示任务刷屏"来避免总线打架，
  没有做总线互斥；
- 火焰是 AP3216C 红外**模拟**，日光或强红外会误报，阈值要在现场标定；
- `hal_bsp_sgp30.c` 是老师示例，没有 CRC 校验和预热处理，读数是估算值。
