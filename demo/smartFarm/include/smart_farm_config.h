/*
 * Copyright (c) 2026 smartFarm device team
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * 智慧农业设备端“新增模块”的统一配置头文件。
 *
 * 为什么集中在一个文件里：
 * 1. 功能开关、NV 参数、默认阈值、任务周期、任务栈都是“能改的数字”，
 *    放一处，其他 .c 只引用宏，代码里看不到魔法数字；
 * 2. 用编译期宏做开关，没接的硬件干脆不编译进去，答辩时“改了哪个宏、
 *    少了哪个功能”一句话能讲清楚；
 * 3. 64 字节配置结构体就是 NV 上的一条记录，字段顺序固定，
 *    以后加字段只能用 reserved 的字节，并且要同时升版本号。
 *
 * 本文件不 include 主线的 sys_config.h，避免把云平台凭据带进新模块。
 */

#ifndef SMART_FARM_CONFIG_H
#define SMART_FARM_CONFIG_H

#include <stdint.h>

/* ==================== 1. 功能开关 ==================== */
/*
 * 1 = 编译并启用；0 = 整体关闭。
 * 关闭后对应的 init 只打印一行“未启用”就返回，任务里也不会做任何事。
 */
#define CONFIG_STORE 1    /* 阈值/模式保存到 NV（A/B 双槽） */
#define CONFIG_SECURITY 1 /* 安防服务总开关（火焰 + 气体） */
#define CONFIG_GAS 1      /* SGP30 eCO2/TVOC，板载没焊该芯片时可改成 0 */
#define CONFIG_FLAME 1    /* 火焰检测与报警 */
#define CONFIG_MOTOR 0    /* 电机：要外接 H 桥扩展板，答辩演示时改成 1 */
#define CONFIG_DISPLAY 1  /* OLED 三页轮播 */

/* ==================== 2. 火焰数据源 ==================== */
/*
 * 板载没有真正的火焰传感器，默认用 AP3216C 的红外通道“模拟”火焰：
 * 红外值越大表示越接近火源。这只能算课程演示，不是可靠的火焰判定，
 * OLED 上会显示 "SRC:IR-SIM" 提醒。
 * 如果外接了 AO 输出的火焰模块，把 CONFIG_FLAME_SOURCE 改成 ADC 即可。
 */
#define CONFIG_FLAME_SRC_NONE 0
#define CONFIG_FLAME_SRC_AP3216C 1
#define CONFIG_FLAME_SRC_ADC 2
#define CONFIG_FLAME_SOURCE CONFIG_FLAME_SRC_AP3216C
#define CONFIG_FLAME_ADC_CHANNEL 5 /* 外接火焰模块用的 ADC 通道（按实际接线改） */

/* ==================== 3. NV 存储参数 ==================== */
/*
 * 0xA0/0xA1 落在 hi_config.h 的 normal 用户区（0xA0~0xFF），
 * 不需要工厂区权限；NV 项长度必须正好是 64 字节，所以记录大小写死。
 */
#define CONFIG_NV_ID_A 0xA0 /* A 槽（记录 ID） */
#define CONFIG_NV_ID_B 0xA1 /* B 槽（记录 ID） */
#define CONFIG_NV_RECORD_SIZE 64
#define CONFIG_NV_SLOT_A 0
#define CONFIG_NV_SLOT_B 1
#define CONFIG_NV_SCHEMA_VERSION 1
/* 魔术字 0x31434653 按小端写进 Flash 正好是 'S''F''C''1'，看十六进制就能认出来 */
#define CONFIG_NV_RECORD_MAGIC 0x31434653UL

/* ==================== 4. 默认配置 ==================== */
#define CONFIG_DEFAULT_MODE 0             /* 0 = 手动，1 = 自动 */
#define CONFIG_DEFAULT_HUMIDITY_LOWER 300 /* 30.0 %RH（单位 0.1%） */
#define CONFIG_DEFAULT_HUMIDITY_UPPER 400 /* 40.0 %RH */
#define CONFIG_DEFAULT_FLAME_TRIP 2400    /* 火焰触发阈值（原始值 0~4095） */
#define CONFIG_DEFAULT_FLAME_CLEAR 1600   /* 火焰解除阈值，要比 trip 小才能形成滞回 */
#define CONFIG_DEFAULT_ALARM_ENABLE 1     /* 默认开报警；日光/红外干扰大时改成 0 */

#define CONFIG_HUMIDITY_MIN 0
#define CONFIG_HUMIDITY_MAX 1000
#define CONFIG_FLAME_RAW_MIN 0
#define CONFIG_FLAME_RAW_MAX 4095
#define CONFIG_AP3216C_TO_12BIT 4 /* AP3216C 红外是 10 位，乘 4 后和 12 位 ADC 同一口径 */

/* ==================== 5. 周期与时间参数 ==================== */
#define CONFIG_SECURITY_PERIOD_MS 100 /* 火焰采样周期 */
#define CONFIG_GAS_PERIOD_MS 1000     /* SGP30 大约 1s 测一次 */
#define CONFIG_GAS_RETRY_MS 5000      /* 没探测到 SGP30 时，每 5s 再试一次 */
#define CONFIG_DISPLAY_PERIOD_MS 300  /* OLED 刷新周期 */
#define CONFIG_DISPLAY_PAGE_MS 3000   /* 每 3s 换一页 */

#define CONFIG_KEY_SCAN_MS 10          /* 按键扫描周期 */
#define CONFIG_KEY_DEBOUNCE_MS 30      /* 按下超过 30ms 才算有效短按 */
#define CONFIG_KEY_LONG_PRESS_MS 1500  /* 长按判定，长按立即停止电机 */
#define CONFIG_MOTOR_TURN_DELAY_MS 200 /* 换向前停 PWM，等 200ms 再反向 */
#define CONFIG_MOTOR_DUTY 600          /* 电机占空比千分比，600 = 60% */

/* ==================== 6. 任务栈大小 ==================== */
/* 和老师示例的 4~5KB 量级保持一致，任务里有 sprintf，栈给太小容易溢出 */
#define CONFIG_SECURITY_TASK_STACK (4 * 1024)
#define CONFIG_MOTOR_TASK_STACK (3 * 1024)
#define CONFIG_DISPLAY_TASK_STACK (4 * 1024)

/* ==================== 7. 64 字节配置记录 ==================== */
/*
 * 字段顺序和偏移就是 Flash 上的布局，注释里的 +N 是偏移，改布局前先核对。
 * 结构体里全部用固定宽度类型，避免换编译器后长度变化。
 */
typedef struct {
    uint32_t magic;          /* +0  固定 CONFIG_NV_RECORD_MAGIC */
    uint16_t version;        /* +4  记录格式版本 */
    uint16_t length;         /* +6  固定 CONFIG_NV_RECORD_SIZE */
    uint32_t revision;       /* +8  每成功保存一次 +1 */
    uint8_t mode;            /* +12 0 手动 / 1 自动 */
    uint8_t alarm_enable;    /* +13 1 = 允许火焰报警 */
    uint16_t humidity_lower; /* +14 湿度下限，单位 0.1% */
    uint16_t humidity_upper; /* +16 湿度上限，单位 0.1% */
    uint16_t flame_trip;     /* +18 火焰触发阈值 */
    uint16_t flame_clear;    /* +20 火焰解除阈值 */
    uint8_t reserved[40];    /* +22 预留，填 0 */
    uint16_t crc16;          /* +62 覆盖 +0~+61 的校验值 */
} smart_farm_config_t;

/* 默认配置：两槽都读不出来时用它，只放在 RAM，不会自动写进 Flash */
#define SMART_FARM_CONFIG_DEFAULT                                            \
    {                                                                        \
        .magic = CONFIG_NV_RECORD_MAGIC, .version = CONFIG_NV_SCHEMA_VERSION, \
        .length = CONFIG_NV_RECORD_SIZE, .revision = 0,                      \
        .mode = CONFIG_DEFAULT_MODE, .alarm_enable = CONFIG_DEFAULT_ALARM_ENABLE, \
        .humidity_lower = CONFIG_DEFAULT_HUMIDITY_LOWER,                     \
        .humidity_upper = CONFIG_DEFAULT_HUMIDITY_UPPER,                     \
        .flame_trip = CONFIG_DEFAULT_FLAME_TRIP,                             \
        .flame_clear = CONFIG_DEFAULT_FLAME_CLEAR,                           \
        .reserved = {0}, .crc16 = 0                                          \
    }

/* 编译期自检：结构体长度不等于 64 时这里直接编译报错，比上机才发现要省事 */
typedef char smart_farm_config_size_check_t[(sizeof(smart_farm_config_t) == CONFIG_NV_RECORD_SIZE) ? 1 : -1];

#endif /* SMART_FARM_CONFIG_H */
