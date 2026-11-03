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

#include "uart_recv_task.h"
#include "sys_config.h"
#include "hi_uart.h"
#include "hi_io.h"
#include "hi_gpio.h"
#include "stdbool.h"

#include <unistd.h>
#include <string.h>
#include <stdlib.h>

#include "cmsis_os2.h"
#include "cJSON.h"

hi_u8 recvBuff[200] = {0};
hi_u8 *pbuff = recvBuff;

void uart_send_buff(unsigned char *str, unsigned short len)
{
    hi_u32 ret = 0;
    ret = hi_uart_write(HI_UART_IDX_1, (uint8_t *)str, len);
    if (ret == HI_ERR_FAILURE)
    {
        printf("uart send buff is failed.\r\n");
    }
}