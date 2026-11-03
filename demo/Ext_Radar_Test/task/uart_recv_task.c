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

#include "uart_recv_task.h"
#include "sys_config.h"
#include "hi_uart.h"
#include "hi_io.h"
#include "hi_gpio.h"
#include "stdbool.h"

#include <unistd.h>
#include <string.h>
#include <stdlib.h>

#include "cmsis_os2.h"
#include "cJSON.h"

hi_u8 recvBuff[200] = {0};
hi_u8 *pbuff = recvBuff;

void uart_send_buff(unsigned char *str, unsigned short len)
{
    hi_u32 ret = 0;
    ret = hi_uart_write(HI_UART_IDX_1, (uint8_t *)str, len);
    if (ret == HI_ERR_FAILURE)
    {
        printf("uart send buff is failed.\r\n");
    }
}
void rado_control_data(unsigned char *pstr)                      // 雷达控制函数
{
    char cmd_on[7] = {0xAA, 0XAA, 0X87, 0X21, 0x00, 0x55, 0x55};    //打开捅盖命令
    char cmd_off[7] = {0xAA, 0XAA, 0X00, 0X21, 0x00, 0x55, 0x55};   //关闭捅盖命令
    if (((pstr[3]+(pstr[4]<<8)) < 0x32))                  //判断是否有人并且人体距离雷达小于50cm
    {
        systemValue.radar_status=Radar_STATUS_ON;       //改变桶盖的状态        
        uart_send_buff(cmd_on, sizeof(cmd_on));         //发送命令
    }
    else
    {
        systemValue.radar_status=Radar_STATUS_OFF;
        uart_send_buff(cmd_off, sizeof(cmd_off));
    }
    memset_s((char *)pstr, sizeof(pstr), 0, sizeof(pstr));
}

void uart1_recv_task(void)                 //接收数据
{
    hi_u8 rado_buff[20] = {0};
    uint32_t buff_sum;
    while (1)
    {
        // 阻塞接收串口1
        if (memset_s((char *)rado_buff, sizeof(rado_buff), 0, sizeof(rado_buff)) == 0)
        {
                hi_u32 len = hi_uart_read(HI_UART_IDX_1, rado_buff, sizeof(rado_buff));    //接收人体雷达数据
                printf("rado_buff:%s\n", rado_buff);
                if (len > 0)
                {
                    printf("rado_buff:%s\n", rado_buff);
                    buff_sum=rado_buff[3]+(rado_buff[4]<<8);     //赋值变量
                }
            systemValue.distance=buff_sum;       //将数据赋值给oled屏的显示变量
            rado_control_data(rado_buff);             //雷达控制函数
        }
    }
}