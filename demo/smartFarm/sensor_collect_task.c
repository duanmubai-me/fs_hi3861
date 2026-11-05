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
#include "securec.h"

#include "sensor_collect_task.h"
#include "hal_bsp_sht20.h"
#include "hal_bsp_pcf8574.h"
#include "hal_bsp_ssd1306.h"
#include "hal_bsp_ssd1306_bmps.h"
#include "hal_bsp_key.h"
#include "hal_bsp_mqtt.h"
#include "oled_show_log.h"
#include "sys_config.h"

#include "mutex_lock.h"

msg_data_t sys_msg_data = {0}; // 传感器的数据
static uint8_t fan_gif_index = 0;
#define FAN_GIF_INDEX_MAX 3

extern system_value_t systemdata;

margin_t bmp_number_1 = {
    .top = 0,
    .left = 8,
    .width = 16,
    .hight = 32,
}; // 数字-十位
margin_t bmp_number_2 = {
    .top = 0,
    .left = 24,
    .width = 16,
    .hight = 32,
};                                                   // 数字-个位
margin_t bmp_dian = {
    .top = 16,
    .left = 40,
    .width = 16,
    .hight = 16,
};     // 小数点
margin_t bmp_number_3 = {
    .top = 16,
    .left = 56,
    .width = 8,
    .hight = 16,
}; // 数字-小数
margin_t bmp_danwei = {
    .top = 0,
    .left = 52,
    .width = 16,
    .hight = 16,
};   // 单位
margin_t bmp_image = {
    .top = 16,
    .left = 72,
    .width = 48,
    .hight = 48,
}; // 图片

#define TASK_DELAY_TIME (100 * 1000) // us
#define COEFFICIENT_10 10
#define COEFFICIENT_100 100
#define COEFFICIENT_1000 1000

static void show_temperature(float temperature)
{
    char text[8] = {0};

    /* 转为十分之一摄氏度，保留一位小数 */
    int t10 = (int)(temperature * 10.0f +
                    (temperature >= 0.0f ? 0.5f : -0.5f));

    unsigned int value =
        (unsigned int)(t10 < 0 ? -t10 : t10);

    int len = sprintf_s(text, sizeof(text), "%s%u.%uC",
                        t10 < 0 ? "-" : "",
                        value / 10, value % 10);

    if (len <= 0 || len > 7) {
        return;
    }

    /* 补空格，覆盖上次较长数字留下的内容 */
    for (int i = len; i < 7; i++) {
        text[i] = ' ';
    }
    text[7] = '\0';

    SSD1306_ShowStr(72, OLED_TEXT16_LINE_1,
                   (unsigned char *)text, TEXT_SIZE_16);
}

/**
 * @brief  显示湿度页面
 * @note
 * @param  val:
 * @retval None
 */
void show_humi_page(float val)
{
    //SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_0, " Smart Farm", TEXT_SIZE_16);

    int x = (val * COEFFICIENT_100) / COEFFICIENT_1000;
    SSD1306_DrawBMP(bmp_number_1.left, bmp_number_1.top,
                    bmp_number_1.width, bmp_number_1.hight, bmp_16X32_number[x]); // 显示数字的十位

    x = ((int)(val * COEFFICIENT_100)) / COEFFICIENT_100 % COEFFICIENT_10;
    SSD1306_DrawBMP(bmp_number_2.left, bmp_number_2.top,
                    bmp_number_1.width, bmp_number_1.hight, bmp_16X32_number[x]); // 显示数字的个位
    SSD1306_DrawBMP(bmp_dian.left, bmp_dian.top,
                    bmp_dian.width, bmp_dian.hight, bmp_16X16_dian);              // 显示小数点
    SSD1306_DrawBMP(bmp_danwei.left, bmp_danwei.top,
                    bmp_danwei.width, bmp_danwei.hight, bmp_16X16_baifenhao);     // 显示%符号

    x = ((int)(val * COEFFICIENT_100)) / COEFFICIENT_10 % COEFFICIENT_10;
    SSD1306_DrawBMP(bmp_number_3.left, bmp_number_3.top,
                    bmp_number_3.width, bmp_number_3.hight, bmp_8X16_number[x]); // 显示数字的小数位

    // 风扇动态显示
    // if (sys_msg_data.fanStatus == 0) {
    //     SSD1306_DrawBMP(bmp_image.left, bmp_image.top,
    //                     bmp_image.width, bmp_image.hight, bmp_48X48_fan_gif[0]); // 静态显示
    // } else {
    //     fan_gif_index++;
    //     if (fan_gif_index > FAN_GIF_INDEX_MAX)
    //         fan_gif_index = 0;
    //     SSD1306_DrawBMP(bmp_image.left, bmp_image.top,
    //                     bmp_image.width, bmp_image.hight, bmp_48X48_fan_gif[fan_gif_index]); // 动态显示
    // }

}

/**
 * @brief  传感器采集任务
 * @note
 * @retval None
 */
void sensor_collect_task(void)
{
    float temperature = 0, humidity = 0;
    
    while (1) {
        // 采集传感器的值
        SHT20_ReadData(&temperature, &humidity);
        if (osMutexAcquire(g_oled_mutex, osWaitForever) == osOK) {
            show_humi_page(humidity);
            show_temperature(temperature);

            osMutexRelease(g_oled_mutex);
        }

        sys_msg_data.temperature = (int)temperature;
        sys_msg_data.humidity = (int)humidity;

        if (sys_msg_data.fanStatus != 0) {
            set_fan(true); // 风扇打开
        } else {
            set_fan(false); // 风扇关闭
        }

        // 逻辑判断
        if (sys_msg_data.nvFlash.smartControl_flag != 0) {
        // 查看是否开启自动控制
            if (sys_msg_data.humidity >= sys_msg_data.nvFlash.humi_upper) {
                set_fan(true); // 风扇打开
                sys_msg_data.fanStatus = 1;
            } else if (sys_msg_data.humidity <= sys_msg_data.nvFlash.humi_lower) {
                set_fan(false); // 风扇关闭
                sys_msg_data.fanStatus = 0;
            } else {
                // 保持上一状态; 上一次状态是开，那就继续开; 反之，关
                set_fan(sys_msg_data.fanStatus);
            }
        } else {
            if (sys_msg_data.fanStatus != 0) {
                set_fan(true); // 风扇打开
            } else {
                set_fan(false); // 风扇关闭
            }
        }
        usleep(TASK_DELAY_TIME);
    }
}
