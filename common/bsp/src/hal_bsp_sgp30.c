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

#include "hal_bsp_sgp30.h"
#include "hi_gpio.h"
#include "hi_io.h"
#include "hi_i2c.h"
#include "hi_errno.h"

#define SHT20_HoldMaster_Temp_REG_ADDR 0xE3 // 主机模式会阻塞其他IIC设备的通信
#define SHT20_HoldMaster_Humi_REG_ADDR 0xE5
#define SHT20_NoHoldMaster_Temp_REG_ADDR 0x2008
#define SHT20_NoHoldMaster_Humi_REG_ADDR 0xF5
#define SHT20_W_USER_REG_ADDR 0xE6
#define SHT20_R_USER_REG_ADDR 0xE7
#define SHT20_SW_REG_ADDR 0x06

#define SHT20_READ_TEMP_DATA_TIME 85000
#define SHT20_READ_HUMI_DATA_TIME 50000
#define SHT20_RESET_TIME 100000

#define TEMP_VALUE_1 175.72
#define TEMP_VALUE_2 65536.0
#define TEMP_VALUE_3 46.85
#define TEMP_LEFT_SHIFT_8 8

#define HUMI_VALUE_1 125
#define HUMI_VALUE_2 65536.0
#define HUMI_VALUE_3 6
#define HUMI_LEFT_SHIFT_8 8

// 读从机设备的数据
static uint32_t SGP30_RecvData(uint8_t *data, size_t size)
{
    hi_i2c_data i2cData = {0};
    i2cData.receive_buf = data;
    i2cData.receive_len = size;

    return hi_i2c_read(SHT20_I2C_IDX, SHT20_I2C_ADDR, &i2cData);
}
// 向从机设备 发送数据
static uint32_t SGP30_WiteByteData(uint8_t byte1,uint8_t byte2)
{
    uint8_t buffer[] = {byte1,byte2};
    hi_i2c_data i2cData = {0};
    i2cData.send_buf = buffer;
    i2cData.send_len = sizeof(buffer);

    return hi_i2c_write(SHT20_I2C_IDX, SHT20_I2C_ADDR, &i2cData);
}

#define READ_TEMP_DATA_NUM 6

// 获取CO2值
uint32_t SGP30_ReadData(uint16_t *temp, uint16_t *humi)
{
    uint32_t result;
    uint8_t buffer[6] = {0};

    /* 发送检测命令 */
    SGP30_WiteByteData(0x20,0x08);
    msleep(100);

    //读数据
    result = SGP30_RecvData(buffer, READ_TEMP_DATA_NUM);
    if (result != HI_ERR_SUCCESS) {
        printf("I2C SHT20 status = 0x%x!!!\r\n", result);
        return result;
    }

    // 看芯片手册，手册中有转换公式的说明
    *temp = (buffer[0] << TEMP_LEFT_SHIFT_8) |buffer[1];

    *humi = (buffer[3] << HUMI_LEFT_SHIFT_8) | buffer[4];
    memset_s(buffer, sizeof(buffer), 0, sizeof(buffer));
    return HI_ERR_SUCCESS;
}



uint32_t SGP30_Init(void)
{
    uint32_t result;
    // gpio_9 复用为 I2C_SCL
    hi_io_set_pull(HI_IO_NAME_GPIO_9, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_9, HI_IO_FUNC_GPIO_9_I2C0_SCL);
    // gpio_10 复用为 I2C_SDA
    hi_io_set_pull(HI_IO_NAME_GPIO_10, HI_IO_PULL_UP);
    hi_io_set_func(HI_IO_NAME_GPIO_10, HI_IO_FUNC_GPIO_10_I2C0_SDA);

    result = hi_i2c_init(SHT20_I2C_IDX, SHT20_I2C_SPEED);
    if (result != HI_ERR_SUCCESS) {
        printf("I2C sht20 Init status is 0x%x!!!\r\n", result);
        return result;
    }
   SGP30_WiteByteData(0x20,0x03);
    
}
