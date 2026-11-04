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
 * 安防服务：火焰阈值报警 + SGP30 气体采集。
 *
 * 它做什么：
 * 1. 每 100ms 读一次火焰原始值，和阈值比较（带滞回）：
 *    超过 trip 就报警——蜂鸣器响、LED 亮、风扇和电机立刻停；
 *    掉到 clear 以下才解除，避免在阈值附近来回抖；
 * 2. 每 1s 读一次 SGP30 的 eCO2/TVOC；没接模块就打印“未配置”，
 *    状态记为 NOT_CONFIGURED，显示页显示 "--"，绝不假装读到 0；
 * 3. 把结果写进全局状态，显示和上报都从那里读。
 *
 * 它不做什么：不写 Flash（阈值走 config_store）、不拼 JSON、不管风扇自动控制。
 */

#ifndef SECURITY_SERVICE_H
#define SECURITY_SERVICE_H

#include <stdint.h>

/* 安防快照，给显示和 MQTT 上报用 */
typedef struct {
    uint16_t flame_raw;   /* 火焰原始值 0~4095 */
    uint16_t flame_trip;  /* 触发阈值 */
    uint16_t flame_clear; /* 解除阈值 */
    uint8_t flame_alarm;  /* 1 = 报警中 */
    uint8_t flame_ready;  /* 1 = 火焰数据源可用 */
    uint16_t eco2_ppm;    /* SGP30 eCO2 */
    uint16_t tvoc_ppb;    /* SGP30 TVOC */
    uint8_t gas_ready;    /* 1 = SGP30 可用 */
} security_state_t;

/**
 * @brief  初始化安防服务：探测火焰源和 SGP30，关掉蜂鸣器/LED
 * @note   在 config_store_init() 之后、创建任务之前调用。
 *         探测不到传感器只打印“未配置”，不会让系统起不来。
 * @retval 0 成功（含传感器未接的降级情况）
 */
int security_service_init(void);

/**
 * @brief  安防任务：火焰 100ms 一次，气体 1s 一次
 * @note   由 smartFarm_demo 用 osThreadNew 创建，栈大小用
 *         CONFIG_SECURITY_TASK_STACK；函数内部自己 osDelay，不会返回。
 */
void security_service_task(void);

/**
 * @brief  取一份安防快照
 * @param  out [OUT] 不能为 NULL
 */
void get_security_state(security_state_t *out);

#endif /* SECURITY_SERVICE_H */
