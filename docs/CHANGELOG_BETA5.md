# TaxiNow V1.0 Beta 5 — Build 102

Beta 4 is intentionally skipped as a public upgrade target. The Beta 4 work
and the additional fixes completed afterward have been consolidated into this
Beta 5 release. Users should update directly from Beta 3 to Beta 5 Build 102.

**Map Pack Builder hotfix:** Builder Build 104 includes the bundled airport
and runway catalogs omitted from the initial Build 102 installer. It also
keeps the expensive country-wide OSM feature index for resumable retries,
identifies each airport extraction stage in the log, and records an individual
airport extraction failure instead of immediately aborting the complete
regional preprocessing run. Build 104 also fixes the Windows osmium-tool
launcher incompatibility that caused every regional build to exit with code 2.
TaxiNow itself remains Build 102.

**Map Pack Builder Build 105:** incomplete polygon fragments are discarded
before publication, completed airports are reused when retrying a failed
country build, and a small number of explicitly recorded source-data omissions
no longer invalidates an otherwise verified country pack. Archive integrity,
region failures, inconsistent counts, and excessive omissions remain blocking.

## Highlights since Beta 3

- Added English and Simplified Chinese application interfaces with a globe
  language menu, while keeping the first-run welcome page bilingual.
- Added internal build IDs. This release is V1.0 Beta 5, Build 102.
- Improved OSM download retry, timeout, progress, source-status and failure
  reporting. Existing airports are skipped during country/region downloads,
  and one failed airport no longer fails the complete batch.
- Added configurable parallel downloads, province/state filtering, clearer
  download-time guidance, named administrative subdivisions, and improved
  downloaded-asset management.
- Added regional map-pack support with resumable downloads, SHA-256
  verification, strict completeness checks and per-airport fallback.
- Added the installable TaxiNow Local Map Pack Builder. It generates
  country/region packages on the maintainer PC and automatically installs its
  isolated Python, osmium-tool and Overture Maps dependencies.
- Improved airport drawing, fit bounds, taxiway continuity, repeated taxiway
  labels, terminal labels, and removal of unrelated geometry outside the
  airport.
- Fixed the Beta 4 relation-geometry regression that could omit large
  multipolygon terminals at airports such as ZBAA and CYVR.
- Added terminal-data fusion and release quality gates to reduce fragmented or
  missing terminal buildings. Global airport data can still contain omissions,
  so perfect coverage at every airport cannot be guaranteed.
- Improved MSFS position refresh and stale-position handling. The aircraft is
  hidden after leaving the airport perimeter or when the simulator/flight is
  no longer active.
- Improved the About, copyright, official-download, disclaimer and technical
  limitation information.
- The TaxiNow uninstaller can preserve downloaded airport data during upgrades.

## Upgrade notes

1. Uninstall the previous TaxiNow version before installing Beta 5.
2. Choose **Keep downloaded maps and user data** during uninstall if you want
   to reuse existing assets.
3. Install `TaxiNow-V1.0-Beta-5-Build-102-Setup.exe`.
4. If ZBAA or CYVR was downloaded with an earlier Beta 4/5 test build, delete
   that airport under Downloaded Asset and download it again by ICAO.

---

# TaxiNow V1.0 Beta 5 — 内部版本 102

Beta 4 有意不作为公开升级目标单独发布。Beta 4 的全部更新以及此后完成的
修复已经合并到 Beta 5。用户应当直接从 Beta 3 升级至 Beta 5 Build 102。

**地图包生成器热修复：**Builder Build 104 补回了初版 Build 102 安装器中
误漏的机场和跑道目录数据；全国 OSM 特征索引现在可在重试时断点复用，日志会
明确显示每座机场的提取阶段，单座机场提取异常也会被记录，而不会立即中断整个
地区的预处理。Build 104 同时修复了 Windows 下 osmium-tool 启动器兼容问题；
该问题会导致所有地区构建以退出码 2 失败。TaxiNow 主程序仍为 Build 102。

## 相比 Beta 3 的主要更新

- 新增英文和简体中文界面及地球仪语言菜单，同时保留首次启动时的中英双语
  欢迎页面。
- 新增内部版本号。本版本为 V1.0 Beta 5，Build 102。
- 改进 OSM 下载重试、超时、实时进度、数据源状态和失败提示。按国家/地区
  下载时会跳过已安装机场，单个机场失败也不会导致整个任务失败。
- 新增并行下载数量选择、省/州筛选、更合理的时间提示、行政区实际名称和
  更完善的已下载资源管理。
- 新增地区地图包、断点续传、SHA-256 校验、严格完整性检查和单机场回退。
- 新增可安装的 TaxiNow Local Map Pack Builder，可在维护者电脑上生成国家/
  地区地图包，并自动安装隔离的 Python、osmium-tool 与 Overture Maps 依赖。
- 改进机场显示范围、滑行道连续性、重复滑行道标识、航站楼名称，以及机场
  外无关图形的过滤。
- 修复 Beta 4 关系几何回归；该问题会导致 ZBAA、CYVR 等机场的大型
  multipolygon 航站楼缺失。
- 新增航站楼多数据源融合和发布质量门禁，以减少航站楼破碎或缺失。全球
  原始数据仍可能存在缺漏，因此无法保证每一座机场都完全准确。
- 改进 MSFS 位置强制刷新及过期位置清理；飞机离开机场范围或模拟器/航班
  结束后会隐藏飞机图标。
- 完善关于页面、版权、官方发布渠道、免责声明和技术限制说明。
- 卸载更新时可选择保留已下载机场数据。

## 升级说明

1. 安装 Beta 5 前请先卸载旧版 TaxiNow。
2. 如果需要继续使用已下载地图，卸载时选择保留地图和用户数据。
3. 安装 `TaxiNow-V1.0-Beta-5-Build-102-Setup.exe`。
4. 如果曾使用早期 Beta 4/5 测试版本下载 ZBAA 或 CYVR，请在已下载资源中
   删除对应机场，再按 ICAO 重新下载。
