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
 * 安防服务实现。
 *
 * 火焰判定（带滞回）：
 *   正常 --(raw >= trip)--> 报警 --(raw <= clear)--> 正常
 * 两个阈值分开，就不会出现“数值在 2400 上下抖，蜂鸣器一直响”的情况。
 *
 * 数据源：默认 AP3216C 红外通道（模拟火焰，10 位），乘 4 归一到 0~4095，
 * 和 12 位 ADC 输出同一口径；外接 AO 火焰模块时改宏走 ADC。
 *
 * 气体：直接用 common/bsp 的 hal_bsp_sgp30 驱动（7 位地址 0x58），
 * 读不到就当作“未配置”，不伪造 0。
 */

#include <stdio.h>
#include <string.h>

#include "cmsis_os2.h"
#include "hi_errno.h"

/* 先包含配置头：下面选择 ADC 数据源时要用到 CONFIG_FLAME_xxx 宏 */
#include "smart_farm_config.h"

#if (CONFIG_FLAME == 1) && (CONFIG_FLAME_SOURCE == CONFIG_FLAME_SRC_ADC)
#include "hi_adc.h"
#endif

#include "hal_bsp_ap3216c.h"
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_sgp30.h"

#include "smart_farm_state.h"
#include "config_store.h"
#include "motor_control.h"
#include "security_service.h"

#define FLAME_RAW_INVALID 0xFFFF /* 读失败时的返回值，正常值最大 4095 */

/* 气体周期必须是火焰周期的整数倍：任务里用 tick 取余分频，除零会直接崩 */
#if (CONFIG_GAS_PERIOD_MS < CONFIG_SECURITY_PERIOD_MS) || ((CONFIG_GAS_PERIOD_MS % CONFIG_SECURITY_PERIOD_MS) != 0)
#error "CONFIG_GAS_PERIOD_MS 必须是 CONFIG_SECURITY_PERIOD_MS 的整数倍"
#endif

#if CONFIG_SECURITY

/* ---------------- 火焰 ---------------- */
#if CONFIG_FLAME
static uint8_t s_flame_ready; /* 1 = 火焰数据源可用 */

/* 读一次火焰原始值，失败返回 FLAME_RAW_INVALID */
static uint16_t read_flame_raw(void)
{
#if CONFIG_FLAME_SOURCE == CONFIG_FLAME_SRC_ADC
    hi_u16 adc_value = 0;

    if (hi_adc_read((hi_adc_channel_index)CONFIG_FLAME_ADC_CHANNEL, &adc_value,
                    HI_ADC_EQU_MODEL_8, HI_ADC_CUR_BAIS_DEFAULT, 0) != HI_ERR_SUCCESS) {
        return FLAME_RAW_INVALID;
    }
    return (uint16_t)(adc_value & 0x0FFF); /* ADC 是 12 位 */
#else
    uint16_t ir = 0;
    uint16_t als = 0;
    uint16_t ps = 0;
    uint32_t raw;

    if (AP3216C_ReadData(&ir, &als, &ps) != HI_ERR_SUCCESS) {
        return FLAME_RAW_INVALID;
    }
    /* 红外是 10 位（0~1023），乘 4 归一到 0~4095，和 ADC 口径一致 */
    raw = (uint32_t)ir * CONFIG_AP3216C_TO_12BIT;
    return (uint16_t)((raw > CONFIG_FLAME_RAW_MAX) ? CONFIG_FLAME_RAW_MAX : raw);
#endif
}

static void flame_init(void)
{
#if CONFIG_FLAME_SOURCE == CONFIG_FLAME_SRC_NONE
    s_flame_ready = 0;
    printf("[security] 未选择火焰数据源，只做气体采集\r\n");
#elif CONFIG_FLAME_SOURCE == CONFIG_FLAME_SRC_ADC
    s_flame_ready = 1;
    printf("[security] 火焰数据源 = ADC 通道%d（外接 AO 模块）\r\n", CONFIG_FLAME_ADC_CHANNEL);
#else
    AP3216C_Init(); /* I2C 复用 + 打开 ALS/PS/IR */
    s_flame_ready = (read_flame_raw() == FLAME_RAW_INVALID) ? 0 : 1;
    printf("[security] 火焰数据源 = AP3216C 红外模拟：%s\r\n", (s_flame_ready != 0) ? "就绪" : "未配置");
#endif
}

/* 火焰判定：报警时立刻停风扇/电机并响蜂鸣器，解除时关掉 */
static void flame_step(const smart_farm_config_t *cfg)
{
    uint16_t raw;
    uint8_t alarm = g_smart_farm_state.flame_alarm; /* 读上一次的报警状态做滞回 */

    if (s_flame_ready == 0) {
        smart_farm_state_set_flame(0, cfg->flame_trip, cfg->flame_clear, 0);
        return;
    }

    raw = read_flame_raw();
    if (raw == FLAME_RAW_INVALID) {
        printf("[security] 火焰读数失败，本轮不判定\r\n");
        return;
    }

    if (cfg->alarm_enable == 0) {
        alarm = 0; /* 关了报警：只看数值，不动作 */
    } else if ((alarm == 0) && (raw >= cfg->flame_trip)) {
        alarm = 1;
    } else if ((alarm != 0) && (raw <= cfg->flame_clear)) {
        alarm = 0;
    }

    if (alarm != g_smart_farm_state.flame_alarm) {
        if (alarm != 0) {
            printf("[security] 火焰报警！raw=%u trip=%u，停风扇/电机\r\n",
                   (unsigned int)raw, (unsigned int)cfg->flame_trip);
            set_buzzer(1);
            set_led(1);
            set_fan(0);
            motor_stop();
            smart_farm_state_set_fan(0);
            smart_farm_state_set_motor(0);
        } else {
            printf("[security] 火焰报警解除：raw=%u <= clear=%u\r\n",
                   (unsigned int)raw, (unsigned int)cfg->flame_clear);
            set_buzzer(0);
            set_led(0);
        }
    }
    smart_farm_state_set_flame(raw, cfg->flame_trip, cfg->flame_clear, alarm);
}
#endif /* CONFIG_FLAME */

/* ---------------- 气体 ---------------- */
#if CONFIG_GAS
static uint8_t s_gas_ready;   /* 1 = SGP30 可用 */
static uint32_t s_gas_wait_ms; /* 没探测到时用于 5s 重试计时 */

static void gas_init(void)
{
    uint16_t eco2 = 0;
    uint16_t tvoc = 0;

    SGP30_Init(); /* I2C 复用 + init_air_quality 命令 */
    if (SGP30_ReadData(&eco2, &tvoc) != HI_ERR_SUCCESS) {
        s_gas_ready = 0;
        smart_farm_state_set_gas(0, 0, (uint8_t)SF_QUALITY_NOT_CONFIGURED);
        printf("[security] 气体模块未配置（SGP30 无响应），气体页显示 --\r\n");
        return;
    }
    s_gas_ready = 1;
    smart_farm_state_set_gas(eco2, tvoc, (uint8_t)SF_QUALITY_OK);
    printf("[security] SGP30 就绪：eCO2=%u ppm TVOC=%u ppb\r\n", (unsigned int)eco2, (unsigned int)tvoc);
}

static void gas_step(void)
{
    uint16_t eco2 = 0;
    uint16_t tvoc = 0;

    if (s_gas_ready == 0) {
        /* 没探测到就每 5s 再试一次：现场插上模块不用重启 */
        s_gas_wait_ms += CONFIG_GAS_PERIOD_MS;
        if (s_gas_wait_ms < CONFIG_GAS_RETRY_MS) {
            return;
        }
        s_gas_wait_ms = 0;
    }

    if (SGP30_ReadData(&eco2, &tvoc) != HI_ERR_SUCCESS) {
        if (s_gas_ready != 0) {
            printf("[security] SGP30 读取失败，气体页改为 --\r\n");
        }
        s_gas_ready = 0;
        smart_farm_state_set_gas(0, 0, (uint8_t)SF_QUALITY_NOT_CONFIGURED);
        return;
    }
    s_gas_ready = 1;
    smart_farm_state_set_gas(eco2, tvoc, (uint8_t)SF_QUALITY_OK);
}
#endif /* CONFIG_GAS */

/* ---------------- 对外接口 ---------------- */

int security_service_init(void)
{
    printf("[security] 安防服务初始化\r\n");
    set_buzzer(0); /* 上电先确保蜂鸣器和 LED 是关的 */
    set_led(0);

#if CONFIG_FLAME
    flame_init();
#endif
#if CONFIG_GAS
    gas_init();
#endif
    return 0;
}

void security_service_task(void)
{
#if CONFIG_FLAME
    smart_farm_config_t cfg;
#endif
    uint32_t tick = 0;

    printf("[security] 安防任务启动（火焰 %dms / 气体 %dms）\r\n",
           CONFIG_SECURITY_PERIOD_MS, CONFIG_GAS_PERIOD_MS);

    while (1) {
#if CONFIG_FLAME
        config_store_get(&cfg); /* 每轮取最新阈值：保存后不用重启就生效 */
        flame_step(&cfg);
#endif
        tick++;
#if CONFIG_GAS
        if ((tick % (CONFIG_GAS_PERIOD_MS / CONFIG_SECURITY_PERIOD_MS)) == 0) {
            gas_step();
        }
#endif
        osDelay(CONFIG_SECURITY_PERIOD_MS);
    }
}

void get_security_state(security_state_t *out)
{
    if (out == NULL) {
        return;
    }
    memset(out, 0, sizeof(*out));
    out->flame_raw = g_smart_farm_state.flame_raw;
    out->flame_trip = g_smart_farm_state.flame_trip;
    out->flame_clear = g_smart_farm_state.flame_clear;
    out->flame_alarm = g_smart_farm_state.flame_alarm;
    out->eco2_ppm = g_smart_farm_state.eco2_ppm;
    out->tvoc_ppb = g_smart_farm_state.tvoc_ppb;
    out->gas_ready = (g_smart_farm_state.gas_quality == (uint8_t)SF_QUALITY_OK) ? 1 : 0;
#if CONFIG_FLAME
    out->flame_ready = s_flame_ready;
#endif
}

#else /* CONFIG_SECURITY == 0：整个安防服务只留空实现，保证链接不报错 */

int security_service_init(void)
{
    printf("[security] CONFIG_SECURITY=0，安防服务未启用\r\n");
    return 0;
}

void security_service_task(void)
{
    printf("[security] CONFIG_SECURITY=0，任务不运行\r\n");
}

void get_security_state(security_state_t *out)
{
    if (out != NULL) {
        memset(out, 0, sizeof(*out));
    }
}

#endif /* CONFIG_SECURITY */
