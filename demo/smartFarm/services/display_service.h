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
 * 显示服务：OLED 三页轮播（农业页 / 气体页 / 火焰页）。
 *
 * 约定：整个工程只有这一个任务调用 SSD1306_xxx()。
 * SSD1306 走 I2C0，和 SHT20/AP3216C/SGP30/PCF8574 共用总线，
 * 多个任务同时刷屏会互相打断 I2C 传输，所以其它任务只写状态、不刷屏。
 *
 * 三页内容：
 * - 农业页：温度、湿度、手动/自动、风扇、配置版本；
 * - 气体页：eCO2、TVOC（没接 SGP30 时显示 -- / NOCFG）；
 * - 火焰页：原始值、触发/解除阈值、报警状态（AP3216C 模拟时标注 IR-SIM）。
 *
 * 降级：CONFIG_DISPLAY=0 或 OLED 初始化失败时，init 只打印日志，
 * task 直接返回，不影响其它功能。
 */

#ifndef DISPLAY_SERVICE_H
#define DISPLAY_SERVICE_H

/**
 * @brief  初始化显示服务（初始化 SSD1306 并清屏）
 * @note   在其它外设初始化之后调用，别和别的任务同时初始化 I2C。
 * @retval 0 成功（含 OLED 初始化失败的降级情况）
 */
int display_service_init(void);

/**
 * @brief  显示任务：每 300ms 刷当前页，每 3s 换一页
 * @note   由 smartFarm_demo 创建，栈大小用 CONFIG_DISPLAY_TASK_STACK。
 */
void display_service_task(void);

#endif /* DISPLAY_SERVICE_H */
