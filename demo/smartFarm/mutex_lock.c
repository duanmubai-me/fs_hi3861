#include "mutex_lock.h"
#include <stdio.h>

osMutexId_t g_oled_mutex = NULL;
osMutexId_t g_pcf8574_mutex = NULL;

void MUTEX_Init(void){
    const osMutexAttr_t pcf_attr = {
        .name = "pcf8574",
        .attr_bits = osMutexPrioInherit
    };

    if (g_oled_mutex == NULL) {
        g_oled_mutex = osMutexNew(NULL);
    }
    if (g_pcf8574_mutex == NULL) {
        g_pcf8574_mutex = osMutexNew(&pcf_attr);
    }
    if (g_oled_mutex == NULL || g_pcf8574_mutex == NULL) {
        printf("mutex create failed\r\n");
    }
}
