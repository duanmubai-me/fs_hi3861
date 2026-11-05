#ifndef __MUTEX_LOCK_H__
#define __MUTEX_LOCK_H__

#include "cmsis_os2.h"

extern osMutexId_t g_oled_mutex;
extern osMutexId_t g_pcf8574_mutex;

void MUTEX_Init(void);

#endif
