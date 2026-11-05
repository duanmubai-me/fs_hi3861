#include "hal_bsp_pwm_rgb.h"
#include "hi_io.h"
#include "hi_gpio.h"
#include "hi_pwm.h"
#include <unistd.h>
#include <stdlib.h>
#include "hi_errno.h"


#define GPIO_G_Pin  HI_IO_NAME_GPIO_7
#define GPIO_B_Pin  HI_IO_NAME_GPIO_8


#define PWM_G_Port HI_PWM_PORT_PWM0
#define PWM_B_Port HI_PWM_PORT_PWM1

/**
 * @brief  设置RGB灯的PWM值
 * @note   
 * @param  r_value: 0-255
 * @param  g_value: 
 * @param  b_value: 
 * @retval None
 */
void pwm_rgb_set(uint8_t g_value, uint8_t b_value)
{

  hi_pwm_start(PWM_G_Port, g_value, 255);
  hi_pwm_start(PWM_B_Port, b_value, 255);

}
/**
 * @brief  关闭RGB灯
 * @note   
 * @retval None
 */
void pwm_rgb_close(void)
{

  hi_pwm_stop(PWM_G_Port);
  hi_pwm_stop(PWM_B_Port);

}
/**
 * @brief  PWM驱动RGB灯的初始化
 * @note   
 * @retval 
 */
void pwm_rgb_init(void)
{
  /* gpio初始化 */
  hi_gpio_init();

  /* 设置上拉电阻 */
  hi_io_set_pull(GPIO_G_Pin, HI_IO_PULL_NONE);


  /* 设置引脚功能 */
  hi_io_set_func(GPIO_G_Pin, HI_IO_FUNC_GPIO_7_PWM0_OUT);


  /* 设置引脚为输出模式 */
  hi_gpio_set_dir(GPIO_G_Pin, HI_GPIO_DIR_OUT);


  /* 设置引脚初始状态 */
  hi_gpio_set_ouput_val(GPIO_G_Pin, HI_GPIO_VALUE0);
;

  /* PWM初始化 */
  hi_pwm_init(PWM_G_Port);

  /* 设置PWM的时钟源 */
  hi_pwm_set_clock(PWM_CLK_160M);
}

void pwm1_rgb_init(void)
{

  /* 设置上拉电阻 */
  hi_io_set_pull(GPIO_B_Pin, HI_IO_PULL_DOWN);

  /* 设置引脚功能 */

  hi_io_set_func(GPIO_B_Pin, HI_IO_FUNC_GPIO_8_PWM1_OUT);

  /* 设置引脚为输出模式 */
  
  hi_gpio_set_dir(GPIO_B_Pin, HI_GPIO_DIR_OUT);

  /* 设置引脚初始状态 */

  hi_gpio_set_ouput_val(GPIO_B_Pin, HI_GPIO_VALUE0);

  /* PWM初始化 */
  hi_pwm_init(PWM_B_Port);

  /* 设置PWM的时钟源 */
  hi_pwm_set_clock(PWM_CLK_160M);
}



