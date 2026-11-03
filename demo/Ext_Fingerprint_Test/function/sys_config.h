/*
 * Copyright (c) 2023 Beijing HuaQing YuanJian Education Technology Co., Ltd
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

#ifndef SYS_CONFIG_H
#define SYS_CONFIG_H
#include <stdint.h>

#include "hal_bsp_structAll.h"



// 锁的模式
typedef enum {
    KEY_PATTERN_TEST = 0x01, // 测试
    KEY_PATTERN_INPUT,       // 录入
} te_key_pattern_t;

// 锁的状态
typedef enum {
    KEY_STATUS_ON = 0x01, // 开启
    KEY_STATUS_OFF,       // 关闭
} te_key_status_t;

/*********************************** 系统的全局变量 ***********************************/


typedef struct _system1_value {
    te_key_pattern_t key_pattern; // 指纹锁的模式
    te_key_status_t  key_status;  // 指纹锁的状态;
    uint32_t flag;                // 按键标志位
} system_value_t;

extern system_value_t systemdata; // 系统全局变量


extern tn_pcf8574_io_t pcf8574_io;
#define IO_FAN pcf8574_io.bit.p0
#define IO_BUZZER pcf8574_io.bit.p1
#define IO_LED pcf8574_io.bit.p2

#endif
