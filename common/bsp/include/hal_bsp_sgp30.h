#ifndef __HAL_BSP_SGP30_H__
#define __HAL_BSP_SGP30_H__

#include "cmsis_os2.h"

#define SGP30_I2C_ADDR  (0xB0)
#define SGP30_I2C_IDX   0
#define SGP30_I2C_SPEED 100000

uint32_t SGP30_ReadData(uint16_t *temp, uint16_t *humi);
/**
 * @brief SHT20 初始化
 * @return Returns {@link IOT_SUCCESS} 成功;
 *         Returns {@link IOT_FAILURE} 失败.
 */
uint32_t SGP30_Init(void);





#endif // !__HAL_BSP_SHT20_H__
