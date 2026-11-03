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

#include "oled_show_task.h"

#include <stdio.h>
#include <unistd.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>

#include "hi_uart.h"
#include "hi_io.h"
#include "hi_gpio.h"

#include "ohos_init.h"
#include "cmsis_os2.h"

#include "hal_bsp_wifi.h"
#include "hal_bsp_ssd1306.h"
#include "oled_show_log.h"
#include "sys_config.h"

// OLED显示屏显示任务
uint8_t oledShowBuff[50] = {0};
extern system_value_t systemdata; // 系统全局变量


// 切换指纹锁的模式
char *get_CurrentKeyPattern(system_value_t sys)
{
    char *data = NULL;
    switch (sys.key_pattern) {
        case KEY_PATTERN_TEST:
            data = "TEST ";
            break;
        case KEY_PATTERN_INPUT:
            data = "INPUT";
            break;
             default:
            data = "    ";
            break;
    }
    return data;
}

// 切换指纹锁的状态
char *get_CurrentKeyStatus(system_value_t sys)
{
     char *data = NULL;
    switch (sys.key_status) {
        case KEY_STATUS_ON:
            data = "ON ";
            break;
        case KEY_STATUS_OFF:
            data = "OFF";
            break;
             default:
            data = "    ";
            break;
    }
    return data;

}
void oled_show_task(void)
{

    uint8_t test[20]="Finger_Test!";
    SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_0,test,TEXT_SIZE_16);
    while (1) {

            if (sprintf_s((char *)oledShowBuff, sizeof(oledShowBuff), "Mode: %s",
                          get_CurrentKeyPattern(systemdata)) > 0) {
                SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_1, oledShowBuff, TEXT_SIZE_16);
                memset_s((char *)oledShowBuff, sizeof(oledShowBuff), 0, sizeof(oledShowBuff));
            }
            if (sprintf_s((char *)oledShowBuff, sizeof(oledShowBuff), "Key: %s",
                          get_CurrentKeyStatus(systemdata)) > 0) {
                SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_2, oledShowBuff, TEXT_SIZE_16);
                 memset_s((char *)oledShowBuff, sizeof(oledShowBuff), 0, sizeof(oledShowBuff));
            }
            hi_watchdog_feed();
         
     }
}
