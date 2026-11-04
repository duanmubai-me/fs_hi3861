/*
 * Copyright (c) 2026 smartFarm device team
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

/*
 * 显示服务实现。
 *
 * 每行字符串都按固定宽度格式化（例如 "RAW :%4u"），这样新值比旧值短的时候
 * 也能把旧字符覆盖掉，不需要每刷一次就清屏——只有换页时才 SSD1306_CLS()。
 */

#include <stdio.h>

#include "cmsis_os2.h"

#include "hal_bsp_ssd1306.h"

#include "smart_farm_config.h"
#include "smart_farm_state.h"
#include "security_service.h"
#include "display_service.h"

#define DISPLAY_PAGE_COUNT 3

/* 换页周期必须不小于刷新周期，否则 ticks_per_page 会算成 0，取余时除零 */
#if (CONFIG_DISPLAY_PAGE_MS < CONFIG_DISPLAY_PERIOD_MS)
#error "CONFIG_DISPLAY_PAGE_MS 必须大于等于 CONFIG_DISPLAY_PERIOD_MS"
#endif

static uint8_t s_inited; /* 1 = OLED 初始化成功 */
static uint8_t s_page;   /* 当前页：0 农业，1 气体，2 火焰 */

/* 8x8 字体一行（y = 0~7），16x16 字体一行占两页（y = 0~3） */
static void show_line8(uint8_t y, const char *text)
{
    SSD1306_ShowStr(0, y, (unsigned char *)text, TEXT_SIZE_8);
}

static void show_line16(uint8_t y, const char *text)
{
    SSD1306_ShowStr(0, y, (unsigned char *)text, TEXT_SIZE_16);
}

/* 农业页：温度/湿度/模式/风扇/配置版本 */
static void draw_page_agri(void)
{
    smart_farm_state_t st;
    char line[24];

    smart_farm_state_get(&st);
    show_line16(0, "  AGRI  ");

    if (st.th_quality == (uint8_t)SF_QUALITY_OK) {
        snprintf(line, sizeof(line), "T:%3dC  H:%3d%%", st.temperature, st.humidity);
    } else {
        snprintf(line, sizeof(line), "T: --  H: --  ");
    }
    show_line8(2, line);
    snprintf(line, sizeof(line), "MODE:%s", (st.mode == 1) ? "AUTO" : "MAN ");
    show_line8(3, line);
    snprintf(line, sizeof(line), "FAN : %s", (st.fan_on != 0) ? "ON " : "OFF");
    show_line8(4, line);
    snprintf(line, sizeof(line), "CFG : #%3lu", (unsigned long)st.config_revision);
    show_line8(5, line);
}

/* 气体页：eCO2 / TVOC，没接模块就显示 -- */
static void draw_page_gas(void)
{
    security_state_t sec;
    char line[24];

    get_security_state(&sec);
    show_line16(0, "  GAS   ");

    if (sec.gas_ready != 0) {
        snprintf(line, sizeof(line), "eCO2:%4u ppm", (unsigned int)sec.eco2_ppm);
        show_line8(2, line);
        snprintf(line, sizeof(line), "TVOC:%4u ppb", (unsigned int)sec.tvoc_ppb);
        show_line8(3, line);
        show_line8(4, "GAS : OK   ");
    } else {
        show_line8(2, "eCO2: -- ppm");
        show_line8(3, "TVOC: -- ppb");
        show_line8(4, "GAS : NOCFG");
    }
    show_line8(5, "ECO2 ESTIMATE");
}

/* 火焰页：原始值 / 触发阈值 / 解除阈值 / 报警状态 */
static void draw_page_fire(void)
{
    security_state_t sec;
    char line[24];

    get_security_state(&sec);
    show_line16(0, "  FIRE  ");

    if (sec.flame_ready != 0) {
        snprintf(line, sizeof(line), "RAW :%4u", (unsigned int)sec.flame_raw);
        show_line8(2, line);
        snprintf(line, sizeof(line), "TRIP:%4u", (unsigned int)sec.flame_trip);
        show_line8(3, line);
        snprintf(line, sizeof(line), "CLR :%4u", (unsigned int)sec.flame_clear);
        show_line8(4, line);
        snprintf(line, sizeof(line), "ALARM:%s", (sec.flame_alarm != 0) ? "ON " : "OFF");
        show_line8(5, line);
#if CONFIG_FLAME_SOURCE == CONFIG_FLAME_SRC_ADC
        show_line8(6, "SRC : ADC-AO");
#else
        show_line8(6, "SRC : IR-SIM"); /* 提醒：这是红外模拟，不是真火焰传感器 */
#endif
    } else {
        show_line8(2, "RAW :  --");
        show_line8(3, "TRIP:  --");
        show_line8(4, "CLR :  --");
        show_line8(5, "ALARM:-- ");
        show_line8(6, "SRC : NONE  ");
    }
}

int display_service_init(void)
{
#if CONFIG_DISPLAY
    if (SSD1306_Init() != 0) {
        printf("[display] OLED 初始化失败，本次演示不带显示\r\n");
        return 0; /* 显示失败不算致命错误，其它功能继续跑 */
    }
    SSD1306_CLS();
    s_inited = 1;
    /* 先设成“最后一页”，任务第一次循环就会切到第 0 页并清屏 */
    s_page = DISPLAY_PAGE_COUNT - 1;
    printf("[display] OLED 就绪：农业/气体/火焰 三页每 %dms 轮播\r\n", CONFIG_DISPLAY_PAGE_MS);
#else
    printf("[display] CONFIG_DISPLAY=0，OLED 未启用\r\n");
#endif
    return 0;
}

void display_service_task(void)
{
    const uint32_t ticks_per_page = CONFIG_DISPLAY_PAGE_MS / CONFIG_DISPLAY_PERIOD_MS;
    uint32_t tick = 0;

    if (s_inited == 0) {
        printf("[display] 显示未启用，任务不运行\r\n");
        return;
    }

    while (1) {
        /* 换页时才清屏；同一页里靠固定宽度覆盖旧字符 */
        if ((tick % ticks_per_page) == 0) {
            s_page = (uint8_t)((s_page + 1) % DISPLAY_PAGE_COUNT);
            SSD1306_CLS();
        }

        switch (s_page) {
            case 0:
                draw_page_agri();
                break;
            case 1:
                draw_page_gas();
                break;
            default:
                draw_page_fire();
                break;
        }

        tick++;
        osDelay(CONFIG_DISPLAY_PERIOD_MS);
    }
}
