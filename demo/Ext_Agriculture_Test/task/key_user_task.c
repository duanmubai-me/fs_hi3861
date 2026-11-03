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

#include <stdio.h>
#include <unistd.h>

#include "ohos_init.h"
#include "cmsis_os2.h"
#include "hi_io.h"
#include "hi_gpio.h"
#include "hal_bsp_pwm_rgb.h"
#include "hal_bsp_sgp30.h"
#include "hi_pwm.h"
#include "hi_adc.h"

#include "hal_bsp_pcf8574.h"
#include "hal_bsp_aw2013.h"
#include "hi_uart.h"
#include "sys_config.h"

#define KEY HI_IO_NAME_GPIO_14    // WiFi模组的IO14引脚
extern system_value_t systemdata; // 系统全局变量
osThreadId_t Task1_ID = 0;        //  任务1 ID
hi_gpio_value val, val_last;      // GPIO的状态值
#define TASK_STACK_SIZE 1024
#define TASK_DELAY_TIME (200 * 1000)
uint32_t i;
uint8_t dblclick;
// extern tn_pcf8574_io_t tmp_io = {0}; // IO扩展芯片的引脚

/**
 * @description: 任务1
 * @param {*}
 * @return {*}
 */
void flame_SGP30_test_task(void)     //火焰传感器，可燃气体传感器函数
{
  while (1)
  {
    uint8_t data = 0;
    PCF8574_Read(&data);           //读取PCF8574IO扩展芯片
    if (data & 0x10)
    {
      systemdata.flame_status = FLAME_STATUS_OFF;
    }
    else
    {
      systemdata.flame_status = FLAME_STATUS_ON;
    }

    if (data & 0x80)
    {
      systemdata.combustible_status = FLAMMABLE_STATUS_OFF;
    }
    else
    {
      systemdata.combustible_status = FLAMMABLE_STATUS_ON;
    }

    SGP30_ReadData(&systemdata.CO2, &systemdata.TVOC);    //获取CO2和TVOC数据
    sleep(2);
  }
}

hi_void gpio_callback(void)
{
  hi_gpio_get_input_val(KEY, &val); 
  if(val==HI_GPIO_VALUE0)
  {
    dblclick++;
  }
}
/**
 * @description: 任务1
 * @param {*}
 * @return {*}
 */
void key_test_task(void)                    //控制电机函数
{
  printf("enter Task 1.......\r\n");
  hi_gpio_init();                                            // GPIO初始化
  hi_io_set_pull(KEY, HI_IO_PULL_UP);                        // 设置GPIO上拉
  hi_io_set_func(KEY, HI_IO_FUNC_GPIO_14_GPIO);              // 设置IO14为GPIO功能
  hi_gpio_set_dir(KEY, HI_GPIO_DIR_IN);                      // 设置GPIO为输入模式
  hi_gpio_register_isr_function(KEY,                         // KEY按键引脚
                                HI_INT_TYPE_EDGE,            // 下降沿检测
                                HI_GPIO_EDGE_FALL_LEVEL_LOW, // 低电平时触发
                                &gpio_callback,              // 触发后调用的回调函数
                                NULL);                       // 回调函数的传参值

  
  while (1)
  {

   if(dblclick == 1)            //正转
   {
        hi_pwm_stop(HI_PWM_PORT_PWM0);
        hi_pwm_stop(HI_PWM_PORT_PWM1);
        hi_pwm_start(HI_PWM_PORT_PWM0, 1000, 1000);
        hi_pwm_start(HI_PWM_PORT_PWM1, 0, 1000);
      }
      if (dblclick == 2)       //反转
      {
        hi_pwm_stop(HI_PWM_PORT_PWM0);
        hi_pwm_stop(HI_PWM_PORT_PWM1);
        hi_pwm_start(HI_PWM_PORT_PWM0, 0, 1000);
        hi_pwm_start(HI_PWM_PORT_PWM1, 1000, 1000);
        
      }
      if(dblclick>=3)          //停止
      {
         hi_pwm_stop(HI_PWM_PORT_PWM0);
        hi_pwm_stop(HI_PWM_PORT_PWM1);
        dblclick=0;
      }

  }
}
void gas_test_task(void)         //可燃气体传感器函数
{
  hi_u32 ret;
  hi_u16 data;
  hi_float GAS;
  float gas_mic;
  while (1)
  {

    ret = hi_adc_read(HI_ADC_CHANNEL_6, &data, HI_ADC_EQU_MODEL_4,   //读取ADC数值
                      HI_ADC_CUR_BAIS_DEFAULT, 0);

    if (ret != HI_ERR_SUCCESS)
    {
      printf("ADC Read Fail\n");
    }
    GAS = hi_adc_convert_to_voltage(data);    //将ADC数值转换为电压
    gas_mic = GAS / 2.5 * 4.7;
    if (gas_mic < 1.7)            //当转换电压小于1.7V时，oled显示300
    {
      systemdata.GAS_MIC = 300;
    }
    else
    {
      systemdata.GAS_MIC = (gas_mic * 1000 - 1440) / 0.64;  //显示可燃气体浓度
    }
  }
}