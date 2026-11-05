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
 * 配置存储服务实现：A/B 双槽 + CRC + 回读校验。
 *
 * 文件末尾顺带放了全局运行状态 g_smart_farm_state 的定义和读写函数：
 * 状态结构只有几十字节，没必要再单独建一个 app_state.c；
 * config_store 是上电后第一个被调用的新模块，放这里最省事。
 */

#include <stdio.h>
#include <string.h>

#include "hi_nv.h"

#include "smart_farm_config.h"
#include "smart_farm_state.h"
#include "config_store.h"

/* 当前生效的配置（RAM 里的一份拷贝）和它来自哪个槽 */
static smart_farm_config_t g_config;
static uint8_t g_active_slot = CONFIG_NV_SLOT_A;
static uint8_t g_inited = 0;

/* 两槽都无效时用的默认值，放在只读段，不会被误改 */
static const smart_farm_config_t k_default_config = SMART_FARM_CONFIG_DEFAULT;

/* ---------------- CRC 与合法性检查 ---------------- */

/* CRC-16/CCITT-FALSE：初值 0xFFFF、多项式 0x1021，用来发现“写了一半”的记录 */
static uint16_t crc16_ccitt(const uint8_t *data, uint32_t len)
{
    uint16_t crc = 0xFFFF;
    uint32_t i;
    uint8_t bit;

    for (i = 0; i < len; i++) {
        crc ^= (uint16_t)((uint16_t)data[i] << 8);
        for (bit = 0; bit < 8; bit++) {
            if ((crc & 0x8000) != 0) {
                crc = (uint16_t)((crc << 1) ^ 0x1021);
            } else {
                crc = (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}

/* 末尾 2 字节是 crc16 字段本身，不参与计算 */
static uint16_t config_calc_crc(const smart_farm_config_t *cfg)
{
    return crc16_ccitt((const uint8_t *)cfg, sizeof(*cfg) - sizeof(uint16_t));
}

/* 简单合法性检查：关系不对的配置既不落盘也不生效 */
static int config_check(const smart_farm_config_t *cfg)
{
    if (cfg->humidity_lower >= cfg->humidity_upper) {
        return CONFIG_ERR_PARAM;
    }
    if (cfg->humidity_upper > CONFIG_HUMIDITY_MAX) {
        return CONFIG_ERR_PARAM;
    }
    if (cfg->flame_clear >= cfg->flame_trip) {
        return CONFIG_ERR_PARAM;
    }
    if (cfg->flame_trip > CONFIG_FLAME_RAW_MAX) {
        return CONFIG_ERR_PARAM;
    }
    if ((cfg->mode > 1) || (cfg->alarm_enable > 1)) {
        return CONFIG_ERR_PARAM;
    }
    return CONFIG_OK;
}

/* ---------------- NV 读写 ---------------- */

static uint8_t config_slot_nv_id(uint8_t slot)
{
    return (slot == CONFIG_NV_SLOT_A) ? (uint8_t)CONFIG_NV_ID_A : (uint8_t)CONFIG_NV_ID_B;
}

/* 读一个槽并校验：magic、长度、CRC、字段范围全对才算有效 */
static int config_read_slot(uint8_t slot, smart_farm_config_t *out)
{
    uint32_t ret;

    memset(out, 0, sizeof(*out));
    ret = hi_nv_read((hi_u8)config_slot_nv_id(slot), (hi_pvoid)out, (hi_u8)CONFIG_NV_RECORD_SIZE, 0);
    if (ret != HI_ERR_SUCCESS) {
        printf("[config] 读 NV 槽%c 失败 0x%x\r\n", (slot == CONFIG_NV_SLOT_A) ? 'A' : 'B',
               (unsigned int)ret);
        return CONFIG_ERR_NV;
    }
    if ((out->magic != CONFIG_NV_RECORD_MAGIC) || (out->length != CONFIG_NV_RECORD_SIZE) ||
        (out->crc16 != config_calc_crc(out))) {
        printf("[config] 槽%c 内容无效（magic/crc 不对），按空槽处理\r\n",
               (slot == CONFIG_NV_SLOT_A) ? 'A' : 'B');
        return CONFIG_ERR_VERIFY;
    }
    return config_check(out);
}

/* 写一个槽：先把 CRC 填好再写，校验交给调用者读回来做 */
static int config_write_slot(uint8_t slot, smart_farm_config_t *cfg)
{
    uint32_t ret;

    cfg->crc16 = config_calc_crc(cfg);
    ret = hi_nv_write((hi_u8)config_slot_nv_id(slot), (hi_pvoid)cfg, (hi_u8)CONFIG_NV_RECORD_SIZE, 0);
    if (ret != HI_ERR_SUCCESS) {
        printf("[config] 写 NV 槽%c 失败 0x%x\r\n", (slot == CONFIG_NV_SLOT_A) ? 'A' : 'B',
               (unsigned int)ret);
        return CONFIG_ERR_NV;
    }
    return CONFIG_OK;
}

/* ---------------- 对外接口 ---------------- */

int config_store_init(void)
{
#if CONFIG_STORE
    smart_farm_config_t slot_a;
    smart_farm_config_t slot_b;
    int ret_a = config_read_slot(CONFIG_NV_SLOT_A, &slot_a);
    int ret_b = config_read_slot(CONFIG_NV_SLOT_B, &slot_b);

    if ((ret_a == CONFIG_OK) && (ret_b == CONFIG_OK)) {
        /* 两个槽都好：取 revision 大的；版本相同说明上次没写好，取 A 槽 */
        if (slot_a.revision >= slot_b.revision) {
            g_config = slot_a;
            g_active_slot = CONFIG_NV_SLOT_A;
        } else {
            g_config = slot_b;
            g_active_slot = CONFIG_NV_SLOT_B;
        }
    } else if (ret_a == CONFIG_OK) {
        g_config = slot_a;
        g_active_slot = CONFIG_NV_SLOT_A;
    } else if (ret_b == CONFIG_OK) {
        g_config = slot_b;
        g_active_slot = CONFIG_NV_SLOT_B;
    } else {
        g_config = k_default_config;
        g_active_slot = CONFIG_NV_SLOT_A; /* 下次保存写 B 槽，A 槽保持空 */
        printf("[config] 两个槽都没有有效配置，使用默认值（不写 Flash）\r\n");
    }
#else
    g_config = k_default_config;
    printf("[config] CONFIG_STORE=0，只用默认配置，不读写 NV\r\n");
#endif

    g_inited = 1;
    smart_farm_state_set_config(g_config.mode, g_config.revision);
    /* 湿度用整数打印成 x.y，避免在设备端依赖 %f（newlib-nano 经常不支持浮点 printf） */
    printf("[config] 当前配置：槽%c revision=%u 模式=%s 报警=%s\r\n",
           (g_active_slot == CONFIG_NV_SLOT_A) ? 'A' : 'B', (unsigned int)g_config.revision,
           (g_config.mode == 1) ? "自动" : "手动", (g_config.alarm_enable == 1) ? "开" : "关");
    printf("[config] 湿度 %u.%u%% ~ %u.%u%%，火焰 trip=%u clear=%u\r\n",
           (unsigned int)(g_config.humidity_lower / 10), (unsigned int)(g_config.humidity_lower % 10),
           (unsigned int)(g_config.humidity_upper / 10), (unsigned int)(g_config.humidity_upper % 10),
           (unsigned int)g_config.flame_trip, (unsigned int)g_config.flame_clear);
    return CONFIG_OK;
}

void config_store_get(smart_farm_config_t *out)
{
    if (out == NULL) {
        return;
    }
    *out = (g_inited != 0) ? g_config : k_default_config;
}

int config_store_save(const smart_farm_config_t *cfg)
{
#if !CONFIG_STORE
    (void)cfg;
    printf("[config] CONFIG_STORE=0，保存请求被忽略\r\n");
    return CONFIG_ERR_DISABLED;
#else
    smart_farm_config_t record;
    smart_farm_config_t verify;
    uint8_t next_slot;
    int ret;

    if (cfg == NULL) {
        return CONFIG_ERR_PARAM;
    }

    /* 头字段和 revision 由本函数统一填写，调用者只管业务字段 */
    record = *cfg;
    record.magic = CONFIG_NV_RECORD_MAGIC;
    record.version = CONFIG_NV_SCHEMA_VERSION;
    record.length = CONFIG_NV_RECORD_SIZE;
    record.revision = g_config.revision + 1;
    record.crc16 = 0;

    ret = config_check(&record);
    if (ret != CONFIG_OK) {
        printf("[config] 配置不合法（湿度上下限或火焰阈值关系错），拒绝保存\r\n");
        return ret;
    }

    /* 写另一个槽：这次写失败，上一份记录还在 */
    next_slot = (g_active_slot == CONFIG_NV_SLOT_A) ? CONFIG_NV_SLOT_B : CONFIG_NV_SLOT_A;
    ret = config_write_slot(next_slot, &record);
    if (ret != CONFIG_OK) {
        return ret;
    }

    /* 写进去不算数，读回来一致才算数 */
    ret = config_read_slot(next_slot, &verify);
    if ((ret != CONFIG_OK) || (memcmp(&verify, &record, sizeof(record)) != 0)) {
        printf("[config] 回读校验失败，本次保存不生效\r\n");
        return CONFIG_ERR_VERIFY;
    }

    g_config = record;
    g_active_slot = next_slot;
    smart_farm_state_set_config(record.mode, record.revision);
    printf("[config] 保存成功：槽%c revision=%u\r\n", (next_slot == CONFIG_NV_SLOT_A) ? 'A' : 'B',
           (unsigned int)record.revision);
    return CONFIG_OK;
#endif
}

int config_store_reset(void)
{
    smart_farm_config_t cfg = k_default_config;

    printf("[config] 恢复默认配置\r\n");
    return config_store_save(&cfg);
}

/* ==================================================================
 * 全局运行状态的唯一实例与读写函数（smart_farm_state.h）
 * ================================================================== */

smart_farm_state_t g_smart_farm_state;

void smart_farm_state_init(void)
{
    memset(&g_smart_farm_state, 0, sizeof(g_smart_farm_state));
    g_smart_farm_state.th_quality = (uint8_t)SF_QUALITY_UNKNOWN;
    g_smart_farm_state.gas_quality = (uint8_t)SF_QUALITY_UNKNOWN;
}

void smart_farm_state_get(smart_farm_state_t *out)
{
    if (out == NULL) {
        return;
    }
    *out = g_smart_farm_state;
}

void smart_farm_state_set_sensor(int16_t temperature, int16_t humidity, uint8_t quality)
{
    g_smart_farm_state.temperature = temperature;
    g_smart_farm_state.humidity = humidity;
    g_smart_farm_state.th_quality = quality;
}

void smart_farm_state_set_gas(uint16_t eco2_ppm, uint16_t tvoc_ppb, uint8_t quality)
{
    g_smart_farm_state.eco2_ppm = eco2_ppm;
    g_smart_farm_state.tvoc_ppb = tvoc_ppb;
    g_smart_farm_state.gas_quality = quality;
}

void smart_farm_state_set_flame(uint16_t raw, uint16_t trip, uint16_t clear, uint8_t alarm)
{
    g_smart_farm_state.flame_raw = raw;
    g_smart_farm_state.flame_trip = trip;
    g_smart_farm_state.flame_clear = clear;
    g_smart_farm_state.flame_alarm = alarm;
}

void smart_farm_state_set_fan(uint8_t fan_on)
{
    g_smart_farm_state.fan_on = (fan_on != 0) ? 1 : 0;
}

void smart_farm_state_set_motor(uint8_t motor_dir)
{
    g_smart_farm_state.motor_dir = motor_dir;
}

void smart_farm_state_set_config(uint8_t mode, uint32_t revision)
{
    g_smart_farm_state.mode = mode;
    g_smart_farm_state.config_revision = revision;
}
