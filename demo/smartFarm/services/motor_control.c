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
 * 电机控制服务实现：按键消抖 + 短按循环 + 长按停止。
 *
 * 按键接在 GPIO14，板上是上拉输入：按下读到 0，松开读到 1。
 * 消抖不做定时器，就用“按下时间超过 30ms 才算一次短按”这种软件办法，
 * 10ms 扫一次，课堂上好理解。
 */

#include <stdio.h>

#include "cmsis_os2.h"

#include "hal_bsp_key.h"
#include "hal_bsp_motor.h"

#include "smart_farm_config.h"
#include "smart_farm_state.h"
#include "motor_control.h"

/* 短按循环表：停止 -> 正转 -> 停止 -> 反转 */
static const Motor_Direction_t k_key_steps[4] = {
    MOTOR_DIRECTION_STOP,
    MOTOR_DIRECTION_POSITIVE,
    MOTOR_DIRECTION_STOP,
    MOTOR_DIRECTION_ROLLBACK,
};

static uint8_t s_inited;     /* 1 = 电机硬件初始化成功 */
static uint8_t s_step;       /* 当前在循环表的第几步 */
static uint8_t s_last_down;  /* 上一次扫描时按键是否按下：1 按下，0 松开 */
static uint32_t s_press_ms;  /* 本次按下的持续时间 */
static uint8_t s_long_done;  /* 长按已经处理过，松手时不再当短按 */

/* 真正去驱动电机：先停、等停稳、再按新方向启动 */
static void motor_apply(Motor_Direction_t dir)
{
    if (dir == MOTOR_DIRECTION_STOP) {
        MOTOR_Stop();
        smart_farm_state_set_motor((uint8_t)MOTOR_DIRECTION_STOP);
        printf("[motor] 停止\r\n");
        return;
    }

    MOTOR_Stop();                      /* 1. 先停 PWM */
    osDelay(CONFIG_MOTOR_TURN_DELAY_MS); /* 2. 等电机停稳，再反向 */
    if (MOTOR_Run(dir, CONFIG_MOTOR_DUTY) != 0) {
        printf("[motor] 启动失败，保持停止\r\n");
        return;
    }
    smart_farm_state_set_motor((uint8_t)dir);
    printf("[motor] %s\r\n", (dir == MOTOR_DIRECTION_POSITIVE) ? "正转" : "反转");
}

int motor_control_init(void)
{
#if CONFIG_MOTOR
    if (MOTOR_Init() != 0) {
        printf("[motor] 电机驱动初始化失败（检查 H 桥扩展板和接线）\r\n");
        return -1;
    }
    s_inited = 1;
    s_step = 0;
    motor_stop();
    printf("[motor] 电机服务就绪：短按循环 停止/正转/停止/反转，长按停止\r\n");
#else
    printf("[motor] CONFIG_MOTOR=0，电机功能未启用（接扩展板后把宏改成 1）\r\n");
#endif
    return 0;
}

void motor_stop(void)
{
    if (s_inited == 0) {
        return;
    }
    s_step = 0; /* 停完再短按，从头开始：正转 */
    motor_apply(MOTOR_DIRECTION_STOP);
}

void motor_control_next(void)
{
    if (s_inited == 0) {
        return;
    }
    s_step = (uint8_t)((s_step + 1) % 4);
    motor_apply(k_key_steps[s_step]);
}

void motor_control_task(void)
{
    uint8_t down;

    if (s_inited == 0) {
        printf("[motor] 电机未启用，任务不运行\r\n");
        return;
    }

    while (1) {
        down = (KEY_Get_Input_Value() == 0) ? 1 : 0; /* 上拉输入，按下是 0 */

        if (down != 0) {
            if (s_last_down == 0) { /* 刚按下：重新计时 */
                s_press_ms = 0;
                s_long_done = 0;
            } else {
                s_press_ms += CONFIG_KEY_SCAN_MS;
                if ((s_long_done == 0) && (s_press_ms >= CONFIG_KEY_LONG_PRESS_MS)) {
                    printf("[motor] 长按 -> 停止\r\n");
                    motor_stop();
                    s_long_done = 1;
                }
            }
        } else if (s_last_down != 0) {
            /* 松手：不是长按、而且按下时间够长，才算一次有效短按 */
            if ((s_long_done == 0) && (s_press_ms >= CONFIG_KEY_DEBOUNCE_MS)) {
                printf("[motor] 短按\r\n");
                motor_control_next();
            }
        }

        s_last_down = down;
        osDelay(CONFIG_KEY_SCAN_MS);
    }
}
