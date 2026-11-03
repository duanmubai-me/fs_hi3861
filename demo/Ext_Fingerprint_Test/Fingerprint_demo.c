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
#include <string.h>
#include <stdlib.h>

#include "ohos_init.h"
#include "cmsis_os2.h"

#include "hi_io.h"
#include "hi_gpio.h"
#include "hi_uart.h"
#include "stdbool.h"

#include "hal_bsp_ssd1306.h"
#include "hal_bsp_nfc.h"
#include "hal_bsp_nfc_to_wifi.h"
#include "hal_bsp_wifi.h"
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_aw2013.h"

#include "sys_config.h"
#include "oled_show_log.h"
#include "oled_show_task.h"
#include "uart_recv_task.h"
#include "key_user_task.h"

#include "lwip/netifapi.h"
#include "lwip/sockets.h"
#include "lwip/api_shell.h"

osThreadId_t oled_show_task_id;
osThreadId_t key_user_task_id;
osThreadId_t key_test_task_id;
tn_pcf8574_io_t pcf8574_io;
system_value_t systemdata = {0};
#define TASK_STACK_SIZE (1024 * 5)

/**
 * @brief  串口初始化
 * @note   与STM32单片机之间的串口通信
 * @retval None
 */
void uart_init(void)
{
    uint32_t ret = 0;
    hi_io_set_func(HI_IO_NAME_GPIO_5, HI_IO_FUNC_GPIO_5_UART1_RXD);
    hi_io_set_func(HI_IO_NAME_GPIO_6, HI_IO_FUNC_GPIO_6_UART1_TXD);
       hi_uart_attribute uart_param = {
        .baud_rate = 57600,
        .data_bits = 8,
        .stop_bits = 1,
        .parity = 0,
    };
     ret = hi_uart_init(HI_UART_IDX_1, &uart_param, NULL);
    if (ret != HI_ERR_SUCCESS) {
        printf("hi uart init is faild.\r\n");
    }
}
void SC_peripheral_init(void)
{
    /********************************** 外设初始化 **********************************/
    SSD1306_Init(); // OLED 显示屏初始化
    SSD1306_CLS();  // 清屏
    PCF8574_Init();
    AW2013_Init(); // 三色LED灯的初始化
    AW2013_Control_Red(255);
    AW2013_Control_Green(0);
    AW2013_Control_Blue(0);
    uart_init(); // 串口初始化
}
/**
 * @brief  指纹锁的入口函数
 * @note
 * @retval None
 */
static void fingerprint_example(void)
{
     SC_peripheral_init();
    /********************************** 创建线程 **********************************/
    osThreadAttr_t options;
    options.attr_bits = 0;
    options.cb_mem = NULL;
    options.cb_size = 0;
    options.stack_mem = NULL;
    options.stack_size = TASK_STACK_SIZE;

    /********************************** OLED显示任务 **********************************/
    options.name = "oled_show_task";
    options.priority = osPriorityNormal;
    oled_show_task_id = osThreadNew((osThreadFunc_t)oled_show_task, NULL, &options);
    if (oled_show_task_id != NULL) {
        printf("ID = %d, Create oled_show_task_id is OK!\r\n", oled_show_task_id);
    }
    /********************************** 按键中断任务 **********************************/
    options.name = "key_user_task";
    options.priority = osPriorityNormal;
    key_user_task_id = osThreadNew((osThreadFunc_t)key_user_task, NULL, &options);
    if (key_user_task_id != NULL) {
        printf("ID = %d, Create uart_recv_task_id is OK!\r\n", key_user_task_id);
    }
    /********************************** 指纹锁任务 **********************************/
    options.name = "key_test_task";
    options.priority = osPriorityNormal;
    key_test_task_id = osThreadNew((osThreadFunc_t)key_test_task, NULL, &options);
    if (key_test_task_id != NULL) {
        printf("ID = %d, Create uart_recv_task_id is OK!\r\n", key_test_task_id);
    }
}
SYS_RUN(fingerprint_example);
