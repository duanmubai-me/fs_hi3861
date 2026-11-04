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
 * 电机 BSP 驱动（老师配套 H 桥扩展板：PCF8574 给方向，两路 PWM 调速）。
 *
 * 相对《硬件驱动源码》里 hal_bsp_motor.c 做的三处精简与修正：
 * 1. 修复“STOP 之后又启动”：原版 MOTOR_set_orientation() 的停止分支
 *    调完 hi_pwm_stop 没有 return，后面还会执行 hi_pwm_start，
 *    等于“停了又开”。这里把停止单独做成 MOTOR_Stop()，
 *    函数里只停 PWM、只清方向位，绝不调用 hi_pwm_start；
 * 2. 修正 PWM 通道对不上：左电机 GPIO8 用 PWM1，右电机 GPIO7 用 PWM0，
 *    初始化和启动用同一个端口（原版初始化 PWM0、启动却用 PWM1）；
 * 3. 一个函数只做一件事：MOTOR_Run() 先写方向位（写失败就不开 PWM），
 *    再启动 PWM；MOTOR_Stop() 先停 PWM 再清方向位。
 *    “换向前等 200ms”这种时序放在上层 motor_control.c 里做，
 *    驱动层不阻塞，否则会卡住采集和报警任务。
 *
 * PCF8574 方向位：左电机 IN1/IN2 = P0/P1，右电机 IN3/IN4 = P2/P3，
 * 只改低 4 位，高 4 位保持原值，不会影响同一颗芯片上的其它功能。
 */

#ifndef HAL_BSP_MOTOR_H
#define HAL_BSP_MOTOR_H

#include <stdint.h>

/* 电机方向（数值沿用老师示例，不要改） */
typedef enum {
    MOTOR_DIRECTION_STOP = 0, /* 停止 */
    MOTOR_DIRECTION_POSITIVE, /* 正转 */
    MOTOR_DIRECTION_ROLLBACK, /* 反转 */
} Motor_Direction_t;

/* 占空比用千分比表示：1000 = 100% */
#define MOTOR_PERMILLE_MAX 1000

/**
 * @brief  电机初始化：I2C 复用 + PCF8574 方向位清零 + 两路 PWM 初始化
 * @note   要在底板 PCF8574_Init() 之后调用（共用 I2C0）。
 * @retval 0 成功；其它值为 I2C/PWM 的错误码（见 hi_errno.h）
 */
uint32_t MOTOR_Init(void);

/**
 * @brief  两个电机都停止（先停 PWM，再清方向位）
 * @note   可以重复调用；这是唯一的“停”入口，停了就不会被本函数重新启动。
 * @retval 0 成功；其它值为 I2C 写失败码
 */
uint32_t MOTOR_Stop(void);

/**
 * @brief  两个电机同向转动
 * @param  dir      [IN] MOTOR_DIRECTION_POSITIVE / MOTOR_DIRECTION_ROLLBACK
 * @param  permille [IN] 占空比千分比 1~1000
 * @note   dir 传 MOTOR_DIRECTION_STOP 或 permille 为 0 时等价于 MOTOR_Stop()。
 * @retval 0 成功；其它值为 I2C/PWM 错误码
 */
uint32_t MOTOR_Run(Motor_Direction_t dir, uint16_t permille);

#endif /* HAL_BSP_MOTOR_H */
