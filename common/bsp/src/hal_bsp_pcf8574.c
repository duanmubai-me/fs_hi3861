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

#include "hi_i2c.h"
#include "hi_io.h"
#include "hi_errno.h"
#include "mutex_lock.h"

#include "hal_bsp_structAll.h"
#include "hal_bsp_pcf8574.h"

tn_pcf8574_io_t tmp_io = {0}; // IO扩展芯片的引脚

/* Caller-facing setters lock the complete read/modify/write operation. */
static void pcf_update_bits(uint8_t mask, uint8_t value)
{
    uint8_t next;
    uint32_t ret;

    if (g_pcf8574_mutex == NULL ||
        osMutexAcquire(g_pcf8574_mutex, osWaitForever) != osOK) {
        printf("PCF8574 mutex unavailable\r\n");
        return;
    }

    next = (uint8_t)((tmp_io.all & (uint8_t)~mask) | (value & mask));
    ret = PCF8574_Write(next);
    if (ret == HI_ERR_SUCCESS) {
        tmp_io.all = next;
    }
    osMutexRelease(g_pcf8574_mutex);

    if (ret != HI_ERR_SUCCESS) {
        printf("PCF8574 output failed: 0x%x\r\n", (unsigned int)ret);
    }
}

void set_fan(uint8_t status)
{
    pcf_update_bits(0x01, status ? 0x01 : 0x00);  /* P0: active high */
}

void set_buzzer(uint8_t status)
{
    pcf_update_bits(0x02, status ? 0x00 : 0x02);  /* P1: active low */
}

void set_led(uint8_t status)
{
    pcf_update_bits(0x04, status ? 0x00 : 0x04);  /* P2: active low */
}

void set_D2(uint8_t status)
{
    pcf_update_bits(0x20, status ? 0x20 : 0x00);  /* P5: GAS-CTRL */
}

uint32_t PCF8574_Write(const uint8_t send_data)
{
    uint32_t result = 0;
    uint8_t buffer[] = {send_data};

    hi_i2c_data i2c_data = {0};
    i2c_data.send_buf = buffer;
    i2c_data.send_len = sizeof(buffer);

    result = hi_i2c_write(PCF8574_I2C_ID, PCF8574_I2C_ADDR, &i2c_data);
    if (result != HI_ERR_SUCCESS) {
        printf("I2C PCF8574 Write result is 0x%x!!!\r\n", result);
        printf(" i2c_data.send_buf 0x%x!!!\r\n", i2c_data.send_buf);
        return result;
    }
    return HI_ERR_SUCCESS;
}

uint32_t PCF8574_Read(uint8_t *recv_data)
{
    uint32_t ret;
    hi_i2c_data transfer = {0};

    if (recv_data == NULL || g_pcf8574_mutex == NULL) {
        return HI_ERR_FAILURE;
    }
    if (osMutexAcquire(g_pcf8574_mutex, osWaitForever) != osOK) {
        return HI_ERR_FAILURE;
    }
    transfer.receive_buf = recv_data;
    transfer.receive_len = 1;
    ret = hi_i2c_read(PCF8574_I2C_ID, PCF8574_I2C_ADDR, &transfer);
    osMutexRelease(g_pcf8574_mutex);
    return ret;
}

uint32_t PCF8574_Init(void)
{
    uint32_t result = 0;

    // gpio_9 复用为 I2C_SCL
    hi_io_set_pull(HI_IO_NAME_GPIO_9, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_9, HI_IO_FUNC_GPIO_9_I2C0_SCL);
    // gpio_10 复用为 I2C_SDA
    hi_io_set_pull(HI_IO_NAME_GPIO_10, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_10, HI_IO_FUNC_GPIO_10_I2C0_SDA);

    result = hi_i2c_init(PCF8574_I2C_ID, PCF8574_SPEED);
    if (result != HI_ERR_SUCCESS) {
        printf("I2C PCF8574 Init status is 0x%x!!!\r\n", result);
        return result;
    }
    printf("I2C PCF8574 Init is succeeded!!!\r\n");

    tmp_io.bit.p0 = 0; // 风扇关闭
    tmp_io.bit.p1 = 1; // 蜂鸣器关闭
    tmp_io.bit.p2 = 1; // LED关闭
    tmp_io.bit.p4 = 1; // 火焰传感器初始引脚
    tmp_io.bit.p5 = 0; // 可然气体传感器
    tmp_io.bit.p7 = 1; // LED关闭


    return PCF8574_Write(tmp_io.all);
}