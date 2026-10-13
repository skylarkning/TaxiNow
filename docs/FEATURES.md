# TaxiNow Pro features / 功能详解

[Back to README / 返回首页](../README.md)

## English

- Default Route workspace with a 2D/3D globe and north-up compass
- SimBrief route import with waypoints, aircraft type, planned altitude and browser-saved username
- Full-screen vertical profile with terrain, planned altitude, available constraints and live MSL/AGL; estimated paths are labelled and stale telemetry is cleared
- Flight-plan departure/arrival map downloads and destination taxi-map switching after touchdown
- VATSIM controllers, weather radar, GNSS interference and terrain overlays
- Continuous aircraft position and heading follow in Taxi, plus persistent Route follow
- Manual fallback downloads through X-Plane Scenery Gateway, with OurAirports as the final runway fallback; detail varies by source
- Compact header and footer, ICAO selector, matching Flight/Route Info drawers and consistently sized map controls
- Readable light/dark themes throughout the interface and desktop WebView2 sRGB rendering
- In-app issue forms, clear update-dialog states and manual access to downloaded installer files
- Detailed airport ground maps
- Runways, taxiways, taxilanes, aprons, terminals, parking stands, and labels
- Live aircraft position and heading through MSFS SimConnect or X-Plane 12 UDP DataRefs
- Optional nearby VATSIM traffic from the official public network-data feed,
  shown as orange aircraft with upright callsign labels; the local MSFS
  aircraft remains cyan
- Optional nearby BeyondATC traffic injected into MSFS, read through SimConnect
  and shown as violet aircraft with heading-aware callsign labels
- Dedicated SayIntentions traffic integration using the active local flight ID
  and the official SayIntentions Tracker, preserving real callsigns while
  matching aircraft to live SimConnect positions
- VATSIM, BeyondATC, and SayIntentions traffic displays are mutually exclusive;
  selecting one automatically disables and clears the other two
- Reliable aircraft-icon synchronization as soon as the map layer becomes
  ready, including for stationary aircraft and after switching airports
- Automatic recovery after legitimate long-distance telemetry gaps, so the
  destination-airport icon no longer requires restarting TaxiNow Pro
- Automatic switching to the aircraft's current airport after landing; if the
  map is missing, TaxiNow Pro opens the airport picker with a download prompt
- One consistent SVG aircraft icon on desktop and iPad, with immediate iPad
  rendering and a compact 32.4 px display size
- Taxiway pavement and outlines widened by 20% for clearer ground-map reading
- Simulator connection and synchronization status
- Manual position refresh
- English, Simplified Chinese, Traditional Chinese, Japanese, French, German, and Korean interface
- Settings menu with language selection and an optional **Keep window visible** mode
- Collision-aware header layout that folds content only when the rendered text would overlap
- Automatic taxi-route planning with multiple route choices
- Blue route highlighting, live progress, and turn guidance
- Experimental customized taxi-route entry with connected-taxiway filtering;
  commas, spaces, or mixed separators are accepted
- Manual taxi start and destination placement by right-click or touch-and-hold
- Dark and light appearances with a one-click sun/moon switch
- Detailed runway threshold, aiming-point, touchdown-zone, runway-number, and blast-pad/stopway graphics
- Automatic update checks with official download and in-app installer choices
- Remembers the last successfully displayed airport between launches
- Optional heading-up navigation lock with the aircraft followed at the lower center
- Airport search and quick ICAO map acquisition
- Map acquisition by ICAO, Country/Region, or Province/State
- Configurable batch workers: 1, 2, 4, 8, or 16; use 1 for public OSM
- Verified, resumable regional map packs when available, with automatic
  on-demand fallback for missing airports
- Progress, speed, elapsed time, and estimated remaining time
- Human-readable Chinese province and Japanese prefecture names
- Map library grouped by Country/Region → Province/State → Airport
- Storage usage, free-space information, and customizable storage location
- Optional access from another device on the same trusted local network
- Optional privacy-minimized vMAS online-presence integration, disabled by
  default and restricted to the authorized `https://vmas.my` origin
- Minimizes to the taskbar by default, with an optional persistent **Minimize to tray** setting

TaxiNow Pro uses continuous OSM and available FAA building footprints ahead of
modular X-Plane facade pieces. Preprocessed packs can additionally use
strictly filtered Overture and Microsoft global building footprints. Complete
parent-building outlines suppress overlapping building parts, and reliable
nearby terminal/concourse names are transferred to accepted unnamed
footprints. This improves fragmented or missing terminals while retaining
Gateway taxi-route and parking-position detail.

TaxiNow Pro now includes a repeatable worldwide preprocessing pipeline that splits
large countries by available province/state extracts and publishes bounded,
resumable, checksum-verified shards. A country becomes a fast batch download
after its generated packs are uploaded to the official index; countries not
yet published continue to use the slower on-demand fallback. Incomplete pilot
packs have been withdrawn and will not be offered to TaxiNow Pro clients.

Taxi-route guidance is generated by a generic pathfinding algorithm for flight
simulation. It may not reflect ATC instructions, taxiway direction, aircraft
wingspan limits, closures, or real-world procedures. Review every route before
use; customized taxi routes are available when an automatic route is unsuitable.

## 中文

- 默认打开 2D/3D 地球航线工作区，提供正北指南针
- SimBrief 导入航路点、机型及计划高度，用户名在浏览器中自动保存
- 全屏垂直剖面展示地形、计划高度、可用高度限制和实时 MSL/AGL；估算路径明确标注，过期遥测及时清除
- 根据飞行计划下载出发/到达机场地图，落地后切换目的地地面地图
- VATSIM 管制、天气雷达、GNSS 干扰及地形叠加图层
- 地面视图持续跟随飞机位置和航向，航线视图支持持续飞机跟随
- 下载卡住时手动尝试 X-Plane Scenery Gateway，最终以 OurAirports 跑道数据后备；数据细节因来源而异
- 紧凑顶部及底部、ICAO 机场选择器、统一飞行计划/航路信息面板和地图按钮尺寸
- 完整界面亮暗主题及可读性改进，桌面 WebView2 使用 sRGB 渲染
- 应用内问题表单、明确更新检查状态及手动打开更新安装包目录
- 详细的机场地面地图
- 显示跑道、滑行道、机坪、航站楼、停机位及相关编号
- 通过 MSFS SimConnect 或 X-Plane 12 UDP DataRef 显示飞机位置和航向
- 长途飞行中出现正常遥测间隔后可自动恢复位置跟踪，无需重启 TaxiNow Pro
- 落地后自动切换到飞机当前所在机场；地图未下载时自动打开机场选择器并提示下载
- 可选显示官方公开网络数据源中的附近 VATSIM 交通；其他飞机使用带呼号的
  橘色图标，本机 MSFS 飞机保持青色
- 可选显示由 BeyondATC 注入 MSFS 的附近交通；TaxiNow Pro 通过 SimConnect 读取，
  并使用带航向和呼号标签的紫色飞机图标显示
- 新增独立的 SayIntentions 交通功能：读取当前本地航班 ID，通过官方
  SayIntentions Tracker 保留真实呼号，并与 SimConnect 实时位置匹配
- VATSIM、BeyondATC 与 SayIntentions 三种交通来源互斥；选择一种会自动关闭
  并清除另外两种，避免重复显示
- 地图图层就绪后立即可靠同步飞机图标，飞机静止或切换机场后同样有效
- 桌面端与 iPad 使用相同的 SVG 飞机图标；iPad 可立即显示，图标尺寸统一为 32.4 px
- 滑行道灰色铺装及其边缘加宽 20%，提高地面地图辨识度
- 模拟器连接及位置同步状态
- 手动刷新飞机位置
- 英文、简体中文、繁体中文、日语、法语、德语和韩语界面
- 设置菜单包含语言选择及可选的**保持窗口始终可见**功能
- 页头会根据实际文字碰撞自动折叠，避免窄窗口下重叠或过早隐藏
- 自动规划滑行路线并提供多条路线选择
- 在地图上以蓝色高亮路线，提供实时进度与转向提示
- 支持实验性的自定义滑行路线输入，并按相邻关系筛选可选滑行道；可使用
  逗号、空格或混合方式分隔
- 支持通过右键或触摸长按地图指定滑行起点和目的地
- 新增深色与浅色外观，以及一键太阳/月亮切换按钮
- 新增详细的跑道入口、瞄准点、接地区、跑道号码及航向图形
- 新增自动检查更新、官方渠道下载及应用内下载安装选项
- 启动时恢复上次成功显示且仍已安装的机场
- 新增机头朝上导航锁定，并将飞机自动保持在画面下方中央
- 机场搜索及 ICAO 快速地图获取
- 按 ICAO、国家/地区或省/州获取地图
- 支持 1、2、4、8、16 个批量任务工作线程；公共 OSM 推荐使用 1
- 存在官方地区地图包时支持校验、断点续传，并对未包含的机场自动按需回退
- 显示进度、速度、已用时间和预计剩余时间
- 中国省级行政区与日本都道府县使用可读名称显示
- 按“国家/地区 → 省/州 → 机场”管理地图库
- 显示资源占用、剩余空间并支持自定义保存位置
- 可选的同一可信局域网内其他设备访问
- 默认最小化到任务栏，可在设置中启用并保存**最小化到托盘**

TaxiNow Pro 会优先使用连续的 OSM 及可用 FAA 建筑轮廓，不再让 X-Plane 模块化外墙
片段覆盖权威航站楼图形。预处理地图包还可严格筛选 Overture 与 Microsoft 全球
建筑轮廓；完整父建筑会压制重叠的建筑分块，可信的邻近航站楼/指廊名称会自动
传递到已接受的无名轮廓，从而尽量改善航站楼支离破碎、形状或标注缺失的问题。

TaxiNow Pro 现已包含可重复的全球预处理流水线，可按照可用的省/州提取包拆分大型国家，
并生成可断点续传、可并行且经过校验的有限大小分片。某个国家的地图包上传至官方
索引后，按国家下载才会进入高速路径；尚未发布地图包的国家仍使用较慢的按需回退。

滑行路线由通用寻路算法生成，仅供模拟飞行参考，可能不会考虑 ATC 指令、滑行道方向、
机翼跨度限制、临时关闭或真实运行程序。使用前请自行检查；自动路线不合适时可输入
自定义滑行路线。
