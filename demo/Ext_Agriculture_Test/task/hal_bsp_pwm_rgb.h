#ifndef __HAL_BSP_PWM_RGB_H__
#define __HAL_BSP_PWM_RGB_H__
#include "cmsis_os2.h"

/**
 * @brief  设置RGB灯的PWM值
 * @note   
 * @param  r_value: 0-255
 * @param  g_value: 
 * @param  b_value: 
 * @retval None
 */
void pwm_rgb_set( uint8_t g_value, uint8_t b_value);
/**
 * @brief  PWM驱动RGB灯的初始化
 * @note   
 * @retval 
 */
void pwm_rgb_init(void);

/**
 * @brief  关闭RGB灯
 * @note   
 * @retval None
 */
void pwm_rgb_close(void);
void pwm1_rgb_init(void);
#endif

