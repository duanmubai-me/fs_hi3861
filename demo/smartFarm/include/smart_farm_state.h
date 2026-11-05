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
 * 全局运行状态：整个设备只有一份，谁采集谁写，显示/上报只管读。
 *
 * 为什么不加锁（重要，答辩要能讲清楚）：
 * 1. 写入方都是周期任务（安防 100ms、电机 10ms、显示 300ms），写的是
 *    int/uint16 这种一个字长的字段，RISC-V 上单条 store 不会被拆开；
 * 2. 读的一方（显示、MQTT）拿到的快照即使“温度是新的、湿度是旧的”，
 *    也只是差一个采样周期，对课程设计没有影响；
 * 3. 不加锁就不会出现“锁没初始化就被调用”“在中断里拿锁”这类问题，
 *    代码也少一大截。真要工业级再加互斥量，那是另一门课的内容。
 *
 * 约定：结构体只由 smart_farm_state_set_xxx() 写，业务代码不要直接改
 * g_smart_farm_state 的字段（读取可以，写请走函数，方便以后加锁）。
 */

#ifndef SMART_FARM_STATE_H
#define SMART_FARM_STATE_H

#include <stdint.h>

/* 数据质量：没接传感器时不能显示 0，要显示“未配置” */
typedef enum {
    SF_QUALITY_UNKNOWN = 0,        /* 还没采样 */
    SF_QUALITY_OK = 1,             /* 本次读数有效 */
    SF_QUALITY_NOT_CONFIGURED = 2, /* 没接模块或功能没开 */
    SF_QUALITY_ERROR = 3           /* 通信/读取失败 */
} sf_quality_t;

typedef struct {
    /* 温湿度（由主线采集任务写进来，见 INTEGRATION.md） */
    int16_t temperature; /* 温度，整数 ℃ */
    int16_t humidity;    /* 湿度，整数 %RH */
    uint8_t th_quality;  /* sf_quality_t */

    /* 气体（security_service 写） */
    uint16_t eco2_ppm;
    uint16_t tvoc_ppb;
    uint8_t gas_quality; /* sf_quality_t */

    /* 火焰（security_service 写） */
    uint16_t flame_raw;   /* 原始值 0~4095 */
    uint16_t flame_trip;  /* 当前触发阈值，显示用 */
    uint16_t flame_clear; /* 当前解除阈值，显示用 */
    uint8_t flame_alarm;  /* 1 = 报警中 */

    /* 执行器与配置 */
    uint8_t fan_on;        /* 1 = 风扇（模拟水泵）开 */
    uint8_t motor_dir;     /* 0 停止 / 1 正转 / 2 反转 */
    uint8_t mode;          /* 0 手动 / 1 自动，来自配置 */
    uint32_t config_revision; /* 当前持久配置版本 */
} smart_farm_state_t;

extern smart_farm_state_t g_smart_farm_state;

/**
 * @brief  状态清零（所有 quality 置 UNKNOWN），上电时调用一次
 */
void smart_farm_state_init(void);

/**
 * @brief  取一份状态快照（结构体拷贝，读的时候不怕别人同时在写）
 * @param  out [OUT] 不能为 NULL
 */
void smart_farm_state_get(smart_farm_state_t *out);

/**
 * @brief  写入温湿度（主线采集任务调用）
 * @param  temperature [IN] 整数 ℃
 * @param  humidity    [IN] 整数 %RH
 * @param  quality     [IN] sf_quality_t
 */
void smart_farm_state_set_sensor(int16_t temperature, int16_t humidity, uint8_t quality);

/**
 * @brief  写入气体读数（security_service 调用）
 * @param  eco2_ppm [IN] eCO2
 * @param  tvoc_ppb [IN] TVOC
 * @param  quality  [IN] sf_quality_t
 */
void smart_farm_state_set_gas(uint16_t eco2_ppm, uint16_t tvoc_ppb, uint8_t quality);

/**
 * @brief  写入火焰读数（security_service 调用）
 * @param  raw    [IN] 原始值 0~4095
 * @param  trip   [IN] 当前触发阈值
 * @param  clear  [IN] 当前解除阈值
 * @param  alarm  [IN] 1 = 报警中
 */
void smart_farm_state_set_flame(uint16_t raw, uint16_t trip, uint16_t clear, uint8_t alarm);

/**
 * @brief  写入风扇状态
 * @param  fan_on [IN] 1 = 风扇开
 */
void smart_farm_state_set_fan(uint8_t fan_on);

/**
 * @brief  写入电机状态
 * @param  motor_dir [IN] 0 停止 / 1 正转 / 2 反转（和 Motor_Direction_t 数值一致）
 */
void smart_farm_state_set_motor(uint8_t motor_dir);

/**
 * @brief  写入配置状态（config_store 保存/加载成功后调用）
 * @param  mode     [IN] 0 手动 / 1 自动
 * @param  revision [IN] 配置版本
 */
void smart_farm_state_set_config(uint8_t mode, uint32_t revision);

#endif /* SMART_FARM_STATE_H */
