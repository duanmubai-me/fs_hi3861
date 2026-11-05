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
 * 电机控制服务：用一个按键（GPIO14）控制正反转。
 *
 * 按键规则（答辩讲这个就够）：
 * - 短按：停止 -> 正转 -> 停止 -> 反转 -> 停止 ... 循环，按一下换一个状态；
 * - 长按（>=1.5s）：立即停止，不管当前在哪一步。
 *
 * 换向安全：每次启动前先 MOTOR_Stop() 停 PWM，再 osDelay(200ms) 等电机
 * 停稳，然后才设反方向并启动。200ms 里任务在睡眠，不占 CPU。
 *
 * 和安防的配合：火焰报警时 security_service 会直接调用 motor_stop()，
 * 这里不需要知道报警的存在。
 */

#ifndef MOTOR_CONTROL_H
#define MOTOR_CONTROL_H

/**
 * @brief  初始化电机控制：调用 BSP 初始化，并确保电机是停止状态
 * @note   CONFIG_MOTOR=0 时只打印一行“未启用”，不碰任何硬件。
 * @retval 0 成功；-1 BSP 初始化失败
 */
int motor_control_init(void);

/**
 * @brief  电机任务：每 10ms 扫一次按键，处理短按/长按
 * @note   由 smartFarm_demo 创建，栈大小用 CONFIG_MOTOR_TASK_STACK；
 *         CONFIG_MOTOR=0 或没初始化时任务直接返回。
 */
void motor_control_task(void);

/**
 * @brief  立即停止电机（幂等，可以重复调用）
 * @note   火焰报警、云端“电机 OFF”命令都调用它。
 */
void motor_stop(void);

/**
 * @brief  等价于按一次短按键（云端命令用，省得再写一套方向逻辑）
 */
void motor_control_next(void);

#endif /* MOTOR_CONTROL_H */
