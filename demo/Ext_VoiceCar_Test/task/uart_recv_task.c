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
    ret = hi_uart_write(HI_UART_IDX_2, (uint8_t *)str, len);
    if (ret == HI_ERR_FAILURE)
    {
        printf("uart send buff is failed.\r\n");
    }
}

/**
 * @brief  解析JSON数据包
 * @note
 * @param  *pstr:
 * @retval None
 */
static void parse_json_data(uint8_t *pstr)
{
    cJSON *json_root = cJSON_Parse((const char *)pstr);
    if (json_root)
    {
        cJSON *json_status = cJSON_GetObjectItem(json_root, "status");
        if (json_status)
        {
            cJSON *json_distance = cJSON_GetObjectItem(json_status, "distance");
            if (json_distance)
            {
                systemValue.distance = json_distance->valueint;
            }
            json_distance = NULL;

            cJSON *json_carPower = cJSON_GetObjectItem(json_status, "carPower");
            if (json_carPower)
            {
                systemValue.battery_voltage = json_carPower->valueint;
            }
            json_carPower = NULL;

            cJSON *json_L_speed = cJSON_GetObjectItem(json_status, "L_speed");
            if (json_L_speed)
            {
                systemValue.left_motor_speed = json_L_speed->valueint;
            }
            json_L_speed = NULL;

            cJSON *json_R_speed = cJSON_GetObjectItem(json_status, "R_speed");
            if (json_R_speed)
            {
                systemValue.right_motor_speed = json_R_speed->valueint;
            }
            json_R_speed = NULL;
        }
        json_status = NULL;
    }
    cJSON_Delete(json_root);
    json_root = NULL;
}
// 解析语音模块包
void voice_control_data(uint8_t *pstr)
{
    hi_u8 uart_buff[3] = {0};
    char uart_stop[3] = {0x07};
    hi_u8 last_len = 0;
    char num[3];
    float temperature = 0, humidity = 0;
    char cmd[6] = {0xAA, 0X55, 0X01, 0X00, 0x55, 0xAA};
    switch (pstr[0])
    {
    case 0x01:
        set_fan(true); // 风扇打开
        break;
    case 0x00:
        set_fan(false); // 风扇关闭
        break;
    case 0x02: // 获取温湿度
        SHT20_ReadData(&temperature, &humidity);
        cmd[3] = (int)temperature;
        hi_uart_write(HI_UART_IDX_1, (uint8_t *)cmd, sizeof(cmd));
        break;
    case 0x03:
        uart_send_control_cmd(CAR_STATUS_RUN);  // 前进
        systemValue.car_status = CAR_STATUS_RUN;
        sleep(2);
        uart_send_control_status(CAR_STATUS_STOP);
        systemValue.car_status = CAR_STATUS_STOP;
        break;
    case 0x04:
        uart_send_control_cmd(CAR_STATUS_BACK); // 后退
        systemValue.car_status = CAR_STATUS_BACK;
        sleep(2);
        uart_send_control_status(CAR_STATUS_STOP);
        systemValue.car_status = CAR_STATUS_STOP;
        break;
    case 0x05:
        uart_send_control_cmd(CAR_STATUS_LEFT); // 左转
        systemValue.car_status = CAR_STATUS_LEFT;
        osDelay(30);
        uart_send_control_status(CAR_STATUS_STOP);
        systemValue.car_status = CAR_STATUS_STOP;
        break;
    case 0x06:
        uart_send_control_cmd(CAR_STATUS_RIGHT); // 右转
        systemValue.car_status = CAR_STATUS_RIGHT;
        osDelay(30);
        uart_send_control_status(CAR_STATUS_STOP);
        systemValue.car_status = CAR_STATUS_STOP;
        break;
    case 0x07:
        uart_send_control_status(CAR_STATUS_STOP); // 停止
        systemValue.car_status = CAR_STATUS_STOP;
        break;
    case 0x08:
        uart_send_control_status(CAR_STATUS_ON); // 打开电机
        systemValue.car_status = CAR_STATUS_ON;
        break;
    default:
        break;
    }
    memset_s((char *)pstr, sizeof(pstr), 0, sizeof(pstr));
}

void uart2_recv_task(void)
{
    hi_u8 uart_buff[20] = {0};

    hi_u8 last_len = 0;
    while (1)
    {
        // //阻塞接收串口2
        if (memset_s((char *)uart_buff, sizeof(recvBuff), 0, sizeof(uart_buff)) == 0)
        {
            hi_u32 len = hi_uart_read(HI_UART_IDX_2, uart_buff, sizeof(uart_buff));
            if (len > 0)
            {
                memcpy_s((char *)pbuff, len, (char *)uart_buff, len);
                pbuff += len;
                if (len < last_len)
                {
                    pbuff = recvBuff; // 回到recvBuff的头位置
                    printf("buff: %s\n", recvBuff);
                    parse_json_data(recvBuff);
                    memset_s((char *)recvBuff, sizeof(recvBuff), 0, sizeof(recvBuff));
                }
                last_len = len;
            }
        }
    }
}

void uart1_recv_task(void)
{
    hi_u8 voice_buff[20] = {0};
    while (1)
    {
        
        // 阻塞接收串口1
        if (memset_s((char *)voice_buff, sizeof(voice_buff), 0, sizeof(voice_buff)) == 0)
        {
            hi_u32 len = hi_uart_read(HI_UART_IDX_1, voice_buff, sizeof(voice_buff));
            printf("voice_buff:%s\n", voice_buff);
            if (len > 0)
            {
                printf("voice_buff:%s\n", voice_buff);
                voice_control_data(voice_buff);
                memset_s((char *)voice_buff, sizeof(voice_buff), 0, sizeof(voice_buff));
            }
        }
    }
}