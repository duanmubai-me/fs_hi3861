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
#include "udp_send_task.h"
#include "udp_recv_task.h"
#include "uart_recv_task.h"

#include "lwip/netifapi.h"
#include "lwip/sockets.h"
#include "lwip/api_shell.h"


osThreadId_t oled_show_task_id;
osThreadId_t uart_recv_task_id;
osThreadId_t uart1_recv_task_id;
osThreadId_t uart1_send_task_id;
osThreadId_t udp_send_task_id;
osThreadId_t udp_recv_task_id;
tn_pcf8574_io_t pcf8574_io;



system_value_t systemValue = {0}; // 系统全局变量

tsATCmds ATCmds[] = {
    {"AT\r\n", "OK"},
    {"AT+QGPSCFG=\"outport\",\"uartdebug\"\r\n","OK"},
    {"AT+QGPSCFG=\"nmeasrc\",1\r\n","OK"},
    {"AT+QGPSCFG=\"gpsnmeatype\",63\r\n","OK"},
    {"AT+QGPSCFG=\"gnssconfig\",0\r\n","OK"},
    {"AT+QGPSCFG=\"autogps\",0\r\n","OK"},
    {"AT+QGPSCFG=\"apflash\",0\r\n","OK"},
    {"AT+QGPS=1\r\n","OK"},
    {"AT+CSQ\r\n", "OK"},
    {"AT+CPIN?\r\n", "OK"},
    {"AT+CREG?\r\n", "OK"},
    {"AT+CGATT?\r\n", "OK"},
    {"AT+QMTOPEN=0,\"%s\",1883\r\n", "OK"},
    {"AT+QMTCONN=0,\"%s\",\"%s\",\"%s\"\r\n", "OK"},
    {"AT+QMTPUB=0,0,0,0,\"$oc/devices/%s/sys/properties/report\"\r\n", ">"},
    {"{\"services\":[{\"service_id\":\"attribute\",\"properties\":{\"fan\":\"OFF\",\"temperature\":%d,\"humidity\":%d,\"voltage\":%d,\"car\":\"%s\",\"Latitude\":\"%s\",\"Longitude\":\"%s\"}}]}","OK"},
    {"\x1A\0","OK"},
    {"AT+QGPSLOC=0\r\n","OK"},
    {"AT+QMTDISC=0\r\n", "OK"},
};
#define KEY HI_IO_NAME_GPIO_14 // WiFi模组的IO14引脚
uint32_t dblclick;
uint8_t i = 1, j = 0;
hi_gpio_value val, val_last; // GPIO的状态值
uint8_t num;
uint8_t wififlag;
uint8_t ec800mflag;

char ATrecvBuff[255] = {0};
char ec800m_sendbuff[255] = {0};

#define TASK_STACK_SIZE (1024 * 5)

/**
 * @brief  串口初始化
 * @note   与STM32单片机之间的串口通信
 * @retval None
 */
void uart_init(void)
{
    uint32_t ret = 0, ret1 = 0;
    // 初始化串口
    hi_io_set_func(HI_IO_NAME_GPIO_5, HI_IO_FUNC_GPIO_5_UART1_RXD);
    hi_io_set_func(HI_IO_NAME_GPIO_6, HI_IO_FUNC_GPIO_6_UART1_TXD);

    hi_io_set_func(HI_IO_NAME_GPIO_11, HI_IO_FUNC_GPIO_11_UART2_TXD);
    hi_io_set_func(HI_IO_NAME_GPIO_12, HI_IO_FUNC_GPIO_12_UART2_RXD);

    hi_uart_attribute uart_param = {
        .baud_rate = 115200,
        .data_bits = 8,
        .stop_bits = 1,
        .parity = 0,
    };

    ret = hi_uart_init(HI_UART_IDX_2, &uart_param, NULL);
    if (ret != HI_ERR_SUCCESS)
    {
        printf("hi uart init is faild.\r\n");
    }
    ret1 = hi_uart_init(HI_UART_IDX_1, &uart_param, NULL);
    if (ret1 != HI_ERR_SUCCESS)
    {
        printf("hi uart init is faild.\r\n");
    }
}

int nfc_connect_wifi_init(void)
{
    /********************************* NFC碰一碰联网 *********************************/
    uint8_t ndefLen = 0;      // ndef包的长度
    uint8_t ndef_Header = 0;  // ndef消息开始标志位-用不到
    uint32_t result_code = 0; // 函数的返回值
    // 读整个数据的包头部分，读出整个数据的长度
    SSD1306_CLS(); // 清屏
    if (result_code = NT3HReadHeaderNfc(&ndefLen, &ndef_Header) != true)
    {
        printf("NT3HReadHeaderNfc is failed. result_code = %d\r\n", result_code);
        return -1;
    }
    ndefLen += NDEF_HEADER_SIZE; // 加上头部字节
    if (ndefLen <= NDEF_HEADER_SIZE)
    {
        printf("ndefLen <= 2\r\n");
        return -1;
    }

    uint8_t *ndefBuff = (uint8_t *)malloc(ndefLen + 1);
    if (ndefBuff == NULL)
    {
        printf("ndefBuff malloc is Falied!\r\n");
        return -1;
    }

    if (result_code = get_NDEFDataPackage(ndefBuff, ndefLen) != HI_ERR_SUCCESS)
    {
        printf("get_NDEFDataPackage is failed. result_code = %d\r\n", result_code);
        return -1;
    }

    printf("start print ndefBuff.\r\n");
    for (size_t i = 0; i < ndefLen; i++)
    {
        printf("0x%x ", ndefBuff[i]);
    }
    printf("\n");

    if (NFC_configuresWiFiNetwork(ndefBuff) != WIFI_SUCCESS)
    {
        printf("nfc connect wifi is failed!\r\n");
        oled_consle_log("wifi no.");
        sleep(1);
        SSD1306_CLS(); // 清屏
    }
    oled_consle_log("wifi yes.");
    return 0;
}

int SC_udp_init(void)
{
    uint32_t result_code = 0; // 函数的返回值
    /********************************** 创建UDP服务端 **********************************/
    printf("wifi IP: %s", WiFi_GetLocalIP());
    // 创建socket
    if ((systemValue.udp_socket_fd = socket(AF_INET, SOCK_DGRAM, 0)) == -1)
    {
        printf("create socket failed!\r\n");
        return -1;
    }

    // 命名套接字
    struct sockaddr_in local;
    local.sin_family = AF_INET;                           // IPV4
    local.sin_port = htons(UDP_PORT);                     // 端口号
    local.sin_addr.s_addr = inet_addr(WiFi_GetLocalIP()); // 使用本地IP地址进行创建UDP服务端

    // 绑定端口号
    result_code = bind(systemValue.udp_socket_fd, (const struct sockaddr *)&local, sizeof(local));
    if (result_code < 0)
    {
        printf("udp server bind IP is failed.\r\n");
        return -1;
    }
    else
    {
        printf("udp server bind IP is success.");
    }

    SSD1306_CLS(); // 清屏
    return 0;
}

void ec800m_connect_4g_gps_init(void)
{
    int num = 0;

    while (num <14)
    {

        if (num == 12)
        {
            if (sprintf_s(ec800m_sendbuff, sizeof(ec800m_sendbuff), ATCmds[12].ATSendStr, HUWWEIYUN_MQTT_IP) > 0)
                uart_send_buff(ec800m_sendbuff, strlen(ec800m_sendbuff));
            printf("ec800m_sendbuff == %s\n", ec800m_sendbuff);
        }
        else if (num == 13)
        {
            memset_s(ec800m_sendbuff, sizeof(ec800m_sendbuff), 0, sizeof(ec800m_sendbuff));
            if (sprintf_s(ec800m_sendbuff, sizeof(ec800m_sendbuff), ATCmds[13].ATSendStr, MQTT_CLIENT_ID, MQTT_USER_NAME, MQTT_PASS_WORD) > 0)
                uart_send_buff(ec800m_sendbuff, strlen(ec800m_sendbuff));
            printf("ec800m_sendbuff == %s\n", ec800m_sendbuff);
        }
        else
        {
            uart_send_buff(ATCmds[num].ATSendStr, strlen(ATCmds[num].ATSendStr));
        }
        osDelay(50);
        if (memset_s((char *)ATrecvBuff, sizeof(ATrecvBuff), 0, sizeof(ATrecvBuff)) == 0)
        {
            hi_u32 len = hi_uart_read(HI_UART_IDX_1, ATrecvBuff, sizeof(ATrecvBuff));
            if (len > 0)
            {
                if (strstr(ATrecvBuff, ATCmds[num].ATRecStr) != NULL)
                {
                    printf("EC800M %s succeed !!!\n", ATCmds[num].ATSendStr);
                    memset_s((char *)ATrecvBuff, sizeof(ATrecvBuff), 0, sizeof(ATrecvBuff));
                    num++;
                }
                else
                {
                    printf("EC800M %s fail !!!\n", ATCmds[num].ATSendStr);
                    memset_s((char *)ATrecvBuff, sizeof(ATrecvBuff), 0, sizeof(ATrecvBuff));
                }
            }
        }
    }
}

hi_void gpio_callback(void)
{
}
/**
 * @description: 任务1
 * @param {*}
 * @return {*}
 */
void key_test_task(void)
{
    printf("enter Task 1.......\r\n");
    hi_gpio_init();                                             // GPIO初始化
    hi_io_set_pull(KEY, HI_IO_PULL_UP);                         // 设置GPIO上拉
    hi_io_set_func(KEY, HI_IO_FUNC_GPIO_14_GPIO);               // 设置IO14为GPIO功能
    hi_gpio_set_dir(KEY, HI_GPIO_DIR_IN);                       // 设置GPIO为输入模式
    hi_gpio_register_isr_function(KEY,                          // KEY按键引脚
                                  HI_INT_TYPE_EDGE,             // 下降沿检测
                                  HI_GPIO_EDGE_RISE_LEVEL_HIGH, // 低电平时触发
                                  &gpio_callback,               // 触发后调用的回调函数
                                  NULL);                        // 回调函数的传参值

    while (i)
    {
        hi_gpio_get_input_val(KEY, &val);
        if (val == HI_GPIO_VALUE0)
        {
            while (!val)
            {
                hi_gpio_get_input_val(KEY, &val);
                dblclick++;
                printf("dblclick == %d\n", dblclick);
            }

            if (dblclick < 300)
            {
                if (nfc_connect_wifi_init() == -1)
                {
                    return;
                }
                if (SC_udp_init() == -1)
                {
                    return;
                }
                i = 0;
                wififlag = 1;
            }
            if (dblclick > 300)
            {
                ec800m_connect_4g_gps_init();
                i = 0;
                ec800mflag = 1;
            }
        }
        dblclick = 0;
    }
}

void SC_peripheral_init(void)
{
    /********************************** 外设初始化 **********************************/
    SSD1306_Init(); // OLED 显示屏初始化
    SSD1306_CLS();  // 清屏
    nfc_Init();     // NFC 初始化
    // 外设的初始化
    PCF8574_Init();
    AW2013_Init(); // 三色LED灯的初始化
    AW2013_Control_Red(0);
    AW2013_Control_Green(0);
    AW2013_Control_Blue(0);
    uart_init(); // 串口初始化
    SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_1, "short: WIFI", TEXT_SIZE_16);
    SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_2, "long: 4G(3s)", TEXT_SIZE_16);
    
}
/**
 * @brief  智能小车的入口函数
 * @note
 * @retval None
 */
static void smartCar_example(void)
{
    SC_peripheral_init();
    key_test_task();
    /********************************** 创建线程 **********************************/
    osThreadAttr_t options;
    options.attr_bits = 0;
    options.cb_mem = NULL;
    options.cb_size = 0;
    options.stack_mem = NULL;
    options.stack_size = TASK_STACK_SIZE;

    /********************************** UART2接收任务 **********************************/
    options.name = "uart_recv_task";
    options.priority = osPriorityNormal;
    uart_recv_task_id = osThreadNew((osThreadFunc_t)uart2_recv_task, NULL, &options);
    if (uart_recv_task_id != NULL)
    {
        printf("ID = %d, Create uart_recv_task_id is OK!\r\n", uart_recv_task_id);
    }
     /********************************** OLED显示任务 **********************************/
    options.name = "oled_show_task";
    options.priority = osPriorityNormal;
    oled_show_task_id = osThreadNew((osThreadFunc_t)oled_show_task, NULL, &options);
    if (oled_show_task_id != NULL)
    {
        printf("ID = %d, Create oled_show_task_id is OK!\r\n", oled_show_task_id);
    }
  
    /********************************** UART1接收任务 **********************************/
    options.name = "uart1_recv_task";
    options.priority = osPriorityNormal;
    uart1_recv_task_id = osThreadNew((osThreadFunc_t)uart1_recv_task, NULL, &options);
    if (uart1_recv_task_id != NULL)
    {
        printf("ID = %d, Create uart1_recv_task_id is OK!\r\n", uart1_recv_task_id);
    }
      /********************************** UART1发送任务 **********************************/
    options.name = "uart1_send_task";
    options.priority = osPriorityNormal;

    uart1_send_task_id = osThreadNew((osThreadFunc_t)uart1_send_task, NULL, &options);
    if (uart1_send_task_id != NULL)
    {
        printf("ID = %d, Create uart1_send_task_id is OK!\r\n", uart1_send_task_id);
    }
    /********************************** UDP发送任务 **********************************/
    options.name = "udp_send_task";
    options.priority = osPriorityNormal;
    if (wififlag == 1)
    {
        udp_send_task_id = osThreadNew((osThreadFunc_t)udp_send_task, NULL, &options);
        if (udp_send_task_id != NULL)
        {
            printf("ID = %d, Create udp_send_task_id is OK!\r\n", udp_send_task_id);
        }
    }
    /********************************** UDP接收任务 **********************************/
    options.name = "udp_recv_task";
    options.priority = osPriorityNormal1;
    if (wififlag == 1)
    {
        udp_recv_task_id = osThreadNew((osThreadFunc_t)udp_recv_task, NULL, &options);
        if (udp_recv_task_id != NULL)
        {
            printf("ID = %d, Create udp_recv_task_id is OK!\r\n", udp_recv_task_id);
        }
    }
}
SYS_RUN(smartCar_example);
