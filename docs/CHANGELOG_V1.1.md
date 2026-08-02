# TaxiNow V1.1 — Build 110

Build date: August 2, 2026

TaxiNow V1.1 is the first non-beta release. It retains the stable airport-map,
download-management, and MSFS 2020/2024 tracking foundation from Beta 6 and
adds local taxi-route planning and live ground guidance.

## New: Plan Taxi

- Adds a **Plan Taxi** button immediately before **Maps & storage**.
- Plans from the aircraft's synchronized ground position to a selected runway
  end or an entered gate/stand number.
- Lists the runway ends and gates actually present in the active downloaded
  airport map.
- Builds a local taxi graph from taxiway and taxilane centerlines. No route or
  aircraft-position data is uploaded.
- Produces three to five distinct options when the airport topology permits.
- Ranks routes using distance together with penalties for sharp turns,
  reversals, excessive taxiway changes, and unnamed links. The selected route
  therefore favors practical, legible taxi paths instead of blindly choosing
  the shortest geometry.
- Displays readable summaries such as
  `Gate 105 → A → H → Q → RWY23`.
- Highlights the selected route in blue and frames it on the airport map.
- Adds heading-up live guidance with upcoming turn/continue instructions,
  maneuver distance, remaining distance, arrival status, and an off-route
  warning.
- Removes passed route geometry progressively as the aircraft taxis.
- Includes full English, Simplified Chinese, French, and German localization.
- Adds an experimental customized-route editor using comma-separated clearance
  style input such as `D, E, H, T1, RWY01L` or `A, B, GATE B19`.
- Validates taxiway and destination names against the active airport, suggests
  likely spelling corrections, and offers one-click automatic route finding
  when the customized sequence is unavailable or disconnected.

## Routing limitations

TaxiNow routing is advisory and intended only for flight simulation. It uses
the centerline topology contained in the downloaded map and cannot know every
temporary closure, one-way restriction, aircraft-size restriction, local
procedure, or live ATC clearance. A data source may also omit or disconnect a
taxiway. Always follow simulator ATC instructions and airport signage.

---

# TaxiNow V1.1 — 内部版本 110

构建日期：2026 年 8 月 2 日

TaxiNow V1.1 是首个结束 Beta 阶段的正式版本。在保留 Beta 6 稳定的机场地图、
下载管理及 MSFS 2020/2024 位置同步功能基础上，新增本地滑行路线规划和实时
地面引导。

## 新功能：规划滑行

- 在“地图与存储”左侧新增 **“规划滑行”** 按钮。
- 从飞机当前已同步的地面位置出发，可选择前往某条跑道的指定端，或输入登机口/
  机位编号。
- 跑道与机位列表来自当前已下载机场地图中的实际数据。
- 使用滑行道及机坪滑行线中心线在本地构建导航图，不上传路线或飞机位置数据。
- 当机场拓扑允许时，提供 3 至 5 条不同路线。
- 路线排序同时考虑距离、急转弯、掉头、频繁切换滑行道及无编号连接段，避免只按
  最短距离产生不自然的折线路径。
- 路线以 `Gate 105 → A → H → Q → RWY23` 等易读格式显示。
- 选择方案后在地图上以蓝色高亮，并自动调整到合适视野。
- 开始引导后提供航向朝上的地图跟随、前方左转/右转/继续直行提示、操作距离、
  剩余距离、到达状态和偏航提醒。
- 飞机经过的路线会从地图上逐段清除。
- 完整支持英文、简体中文、法语和德语界面。
- 新增实验性自定义路线输入，支持 `D, E, H, T1, RWY01L` 或
  `A, B, GATE B19` 等使用逗号分隔的类似 ATC 滑行许可格式。
- TaxiNow 会根据当前机场地图校验滑行道和目的地，对可能的拼写错误提供修正建议，
  并在自定义顺序不存在或不连通时提供一键自动路线规划。

## 路线规划限制

TaxiNow 路线仅供模拟飞行辅助参考。规划依据为已下载地图中的中心线拓扑，无法掌握
所有临时关闭、单行限制、机型尺寸限制、机场本地程序或实时 ATC 许可；部分数据源
也可能遗漏或断开滑行道。请始终以模拟器 ATC 指令和机场标志为准。
