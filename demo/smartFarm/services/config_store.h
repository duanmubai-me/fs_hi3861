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
 * 配置存储服务：把阈值/模式/火焰参数存到 Hi3861 的 NV（Flash）。
 *
 * 做法很简单，两句话能讲完：
 * 1. 读：A、B 两个槽都读出来，magic 和 CRC 都对才算有效，两个都有效就取
 *    revision 大的那个；都无效就用默认值（只放内存，不写 Flash）；
 * 2. 写：永远写“当前没在用的那个槽”，写完立刻读回来比对，
 *    读回来一致才更新内存里的 revision 并返回成功。
 *
 * 这样任何一次掉电最多丢掉“正在写”的那一次，上一份配置一定还在。
 *
 * 线程约束：hi_nv_read/hi_nv_write 只能在任务里调用（不能在中断里），
 * 本模块也不做“同时两路保存”的保护——课程设计里保存只由 MQTT 回调
 * 或按键这一条路径触发，够用。
 */

#ifndef CONFIG_STORE_H
#define CONFIG_STORE_H

#include "smart_farm_config.h"

/* 简单的返回码，够用就行：0 成功，负数失败 */
typedef enum {
    CONFIG_OK = 0,
    CONFIG_ERR_PARAM = -1,   /* 参数不合法（空指针、上下限关系错） */
    CONFIG_ERR_NV = -2,      /* NV 读/写失败 */
    CONFIG_ERR_VERIFY = -3,  /* 写进去的内容读回来不一致 */
    CONFIG_ERR_DISABLED = -4 /* CONFIG_STORE=0，功能未启用 */
} config_result_t;

/**
 * @brief  上电加载配置：读 A/B 两槽，选 revision 大的有效记录
 * @note   两槽都无效时使用默认配置，不写 Flash；函数不会失败，
 *         这样开机流程不用处理错误分支。
 * @retval CONFIG_OK
 */
int config_store_init(void);

/**
 * @brief  取当前生效配置的一份拷贝（不访问 Flash）
 * @param  out [OUT] 不能为 NULL
 */
void config_store_get(smart_farm_config_t *out);

/**
 * @brief  保存配置：写另一个槽 -> 读回校验 -> 更新内存 revision
 * @param  cfg [IN] 目标配置；magic/version/length/revision 由本函数填写，
 *                 调用者只需要填业务字段（mode/阈值/报警开关）
 * @retval CONFIG_OK 保存并校验成功；其它值见 config_result_t
 */
int config_store_save(const smart_farm_config_t *cfg);

/**
 * @brief  恢复默认配置（等价于用默认值调一次 config_store_save）
 * @retval 同 config_store_save()
 */
int config_store_reset(void);

#endif /* CONFIG_STORE_H */
