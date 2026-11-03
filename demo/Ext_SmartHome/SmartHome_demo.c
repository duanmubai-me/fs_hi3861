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
#include "ohos_init.h"
#include "cmsis_os2.h"
#include "hal_bsp_sht20.h"
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_ssd1306.h"
#include "hal_bsp_ssd1306_bmps.h"

#include "hi_io.h"
#include "hi_gpio.h"
#include "hi_uart.h"
#include "stdbool.h"


osThreadId_t Task1_ID; //  任务1 ID


#define TASK_STACK_SIZE (1024 * 5)
#define TASK_DELAY_TIME 3 // s
#define COEFFICIENT_10 10
#define COEFFICIENT_100 100
#define COEFFICIENT_1000 1000
float temp_val, humi_val;
uint8_t Fan_flag=0;


/**
 * @brief  串口初始化
 * @note   与STM32单片机之间的串口通信
 * @retval None
 */
void uart_init(void)
{
    uint32_t ret = 0,ret1 = 0;
    // 初始化串口
    hi_io_set_func(HI_IO_NAME_GPIO_5, HI_IO_FUNC_GPIO_5_UART1_RXD);
    hi_io_set_func(HI_IO_NAME_GPIO_6, HI_IO_FUNC_GPIO_6_UART1_TXD);

    hi_uart_attribute uart_param = {
        .baud_rate = 115200,
        .data_bits = 8,
        .stop_bits = 1,
        .parity = 0,
    };
    ret = hi_uart_init(HI_UART_IDX_1, &uart_param, NULL);
    if (ret != HI_ERR_SUCCESS) {
        printf("hi uart init is faild.\r\n");
    }


}


void GetCommand(void)
{
    hi_u8 voice_buff[20] = {0};
    hi_char len=0;
    char cmd[6] = {0xAA, 0X55, 0X01, 0X00, 0x55, 0xAA};
    while (1)
    {
        // 接收串口1
        if (memset_s((char *)voice_buff, sizeof(voice_buff), 0, sizeof(voice_buff)) == 0)
        {
            len = hi_uart_read(HI_UART_IDX_1, voice_buff, sizeof(voice_buff));
            if (len > 0)
            {
                printf("len=%d, voice_buff:%x\n", len,voice_buff);
                switch (voice_buff[0])
                {
                case 0x01:
                    set_fan(true); // 风扇打开
                    break;
                case 0x00:
                    set_fan(false); // 风扇关闭
                    break;
                case 0x02: // 获取温湿度
                    SHT20_ReadData(&temp_val, &humi_val);
                    cmd[3] = (int)temp_val;
                    hi_uart_write(HI_UART_IDX_1, (uint8_t *)cmd, sizeof(cmd));
                    break;
                }
                memset_s((char *)voice_buff, sizeof(voice_buff), 0, sizeof(voice_buff));
            }
        }
    }
}

static void smartHome_demo(void)
{
    printf("Enter smartTemp_demo()!");
    uart_init();
    PCF8574_Init();                     // 初始化IO扩展芯片
    SHT20_Init();   // SHT20初始化
    SSD1306_CLS();  // 清屏

    osThreadAttr_t options;
    options.name = "Task1";              // 任务的名字
    options.attr_bits = 0;               // 属性位
    options.cb_mem = NULL;               // 堆空间地址
    options.cb_size = 0;                 // 堆空间大小
    options.stack_mem = NULL;            // 栈空间地址
    options.stack_size = TASK_STACK_SIZE;       // 栈空间大小 单位:字节
    options.priority = osPriorityNormal; // 任务的优先级

    Task1_ID = osThreadNew((osThreadFunc_t)GetCommand, NULL, &options); // 创建任务1
    if (Task1_ID != NULL) {
        printf("ID = %d, Create Task1_ID is OK!\n", Task1_ID);
    }
}
SYS_RUN(smartHome_demo);