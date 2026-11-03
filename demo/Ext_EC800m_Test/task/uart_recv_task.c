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
char ec800m_buff[255] = {0};
char ATBuff[255] = {0};
char ATback[255] = {0};
char ec800m_sendcmd[255] = {0};
char ec800m1_sendcmd[255] = {0};

int m, n, z = 0;
char Gps_d1[20] = {0};
char Gps_d2[20] = {0};

uint8_t ATend = 0x1A;
uint8_t fan;
uint8_t car;
hi_u8 *pbuff = recvBuff;

extern tsATCmds ATCmds[19];
extern uint8_t num;

void uart_send_buff(unsigned char *str, unsigned short len)
{
    hi_u32 ret = 0;
    ret = hi_uart_write(HI_UART_IDX_1, (uint8_t *)str, len);
    if (ret == HI_ERR_FAILURE)
    {
        printf("uart send buff is failed.\r\n");
    }
}

void uart2_send_buff(unsigned char *str, unsigned short len)
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

    while (1)
    {
        // 阻塞接收串口1
        if (memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff)) == 0)
        {
            hi_u32 len = hi_uart_read(HI_UART_IDX_1, ec800m_buff, sizeof(ec800m_buff));
            printf("ec800m_buff:%s\n", ec800m_buff);
            if (len > 0)
            {
                printf("ec800m_buff:%s\n", ec800m_buff);
                printf("ATBuff = %s\n !!!\n", ec800m_buff);
                if (len > 0)
                {
                    if (strstr(ec800m_buff, "CAR_STATUS_RUN") != NULL)
                    {
                        printf("ATBuff %s  \n", ec800m_buff);
                        uart_send_control_cmd(CAR_STATUS_RUN); // 前进
                        systemValue.car_status = CAR_STATUS_RUN;
                        sleep(2);
                        systemValue.car_status = CAR_STATUS_STOP;
                        uart_send_control_status(CAR_STATUS_STOP);

                        memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
                    }
                    else if (strstr(ec800m_buff, "CAR_STATUS_BACK") != NULL)
                    {
                        printf("ATBuff %s  \n", ec800m_buff);
                        uart_send_control_cmd(CAR_STATUS_BACK); // 后退
                        systemValue.car_status = CAR_STATUS_BACK;
                        sleep(2);
                        systemValue.car_status = CAR_STATUS_STOP;
                        uart_send_control_status(CAR_STATUS_STOP);

                        memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
                    }
                    else if (strstr(ec800m_buff, "CAR_STATUS_LEFT") != NULL)
                    {
                        printf("ATBuff %s  \n", ec800m_buff);
                        uart_send_control_cmd(CAR_STATUS_LEFT); // 左转
                        systemValue.car_status = CAR_STATUS_LEFT;
                        osDelay(30);
                        systemValue.car_status = CAR_STATUS_STOP;
                        uart_send_control_status(CAR_STATUS_STOP);

                        memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
                    }
                    else if (strstr(ec800m_buff, "CAR_STATUS_RIGHT") != NULL)
                    {
                        printf("ATBuff %s  \n", ec800m_buff);
                        uart_send_control_cmd(CAR_STATUS_RIGHT); // 右转
                        systemValue.car_status = CAR_STATUS_RIGHT;
                        osDelay(30);
                        systemValue.car_status = CAR_STATUS_STOP;
                        uart_send_control_status(CAR_STATUS_STOP);

                        memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
                    }
                    else if (strstr(ec800m_buff, "CAR_STATUS_ON") != NULL)
                    {
                        printf("ATBuff %s  \n", ec800m_buff);
                        systemValue.car_status = CAR_STATUS_ON;
                        uart_send_control_status(CAR_STATUS_ON);
                        memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
                    }
                    else if ((strstr(ec800m_buff, "AT+QGPSLOC") != NULL)&&(strstr(ec800m_buff, "OK") != NULL))
                    {
                        m = 0;
                        n = 0;
                        for (z = 0; z < 128; z++)
                        {
                            if ((ec800m_buff[z] == ':'))
                            {
                                z = z + 12;
                                while (ec800m_buff[z] != ',')
                                {
                                    Gps_d1[n++] = ec800m_buff[z++];
                                }
                                z++;
                                while (ec800m_buff[z] != ',')
                                {
                                    Gps_d2[m++] = ec800m_buff[z++];
                                }
                            }
                        }            
                    }

                   
                }
            }
             memset_s((char *)ec800m_buff, sizeof(ec800m_buff), 0, sizeof(ec800m_buff));
        }
    }
}
void uart1_send_task(void)
{

    while (1)
    {
        float temperature = 0, humidity = 0;
        SHT20_ReadData(&temperature, &humidity);
        sprintf_s(ec800m_sendcmd, sizeof(ec800m_sendcmd), ATCmds[14].ATSendStr, MQTT_USER_NAME);
        sprintf_s(ec800m1_sendcmd, sizeof(ec800m1_sendcmd), ATCmds[15].ATSendStr, (int)temperature, (int)humidity, (int)systemValue.battery_voltage, get_CurrentCarStatus(systemValue), Gps_d1, Gps_d2);
        uart_send_buff(ec800m_sendcmd, strlen(ec800m_sendcmd));
        printf("ec800m_sendcmd == %s\n", ec800m_sendcmd);
        sleep(1);
        uart_send_buff(ec800m1_sendcmd, strlen(ec800m1_sendcmd));
        sleep(1);
        uart_send_buff(ATCmds[16].ATSendStr, strlen(ATCmds[16].ATSendStr));
        printf("ATCmds[16].ATSendStr = %s\n", ATCmds[16].ATSendStr);
        uart_send_buff(ATCmds[17].ATSendStr, strlen(ATCmds[17].ATSendStr));
        printf("ATCmds[17].ATSendStr = %s\n", ATCmds[17].ATSendStr);
    }
}