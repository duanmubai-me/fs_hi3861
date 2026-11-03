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
uint8_t oledShowBuff[20] = {0};
#define OLED_SHOW_TASK_TIME (50 * 1000) // us
uint8_t led_status = 0;
uint8_t buzzer_status = 0;
char *get_CurrentRadarPattern(system_value_t sys)
{
    char *data = NULL;
    switch (sys.radar_status) {
        case Radar_STATUS_ON:
            data = "on ";
            break;
        case Radar_STATUS_OFF:
            data = "off";
            break;
        default:
            data = "    ";
            break;
    }
    
    return data;
}

void oled_show_task(void)
{
    // 在界面第一行显示 IP地址
   uint8_t test[20]="Rado_Test!";
    SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_0,test,TEXT_SIZE_16);
    while (1) {
         if (sprintf_s((char *)oledShowBuff, sizeof(oledShowBuff), "State: %s",
                          get_CurrentRadarPattern(systemValue)) > 0) {
                SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_1, oledShowBuff, TEXT_SIZE_16);
                memset_s((char *)oledShowBuff, sizeof(oledShowBuff), 0, sizeof(oledShowBuff));
            }
            if (sprintf_s((char *)oledShowBuff, sizeof(oledShowBuff), "Distance: %3dcm",
                          systemValue.distance)) {
                SSD1306_ShowStr(OLED_TEXT16_COLUMN_0, OLED_TEXT16_LINE_2, oledShowBuff, TEXT_SIZE_16);
                 memset_s((char *)oledShowBuff, sizeof(oledShowBuff), 0, sizeof(oledShowBuff));
            }
             hi_watchdog_feed();
    }
}
