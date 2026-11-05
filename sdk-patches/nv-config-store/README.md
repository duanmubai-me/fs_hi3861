# NV 注册补丁：Smart Farm 配置（0xA0 / 0xA1）

设备端 Flash ④ 的 `config_store` 使用华为 SDK 的**非工厂 NV**（`hi_nv_read` / `hi_nv_write`）。
但 SDK 的 NV 项由 nvtool 根据 XML 白名单生成，**仅定义宏 ID 不会让运行时的 `hi_nv_write` 成功**：
`nv_find_item()` 找不到 ID 会直接返回错误；长度不一致还会静默截断。

本目录把 Smart Farm 的 A/B 两槽注册进 NV 数据库：

| 项 | 值 |
| --- | --- |
| NV ID | `0xA0`（slot A）、`0xA1`（slot B） |
| 长度 | 64 字节/项 |
| 组 | 新增 `GROUP NAME="App"`，`PARAM_DEF_FILE="../nv/nv_app_struct_def.txt"` |
| 默认值 | 全 0（固件运行时由 `config_store` 判 magic/CRC，全 0 视为“未初始化”走默认配置） |
| 修改文件 | `sdk_liteos/tools/nvtool/h_file/nv/nv_app_struct_def.txt`、`sdk_liteos/tools/nvtool/xml_file/mss_nvi_db.xml` |

## 应用 / 还原

在 Team 仓库根（`fs_hi3861/`）执行：

```powershell
# 默认 SDK 路径：E:\School_Meaningless_Projrct\hi3861_hdu_iot_application240515\src\device\hisilicon\hispark_pegasus\sdk_liteos
node sdk-patches\nv-config-store\apply.js

# 指定其他 SDK 路径
node sdk-patches\nv-config-store\apply.js --sdk "D:\path\to\sdk_liteos"

# 还原（使用本目录 original/ 下首次备份）
node sdk-patches\nv-config-store\apply.js --revert
```

补丁是**幂等**的：已包含 `smart_farm_config_nv` / `SMART_FARM_CONFIG_A` 时不会重复追加。

## 验证构建确实带上了新 NV 项

```powershell
# 1) 在 R:\src 重新构建（NV 会由 nvtool 重新生成）
cd R:\src
hb build -f

# 2) 检查生成的 normal NV 镜像是否包含 0xA0/0xA1 且长度为 64
node sdk-patches\nv-config-store\check-hnv.js
```

`check-hnv.js` 会解析 `build/build_tmp/nv/*_normal.hnv` 的索引表（每项 4 字节：id/len/offset），
打印是否找到 `0xA0 len=64`、`0xA1 len=64`；找不到时退出码非 0。

## 为什么不用示例的 0x0B / factory NV

- 老师示例的 `0x0B` 属于工厂区 `[0x00,0x16)`，不是应用用户区；
- `hi_factory_nv_write` 与工厂校准数据混用有风险；
- 本补丁使用 `0xA0–0xFF` 的非工厂用户区，且与 `config_store` 的 A/B 事务对应。

## 注意

- `mss_nvi_db.xml` 现有 Factory/Modem/Keep 组不要改；本补丁只是在末尾插入 `GROUP App`；
- 补丁后**必须重新编译并重新烧录**（normal NV 镜像会被打包进固件），否则旧固件里仍没有这两个项；
- 全擦除/换分区方案可能清掉 NV，验收时按 `doc/09` 的 F-10 单独验证；
- 不同 SDK 版本若 XML 结构不同，先运行 `apply.js` 看是否报错，再人工核对 `original/*.orig` 与 diff。
