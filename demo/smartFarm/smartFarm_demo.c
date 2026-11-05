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
#include "hi_errno.h"

#include "hi_io.h"
#include "hi_gpio.h"
#include "hi_uart.h"
#include "stdbool.h"

#include "cJSON.h"
#include "hi_nv.h"
#include "sys_config.h"

#include "hal_bsp_wifi.h"
#include "hal_bsp_mqtt.h"
#include "hal_bsp_key.h"
#include "hal_bsp_sht20.h"
#include "hal_bsp_ssd1306.h"
#include "hal_bsp_nfc.h"
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_nfc_to_wifi.h"

#include "hal_bsp_aw2013.h"
#include "hal_bsp_pwm_rgb.h"
#include "hal_bsp_sgp30.h"

#include "mqtt_send_task.h"
#include "mqtt_recv_task.h"
#include "sensor_collect_task.h"
#include "oled_show_log.h"

#include "oled_show_task.h"
#include "uart_recv_task.h"
#include "key_user_task.h"

#include "lwip/netifapi.h"
#include "lwip/sockets.h"
#include "lwip/api_shell.h"

#include "cmsis_os2.h"
#include "mutex_lock.h"

#define TASK_STACK_SIZE (5 * 1024)
#define TASK_INIT_DELAY 1 // s

osThreadId_t mqtt_send_task_id;      // mqtt 发布数据任务ID
osThreadId_t mqtt_recv_task_id;      // mqtt 接收数据任务ID
osThreadId_t sensor_collect_task_id; // 传感器采集任务ID

osThreadId_t oled_show_task_id;
osThreadId_t uart_recv_task_id;
osThreadId_t uart1_recv_task_id;
osThreadId_t udp_send_task_id;
osThreadId_t udp_recv_task_id;
osThreadId_t key_user_task_id;
osThreadId_t key_test_task_id;
osThreadId_t gas_test_task_id;
osThreadId_t flame_task_id;
osThreadId_t sgp30_task_id;
tn_pcf8574_io_t pcf8574_io;
system_value_t systemdata = {0};

/**
 * @brief  串口初始化
 * @note   与STM32单片机之间的串口通信
 * @retval None
 */
void uart_init(void)
{
    uint32_t ret = 0,ret1 = 0;
    hi_io_set_func(HI_IO_NAME_GPIO_11, HI_IO_FUNC_GPIO_11_UART2_TXD);
    hi_io_set_func(HI_IO_NAME_GPIO_12, HI_IO_FUNC_GPIO_12_UART2_RXD);
       hi_uart_attribute uart_param1 = {
        .baud_rate = 57600,
        .data_bits = 8,
        .stop_bits = 1,
        .parity = 0,
    };
     ret1 = hi_uart_init(HI_UART_IDX_2, &uart_param1, NULL);
    if (ret1 != HI_ERR_SUCCESS) {
        printf("hi uart init is faild.\r\n");
    }
}

void SF_peripheral_init(void)
{
    // 外设的初始化
    KEY_Init();                         // 按键初始化
    PCF8574_Init();                     // 初始化IO扩展芯片
    SHT20_Init();
    SSD1306_Init(); // OLED 显示屏初始化
    SSD1306_CLS();  // 清屏
    SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_0, " Smart Farm", TEXT_SIZE_16);
    nfc_Init();

    AW2013_Init(); // 三色LED灯的初始化
    AW2013_Control_Red(0);
    AW2013_Control_Green(0);
    AW2013_Control_Blue(0);
    uart_init(); // 串口初始化
    pwm_rgb_init();
    pwm1_rgb_init();
    SGP30_Init();
    usleep(TASK_INIT_DELAY);
}
int nfc_connect_wifi_init(void)
{
    // 通过NFC芯片进行连接WiFi
    uint8_t ndefLen = 0;      // ndef包的长度
    uint8_t ndef_Header = 0;  // ndef消息开始标志位-用不到
    uint32_t result_code = 0; // 函数的返回值
    oled_consle_log("===start nfc===");

    // 读整个数据的包头部分，读出整个数据的长度
    if (result_code = NT3HReadHeaderNfc(&ndefLen, &ndef_Header) != true) {
        printf("NT3HReadHeaderNfc is failed. result_code = %d\r\n", result_code);
        return -1;
    }
    ndefLen += NDEF_HEADER_SIZE; // 加上头部字节
    if (ndefLen <= NDEF_HEADER_SIZE) {
        printf("ndefLen <= 2\r\n");
        return -1;
    }
    
    uint8_t *ndefBuff = (uint8_t *)malloc(ndefLen + 1);
    if (ndefBuff == NULL) {
        printf("ndefBuff malloc is Falied!\r\n");
        return -1;
    }
    if (result_code = get_NDEFDataPackage(ndefBuff, ndefLen) != HI_ERR_SUCCESS) {
        printf("get_NDEFDataPackage is failed. result_code = %d\r\n", result_code);
        return -1;
    }
    // 打印读出的数据
    printf("start print ndefBuff.\r\n");
    for (size_t i = 0; i < ndefLen; i++) {
        printf("0x%x ", ndefBuff[i]);
    }
    oled_consle_log("=== end nfc ===");
    sleep(TASK_INIT_DELAY);

    oled_consle_log("== start wifi==");
    // 连接WiFi
    while (NFC_configuresWiFiNetwork(ndefBuff) != WIFI_SUCCESS) {
        printf("nfc connect wifi is failed!\r\n");
        oled_consle_log("=== wifi no ===");
        sleep(TASK_INIT_DELAY);
        SSD1306_CLS(); // 清屏
    }
    printf("nfc connect wifi is SUCCESS\r\n");
    oled_consle_log("===wifi  yes===");
    sleep(TASK_INIT_DELAY);
    return 0;
}
int mqtt_init(void)
{
    // 连接MQTT服务器
    while (MQTTClient_connectServer(SERVER_IP_ADDR, SERVER_IP_PORT) != WIFI_SUCCESS) {
        printf("mqttClient_connectServer\r\n");
        oled_consle_log("==mqtt ser no==");
        sleep(TASK_INIT_DELAY);
        SSD1306_CLS(); // 清屏
    }
    printf("mqttClient_connectServer\r\n");
    oled_consle_log("==mqtt ser yes=");
    sleep(TASK_INIT_DELAY);

    // 初始化MQTT客户端
    while (MQTTClient_init(MQTT_CLIENT_ID, MQTT_USER_NAME, MQTT_PASS_WORD) != WIFI_SUCCESS) {
        printf("mqttClient_init\r\n");
        oled_consle_log("==mqtt cli no==");
        sleep(TASK_INIT_DELAY);
        SSD1306_CLS();
        // 服务器断开后重新建链，否则一直在死 socket 上重试
        MQTTClient_unConnectServer();
        MQTTClient_connectServer(SERVER_IP_ADDR, SERVER_IP_PORT);
    }
    printf("mqttClient_init\r\n");
    oled_consle_log("==mqtt cli yes=");
    sleep(TASK_INIT_DELAY);

    // 订阅MQTT主题
    while (MQTTClient_subscribe(MQTT_TOPIC_SUB_COMMANDS) != 0) {
        printf("mqttClient_subscribe\r\n");
        oled_consle_log("==mqtt sub no==");
        sleep(TASK_INIT_DELAY);
        SSD1306_CLS(); // 清屏
    }
    printf("mqttClient_subscribe\r\n");
    oled_consle_log("=mqtt sub yes==");
    sleep(TASK_INIT_DELAY);
    SSD1306_CLS(); // 清屏

    return 0;
}

static void smartFarm_Project_example(void)
{
    printf("Enter smartFarm_Project_example()!\r\n");
    p_MQTTClient_sub_callback = &mqttClient_sub_callback;
    MUTEX_Init();
    if (g_oled_mutex == NULL) {
        return;
    }
    SF_peripheral_init();

    uint8_t nv_data[64] = {0};
    hi_nv_save_sensor_threshold saved = {0};

    /* 首次使用时的默认阈值，可自行修改 */
    sys_msg_data.nvFlash.humi_lower = 30;
    sys_msg_data.nvFlash.humi_upper = 70;

    if (hi_nv_read(0xA0, nv_data, sizeof(nv_data), 0)
        == HI_ERR_SUCCESS) {
        memcpy(&saved, nv_data, sizeof(saved));

        if (saved.humi_lower < saved.humi_upper &&
            saved.humi_upper <= 100) {
            sys_msg_data.nvFlash.humi_lower = saved.humi_lower;
            sys_msg_data.nvFlash.humi_upper = saved.humi_upper;
        }
    }

    /* 在联网之前启动火情与SGP30任务 */
    osThreadAttr_t local_options = {
        .stack_size = TASK_STACK_SIZE,
        .priority = osPriorityNormal,
    };

    local_options.name = "fire_detect_task";
    flame_task_id = osThreadNew(fire_detect_task, NULL, &local_options);

    local_options.name = "sgp30_task";
    sgp30_task_id = osThreadNew(sgp30_task, NULL, &local_options);
    if (nfc_connect_wifi_init() == -1) {
        return ;
    }
    // if (WiFi_connectHotspots("IoTtest", "114514985211")!= WIFI_SUCCESS) {
    // printf("WiFi connect failed\n");
    // return;
    // }
    mqtt_init();
    // NV值读出
    // result_code = hi_factory_nv_read(NV_ID, &sys_msg_data.nvFlash, sizeof(hi_nv_save_sensor_threshold), 0);
    // if (result_code != HI_ERR_SUCCESS) {
    //     printf("hi_factory_nv_read is Falied! result_code = %d\r\n", result_code);
    // }
    // else {
    //     printf("nv read: humi_upper=%d, humi_lower=%d autoMode=%d\r\n",
    //             sys_msg_data.nvFlash.humi_upper,
    //             sys_msg_data.nvFlash.humi_lower,
    //             sys_msg_data.nvFlash.smartControl_flag);
    // }
    //  创建线程
    osThreadAttr_t options;
    options.name = "mqtt_send_task";
    options.attr_bits = 0;
    options.cb_mem = NULL;
    options.cb_size = 0;
    options.stack_mem = NULL;
    options.stack_size = TASK_STACK_SIZE;
    options.priority = osPriorityNormal;
    mqtt_send_task_id = osThreadNew((osThreadFunc_t)mqtt_send_task, NULL, &options);
    if (mqtt_send_task_id != NULL) {
        printf("ID = %d, Create mqtt_send_task_id is OK!\r\n", mqtt_send_task_id);
    }

    options.name = "mqtt_recv_task";
    mqtt_recv_task_id = osThreadNew((osThreadFunc_t)mqtt_recv_task, NULL, &options);
    if (mqtt_recv_task_id != NULL) {
        printf("ID = %d, Create mqtt_recv_task_id is OK!\r\n", mqtt_recv_task_id);
    }

    options.name = "sensor_collect_task";
    sensor_collect_task_id = osThreadNew((osThreadFunc_t)sensor_collect_task, NULL, &options);
    if (sensor_collect_task_id != NULL) {
        printf("ID = %d, Create sensor_collect_task_id is OK!\r\n", sensor_collect_task_id);
    }

    /********************************** OLED显示任务 **********************************/
    options.name = "oled_show_task";
    options.priority = osPriorityNormal;
    oled_show_task_id = osThreadNew((osThreadFunc_t)oled_show_task, NULL, &options);
    if (oled_show_task_id != NULL) {
        printf("ID = %d, Create oled_show_task_id is OK!\r\n", oled_show_task_id);
    }
    /********************************** 控制电机任务 **********************************/
    options.name = "key_user_task";
    options.priority = osPriorityNormal;
    key_test_task_id = osThreadNew((osThreadFunc_t)key_test_task, NULL, &options);
    if (key_test_task_id != NULL) {
        printf("ID = %d, Create uart_recv_task_id is OK!\r\n", key_test_task_id);
    }


    /********************************** 燃气传感器任务 **********************************/
    options.name = "gas_user_task";
    options.priority = osPriorityNormal;
    gas_test_task_id = osThreadNew((osThreadFunc_t)gas_test_task, NULL, &options);
    if (gas_test_task_id != NULL) {
        printf("ID = %d, Create uart_recv_task_id is OK!\r\n", gas_test_task_id);
    }
}

SYS_RUN(smartFarm_Project_example);
