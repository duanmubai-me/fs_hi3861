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
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_aw2013.h"
#include "hi_uart.h"
#include "sys_config.h"

#define KEY HI_IO_NAME_GPIO_14    // WiFi模组的IO14引脚
extern system_value_t systemdata; // 系统全局变量
hi_gpio_value val;                // GPIO的状态值
#define TASK_STACK_SIZE 1024
#define TASK_DELAY_TIME (200 * 1000)

hi_u8 buff[20] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X03, 0X0d, 0X00, 0X11};

static int i = 0, j = 0;
hi_void gpio_callback(void)
{
}
/**
 * @description: 任务1
 * @param {*}
 * @return {*}
 */
void key_user_task(void)
{
    hi_gpio_init(); // GPIO初始化
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

        hi_gpio_get_input_val(KEY, &val); // 获取GPIO引脚的状态
        if (val == HI_GPIO_VALUE0)
        {
            systemdata.flag = 1;
            printf("flag == %d\n", systemdata.flag);
        }
    }
}
void key_test_task(void)
{
    hi_u32 len = 0;
    char cmd_merge[12] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X03, 0X05, 0X00, 0X09};                                 // 合并特征
    char cmd_input[12] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X03, 0X01, 0X00, 0X05};                                 // 录入图像
    char cmd_generate1[13] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X04, 0X02, 0X01, 0X00, 0X08};                       // 生成特征到缓冲区1
    char cmd_generate2[13] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X04, 0X02, 0X02, 0X00, 0X09};                       // 生成特征到缓冲区2
    char cmd_library[15] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X06, 0X06, 0X01, 0X00, 0X01, 0X00, 0X0F};             // 生成指纹库
    char cmd_compare[17] = {0xEF, 0X01, 0XFF, 0XFF, 0xFF, 0xFF, 0X01, 0X00, 0X08, 0X04, 0X02, 0X00, 0X01, 0X00, 0X01, 0X00, 0X11}; // 指纹对比
    while (1)
    {
        if (systemdata.flag == 1)        //判断按键是否按下
        {
            AW2013_Control_Blue(255);
            AW2013_Control_Red(0);
            AW2013_Control_Green(0);
            while (buff[9] != 0x00)     //判断返回数据是否录入成功
            {

                systemdata.key_status = 0;
                systemdata.key_pattern = KEY_PATTERN_INPUT;
                for (j = 0; j < 2; j++)
                {
                    uart_send_buff(cmd_input, sizeof(cmd_input));
                    osDelay(10);
                    len = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));

                    if ((len > 0) && (buff[9] == 0x00))
                    { 
                        if (j == 0)            //录入特征到缓冲区1
                        {
                            memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                            uart_send_buff(cmd_generate1, sizeof(cmd_generate1));
                            len = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                        }
                        else                   //录入特征到缓冲区2
                        {
                            memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                            uart_send_buff(cmd_generate2, sizeof(cmd_generate2));
                            len = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                        }
                    }
                }
            }
            if (len > 0 && buff[9] == 0x00)
            {
                memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                uart_send_buff(cmd_merge, sizeof(cmd_merge));             //发送合并命令
                len = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                if (len > 0 && buff[9] == 0x00)
                {
                    memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                    uart_send_buff(cmd_library, sizeof(cmd_library));
                    len = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                    if (buff[9] == 0x00)
                    {
                        systemdata.flag = 0;                   
                        AW2013_Control_Blue(0);
                        AW2013_Control_Red(0);
                        AW2013_Control_Green(255);
                        sleep(2);
                    }
                }
            }
        }

        if (systemdata.flag == 0)         // 指纹锁测试
        {
            systemdata.key_pattern = KEY_PATTERN_TEST;
            systemdata.key_status = KEY_STATUS_OFF;
            AW2013_Control_Blue(0);
            AW2013_Control_Green(0);
            AW2013_Control_Red(255);
            buff[9] = 0x01;
            while (buff[9] != 0x00 && systemdata.flag == 0)
            {
                uart_send_buff(cmd_input, sizeof(cmd_input));
                osDelay(10);
                hi_u32 len1 = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                if (len1 > 0 && buff[9] == 0x00)
                {
                    memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                    uart_send_buff(cmd_generate2, sizeof(cmd_generate2));
                    hi_u32 len2 = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                    if (len2 > 0)
                    {
                        if (buff[9] == 0x00)
                        {
                            memset_s((char *)buff, sizeof(buff), 0, sizeof(buff));
                            uart_send_buff(cmd_compare, sizeof(cmd_compare));
                            hi_u32 len3 = hi_uart_read(HI_UART_IDX_1, buff, sizeof(buff));
                            if (buff[9] == 0x00)
                            {

                                buff[9] = 0x01;
                                set_D2(true);
                                systemdata.key_status = KEY_STATUS_ON;
                                AW2013_Control_Blue(0);
                                AW2013_Control_Green(255);
                                AW2013_Control_Red(0);
                            }
                            else if (buff[9] == 0x09)
                            {
                                systemdata.key_status = KEY_STATUS_OFF;
                                set_buzzer(true); // 关闭蜂鸣器
                                osDelay(20);
                                set_buzzer(false); // 关闭蜂鸣器
                                osDelay(20);
                                set_buzzer(true); // 关闭蜂鸣器
                                osDelay(20);
                                set_buzzer(false); // 关闭蜂鸣器
                                osDelay(20);
                            }
                        }
                    }
                }
                else if (buff[9] == 0x02)
                {
                    set_D2(false);
                    systemdata.key_status = KEY_STATUS_OFF;
                    AW2013_Control_Blue(0);
                    AW2013_Control_Green(0);
                    AW2013_Control_Red(255);
                }
            }
        }
        i = 0;
    }
}