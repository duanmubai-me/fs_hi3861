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
 * 电机 BSP 实现（参考《硬件驱动源码》/bsp/src/hal_bsp_motor.c 精简而来）。
 */

#include <stdio.h>

#include "hi_errno.h"
#include "hi_i2c.h"
#include "hi_io.h"
#include "hi_pwm.h"

#include "hal_bsp_motor.h"

/* 电机扩展板上的 PCF8574：8 位写地址 0x40（7 位地址 0x20），和底板 0x43 是两颗芯片 */
#define MOTOR_I2C_IDX 0
#define MOTOR_I2C_SPEED 100000
#define MOTOR_PCF8574_ADDR 0x40

/* 方向位：低 4 位有效，高 4 位保留 */
#define MOTOR_BITS_FORWARD 0x05 /* IN1=1 IN2=0 IN3=1 IN4=0 */
#define MOTOR_BITS_REVERSE 0x0A /* IN1=0 IN2=1 IN3=0 IN4=1 */
#define MOTOR_BITS_MASK 0x0F

/* PWM：时钟 160MHz，10kHz 对应分频 16000，占空比计数也用同一量程 */
#define MOTOR_PWM_FREQ_DIV 16000
#define MOTOR_PWM_DUTY_MAX 16000

/* 左电机 PWM1 -> GPIO8，右电机 PWM0 -> GPIO7（和 hi_io.h 的复用表对应） */
#define MOTOR_LEFT_GPIO HI_IO_NAME_GPIO_8
#define MOTOR_LEFT_FUNC HI_IO_FUNC_GPIO_8_PWM1_OUT
#define MOTOR_LEFT_PORT HI_PWM_PORT_PWM1
#define MOTOR_RIGHT_GPIO HI_IO_NAME_GPIO_7
#define MOTOR_RIGHT_FUNC HI_IO_FUNC_GPIO_7_PWM0_OUT
#define MOTOR_RIGHT_PORT HI_PWM_PORT_PWM0

static uint8_t g_io_shadow; /* PCF8574 输出影子：只改低 4 位，高 4 位保持 */
static uint8_t g_inited;    /* 1 = 初始化成功 */

/* 写一字节到电机扩展板的 PCF8574 */
static uint32_t motor_pcf8574_write(uint8_t value)
{
    uint8_t buffer[1];
    hi_i2c_data i2c_data = {0};

    buffer[0] = value;
    i2c_data.send_buf = buffer;
    i2c_data.send_len = 1;
    return hi_i2c_write(MOTOR_I2C_IDX, MOTOR_PCF8574_ADDR, &i2c_data);
}

/* 停两路 PWM（只停输出，不动方向位） */
static void motor_pwm_stop(void)
{
    hi_pwm_stop(MOTOR_LEFT_PORT);
    hi_pwm_stop(MOTOR_RIGHT_PORT);
}

uint32_t MOTOR_Init(void)
{
    uint32_t ret;

    /* I2C0 复用（和底板 PCF8574/OLED 共用同一组引脚，重复初始化没有副作用） */
    hi_io_set_pull(HI_IO_NAME_GPIO_9, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_9, HI_IO_FUNC_GPIO_9_I2C0_SCL);
    hi_io_set_pull(HI_IO_NAME_GPIO_10, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_10, HI_IO_FUNC_GPIO_10_I2C0_SDA);
    ret = hi_i2c_init(MOTOR_I2C_IDX, MOTOR_I2C_SPEED);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] I2C 初始化失败 0x%x\r\n", (unsigned int)ret);
        return ret;
    }

    /* 两路 PWM 复用，注意“初始化哪个端口，后面就启动哪个端口” */
    hi_io_set_func(MOTOR_LEFT_GPIO, MOTOR_LEFT_FUNC);
    hi_io_set_func(MOTOR_RIGHT_GPIO, MOTOR_RIGHT_FUNC);
    ret = hi_pwm_init(MOTOR_LEFT_PORT);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 左电机 PWM 初始化失败 0x%x\r\n", (unsigned int)ret);
        return ret;
    }
    ret = hi_pwm_init(MOTOR_RIGHT_PORT);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 右电机 PWM 初始化失败 0x%x\r\n", (unsigned int)ret);
        return ret;
    }

    g_io_shadow = 0;
    g_inited = 1;
    ret = MOTOR_Stop(); /* 上电先确保两个电机都不转 */
    printf("[bsp_motor] 电机驱动初始化完成\r\n");
    return ret;
}

uint32_t MOTOR_Stop(void)
{
    uint32_t ret;

    if (g_inited == 0) {
        return HI_ERR_SUCCESS;
    }
    /* 关键：先停 PWM，再清方向位；本函数后面不会有 hi_pwm_start，
       所以不会出现原版“STOP 之后又被启动”的问题 */
    motor_pwm_stop();
    g_io_shadow &= (uint8_t)(~MOTOR_BITS_MASK);
    ret = motor_pcf8574_write(g_io_shadow);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 停止时写 PCF8574 失败 0x%x\r\n", (unsigned int)ret);
    }
    return ret;
}

uint32_t MOTOR_Run(Motor_Direction_t dir, uint16_t permille)
{
    uint32_t ret;
    uint16_t duty;

    if (g_inited == 0) {
        return HI_ERR_FAILURE; /* 没初始化就不要动硬件 */
    }
    if ((dir == MOTOR_DIRECTION_STOP) || (permille == 0)) {
        return MOTOR_Stop();
    }
    if (permille > MOTOR_PERMILLE_MAX) {
        permille = MOTOR_PERMILLE_MAX;
    }

    /* 先停 PWM 再改方向：即使上层忘了先停，也不会带着输出换向 */
    motor_pwm_stop();
    if (dir == MOTOR_DIRECTION_POSITIVE) {
        g_io_shadow = (uint8_t)((g_io_shadow & (uint8_t)(~MOTOR_BITS_MASK)) | MOTOR_BITS_FORWARD);
    } else {
        g_io_shadow = (uint8_t)((g_io_shadow & (uint8_t)(~MOTOR_BITS_MASK)) | MOTOR_BITS_REVERSE);
    }
    ret = motor_pcf8574_write(g_io_shadow);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 写方向位失败 0x%x，不启动 PWM\r\n", (unsigned int)ret);
        return ret;
    }

    /* 千分比换成 PWM 计数值：1000 -> 16000（10kHz 下一个完整周期） */
    duty = (uint16_t)(((uint32_t)permille * MOTOR_PWM_DUTY_MAX) / MOTOR_PERMILLE_MAX);
    ret = hi_pwm_start(MOTOR_LEFT_PORT, duty, MOTOR_PWM_FREQ_DIV);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 左电机 PWM 启动失败 0x%x\r\n", (unsigned int)ret);
        return ret;
    }
    ret = hi_pwm_start(MOTOR_RIGHT_PORT, duty, MOTOR_PWM_FREQ_DIV);
    if (ret != HI_ERR_SUCCESS) {
        printf("[bsp_motor] 右电机 PWM 启动失败 0x%x\r\n", (unsigned int)ret);
        return ret;
    }
    return HI_ERR_SUCCESS;
}
