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

#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

#include "ohos_init.h"
#include "cmsis_os2.h"
#include "hal_bsp_pwm_rgb.h"
#include "hal_bsp_sgp30.h"
#include "hi_adc.h"

#include "hal_bsp_pcf8574.h"
#include "hal_bsp_aw2013.h"
#include "hi_uart.h"
#include "sys_config.h"

#include "hi_errno.h"
#include "hi_io.h"
#include "hi_gpio.h"
#include "hi_pwm.h"
#include "hal_bsp_key.h"

#define KEY HI_IO_NAME_GPIO_14    // WiFi模组的IO14引脚
extern system_value_t systemdata; // 系统全局变量
osThreadId_t Task1_ID = 0;        //  任务1 ID
hi_gpio_value val, val_last;      // GPIO的状态值
#define TASK_STACK_SIZE 1024
#define TASK_DELAY_TIME (200 * 1000)
uint32_t i;
uint8_t dblclick;
// extern tn_pcf8574_io_t tmp_io = {0}; // IO扩展芯片的引脚

// /**
//  * @description: 任务1
//  * @param {*}
//  * @return {*}
//  */
// void flame_SGP30_test_task(void)     //火焰传感器，可燃气体传感器函数
// {
//   while (1)
//   {
//     uint8_t data = 0;
//     if (PCF8574_Read(&data) != HI_ERR_SUCCESS) {
//         printf("PCF8574 read failed\n");
//         usleep(200000);
//         continue;
//     }           //读取PCF8574IO扩展芯片
//     if (data & 0x10)
//     {
//       systemdata.flame_status = FLAME_STATUS_OFF;
//     }
//     else
//     {
//       systemdata.flame_status = FLAME_STATUS_ON;
//     }

//     if (data & 0x80)
//     {
//       systemdata.combustible_status = FLAMMABLE_STATUS_OFF;
//     }
//     else
//     {
//       systemdata.combustible_status = FLAMMABLE_STATUS_ON;
//     }

//     SGP30_ReadData(&systemdata.CO2, &systemdata.TVOC);    //获取CO2和TVOC数据
//     sleep(2);
//   }
// }

void fire_detect_task(void *argument)
{
    uint8_t candidate = 0xFF;
    uint8_t count = 0;
    uint8_t input_fault = 0;
    (void)argument;

    while (1) {
        uint8_t data = 0;
        uint32_t ret = PCF8574_Read(&data);

        if (ret == HI_ERR_SUCCESS) {
            uint8_t active = (data & 0x10) ? 0 : 1;
            input_fault = 0;

            if (active != candidate) {
                candidate = active;
                count = 1;
            } else if (count < 3) {
                count++;
            }

            if (count >= 3) {
                systemdata.flame_status = active
                    ? FLAME_STATUS_ON : FLAME_STATUS_OFF;
                /* Retry output on later samples if a previous write failed. */
                set_buzzer(active);
            }

            systemdata.combustible_status = (data & 0x80)
                ? FLAMMABLE_STATUS_OFF : FLAMMABLE_STATUS_ON;
        } else {
            candidate = 0xFF;
            count = 0;
            if (!input_fault) {
                printf("fire input read failed: 0x%x\r\n", (unsigned int)ret);
                input_fault = 1;
            }
            /* Preserve the previous alarm state on input failure. */
        }
        usleep(50000);
    }
}

void sgp30_task(void *argument)
{
    uint32_t period = osKernelGetTickFreq();
    uint32_t next = osKernelGetTickCount();
    uint8_t input_fault = 0;
    (void)argument;

    if (period == 0) {
        printf("invalid kernel tick frequency\r\n");
        osThreadExit();
        return;
    }

    while (1) {
        uint16_t co2 = 0;
        uint16_t tvoc = 0;
        uint32_t ret = SGP30_ReadData(&co2, &tvoc);

        if (ret == HI_ERR_SUCCESS) {
            systemdata.CO2 = co2;
            systemdata.TVOC = tvoc;
            input_fault = 0;
        } else if (!input_fault) {
            printf("SGP30 read failed: 0x%x\r\n", (unsigned int)ret);
            input_fault = 1;
        }

        next += period;
        if ((int32_t)(next - osKernelGetTickCount()) <= 0) {
            next = osKernelGetTickCount() + period;
        }
        osDelayUntil(next);
    }
}

/* 先停止PWM，再把电机的两个输入明确拉低。 */
static void agri_motor_stop_low(void)
{
    hi_pwm_stop(HI_PWM_PORT_PWM0);
    hi_pwm_stop(HI_PWM_PORT_PWM1);

    hi_io_set_func(HI_IO_NAME_GPIO_7, HI_IO_FUNC_GPIO_7_GPIO);
    hi_io_set_func(HI_IO_NAME_GPIO_8, HI_IO_FUNC_GPIO_8_GPIO);

    hi_gpio_set_dir(HI_GPIO_IDX_7, HI_GPIO_DIR_OUT);
    hi_gpio_set_dir(HI_GPIO_IDX_8, HI_GPIO_DIR_OUT);

    hi_gpio_set_ouput_val(HI_GPIO_IDX_7, HI_GPIO_VALUE0);
    hi_gpio_set_ouput_val(HI_GPIO_IDX_8, HI_GPIO_VALUE0);
}

/*
 * mode:
 * 0：停止
 * 1：正转
 * 2：反转
 * 仅在控制状态改变时调用。
 */
static void agri_motor_apply(uint8_t mode)
{
    uint32_t ret;

    agri_motor_stop_low();

    if (mode == 0) {
        return;
    }

    /* 先停止200ms，再启动另一方向。 */
    usleep(200000);

    if (mode == 1) {
        /* GPIO8保持低电平，GPIO7输出PWM0。 */
        ret = hi_io_set_func(HI_IO_NAME_GPIO_7,
                             HI_IO_FUNC_GPIO_7_PWM0_OUT);
        if (ret == HI_ERR_SUCCESS) {
            ret = hi_pwm_start(HI_PWM_PORT_PWM0, 1000, 1000);
        }
    } else if (mode == 2) {
        /* GPIO7保持低电平，GPIO8输出PWM1。 */
        ret = hi_io_set_func(HI_IO_NAME_GPIO_8,
                             HI_IO_FUNC_GPIO_8_PWM1_OUT);
        if (ret == HI_ERR_SUCCESS) {
            ret = hi_pwm_start(HI_PWM_PORT_PWM1, 1000, 1000);
        }
    } else {
        return;
    }

    if (ret != HI_ERR_SUCCESS) {
        agri_motor_stop_low();
        printf("motor start failed: 0x%x\r\n",
               (unsigned int)ret);
    }
}

/*
 * 按键循环：
 * 停止 → 正转 → 反转 → 停止
 *
 * 任务轮询消抖，不再注册原来的按键中断。
 */
void key_test_task(void)
{
    hi_gpio_value raw = HI_GPIO_VALUE1;
    hi_gpio_value last_raw = HI_GPIO_VALUE1;
    hi_gpio_value stable = HI_GPIO_VALUE1;

    uint8_t stable_count = 0;
    uint8_t mode = 0;

    KEY_Init();
    agri_motor_stop_low();

    while (1) {
        if (hi_gpio_get_input_val(HI_GPIO_IDX_14, &raw)
            != HI_ERR_SUCCESS) {
            agri_motor_stop_low();
            mode = 0;
            stable_count = 0;
            last_raw = stable = HI_GPIO_VALUE1;

            usleep(10000);
            continue;
        }

        if (raw != last_raw) {
            last_raw = raw;
            stable_count = 0;
        } else if (stable_count < 3) {
            stable_count++;

            if ((stable_count == 3) && (stable != raw)) {
                stable = raw;

                /* 上拉按键，稳定低电平代表按下。 */
                if (stable == HI_GPIO_VALUE0) {
                    mode = (uint8_t)((mode + 1) % 3);
                    agri_motor_apply(mode);
                }
            }
        }

        /* 每10ms扫描，约30ms稳定后确认状态。 */
        usleep(10000);
    }
}

// void gas_test_task(void)         //可燃气体传感器函数
// {
//   hi_u32 ret;
//   hi_u16 data;
//   hi_float GAS;
//   float gas_mic;
//   while (1)
//   {

//     ret = hi_adc_read(HI_ADC_CHANNEL_6, &data, HI_ADC_EQU_MODEL_4,   //读取ADC数值
//                       HI_ADC_CUR_BAIS_DEFAULT, 0);

//     if (ret != HI_ERR_SUCCESS)
//     {
//       printf("ADC Read Fail\n");
//     }
//     GAS = hi_adc_convert_to_voltage(data);    //将ADC数值转换为电压
//     gas_mic = GAS / 2.5 * 4.7;
//     if (gas_mic < 1.7)            //当转换电压小于1.7V时，oled显示300
//     {
//       systemdata.GAS_MIC = 300;
//     }
//     else
//     {
//       systemdata.GAS_MIC = (gas_mic * 1000 - 1440) / 0.64;  //显示可燃气体浓度
//     }
//   }
// }

void gas_test_task(void)
{
    while (1) {
        uint16_t data = 0;
        uint32_t ret;
        float adc_voltage;
        float gas_voltage;

        usleep(100000);  /* Also limits the rate of failed retries. */
        ret = hi_adc_read(HI_ADC_CHANNEL_6, &data, HI_ADC_EQU_MODEL_4,
                          HI_ADC_CUR_BAIS_DEFAULT, 0);
        if (ret != HI_ERR_SUCCESS) {
            printf("ADC Read Fail: 0x%x\r\n", (unsigned int)ret);
            continue;
        }

        adc_voltage = hi_adc_convert_to_voltage(data);
        gas_voltage = adc_voltage / 2.5f * 4.7f;
        if (gas_voltage < 1.7f) {
            systemdata.GAS_MIC = 300;
        } else {
            systemdata.GAS_MIC = (gas_voltage * 1000.0f - 1440.0f) / 0.64f;
        }
    }
}