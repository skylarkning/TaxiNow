# TaxiNow Pro user guide / 使用指南

[Back to README / 返回首页](../README.md)

## English

### Introduction

TaxiNow Pro is a Windows application running locally on your PC. V2.0 brings
airport ground maps, a 2D/3D globe route workspace, SimBrief import and a vertical
route profile together. It displays live aircraft position, heading and altitude
from MSFS through SimConnect or X-Plane 12 through the local UDP DataRef interface.

TaxiNow Pro is intended exclusively for personal flight-simulator use. It is not
certified or suitable for real-world aviation, navigation, flight planning, or
operational training.

### Simulator compatibility

- **Microsoft Flight Simulator 2024:** tested and supported
- **Microsoft Flight Simulator 2020:** tested and supported
- **X-Plane 12:** supported through local UDP DataRefs (default port 49000); run on the same PC as TaxiNow Pro

### Features

See [detailed features](FEATURES.md).

### Installation

1. Close TaxiNow Pro. V2.0 may be installed over an earlier version. If you prefer
   to uninstall first, choose **Yes** when asked to keep downloaded maps and
   user data so the new installation can reuse them.
2. Download the installer from one of the two official channels above.
3. Run `TaxiNow-Pro-V2.0-Build-207-Setup.exe`.
4. Read and accept the EULA.
5. Complete setup and launch TaxiNow Pro.

TaxiNow Pro installs for the current Windows user and normally does not require
administrator privileges. Required Windows components are detected or
installed automatically.

### Getting started

1. Start TaxiNow Pro and MSFS 2020/2024 or X-Plane 12 on the same PC.
2. The Route globe is the default view. Open **Flight → Import** to load a SimBrief plan.
3. Use **Route Info** for waypoint details or **Profile** for the vertical route display.
4. Select an airport using its ICAO code, download its map if needed, and switch to **Taxi** for ground navigation.
5. Once simulator synchronization is green, enable aircraft follow as needed.
6. Use **Maps & storage** for downloads and storage. For a stalled or failed airport download, try the fallback-source action.

Portable users: extract the ZIP and run `TaxiNow.App.exe`. WebView2 Runtime is
required. Portable does not create shortcuts or perform installer prerequisite
checks, and maps remain in the configured user-data location.

### Access from another device

TaxiNow Pro can display the active map on another device connected to the same
trusted private network. Use the local-network address shown in the header.
Supported baseline: Android 10+ with Firefox 114+, or iOS/iPadOS 16.4+ with Safari.
The browser and GPU must support WebGL 2.0; keep the PC application running.

The local companion view uses HTTP without authentication. Do not expose its
port through a router, and do not use this feature on public or untrusted
networks. If Windows Firewall asks, allow Private networks only.

### Security and privacy

TaxiNow Pro does not require an account, contain advertising, include built-in
behavioral analytics, or automatically upload crash reports. Maps, settings,
logs, caches, and the asset database are stored locally.

For ground tracking, TaxiNow Pro reads latitude, longitude, true heading,
on-ground state, ground speed, and available MSL/AGL altitude from the simulator. It does not intentionally
send live aircraft position to map-data providers.

The optional VATSIM traffic setting is off by default. When enabled, TaxiNow Pro's
PC service requests the official public VATSIM network-data feed, caches it for
about 15 seconds, and forwards only the nearby aircraft fields needed for the
map. Local simulator telemetry is not sent to VATSIM.

The optional BeyondATC and SayIntentions traffic settings are also off by
default. BeyondATC traffic is read from non-user aircraft already injected into
MSFS through SimConnect. For SayIntentions, TaxiNow Pro reads only the active
`flight_id` from the documented local SAPI response, then requests that flight's
traffic from the official SayIntentions Tracker so real callsigns can be matched
to live simulator positions. TaxiNow Pro does not expose or log the SayIntentions
API key, email address, or other account fields. Only one of VATSIM, BeyondATC,
or SayIntentions traffic can be displayed at a time.

### Public source code and antivirus reports

After a user raised concerns about some antivirus software reporting TaxiNow Pro
as malware, I decided to make the source code publicly available here at
[skylarkning/TaxiNow](https://github.com/skylarkning/TaxiNow).

TaxiNow Pro does not contain malicious code or viruses. I welcome everyone to
inspect the source code to verify this. If you find a security vulnerability,
please [open an issue on GitHub](https://github.com/skylarkning/TaxiNow/issues)
or contact me directly.

I have opened the source for public inspection. If you want to reuse anything
from TaxiNow Pro, please read the [License](../LICENSE), [EULA](../EULA.txt), and
[third-party notices](../NOTICE) first. Making the source public does not change
those terms or grant unrestricted permission to reuse it.

Thank you for using TaxiNow Pro.

### License and disclaimer

TaxiNow Pro is copyrighted software with publicly available source code.
It is not public-domain software; source access does not change the license terms. It is provided free of charge for personal, non-commercial
flight-simulation use. Commercial use, real-world navigation, modification,
derivative works, resale, rehosting, and redistribution are prohibited unless
I give prior written permission.

**TaxiNow Pro is provided “AS IS” and “AS AVAILABLE”, without warranties of any
kind.**

See the [License](../LICENSE), [EULA](../EULA.txt), [Disclaimer](../DISCLAIMER.md), and
[third-party notices](../NOTICE) for the complete terms.

### Uninstallation

Use **Windows Settings → Apps → Installed apps → TaxiNow Pro → Uninstall**, or the
TaxiNow Pro uninstall shortcut in the Start menu.

Uninstallation always removes the application. It then asks whether to retain
downloaded maps and user data. Choose **Yes** (recommended for upgrades) to
reuse maps and settings after reinstalling, or **No** to permanently delete
TaxiNow Pro databases, caches, settings, logs, and downloaded assets.

### Troubleshooting

- **Already running:** restore TaxiNow Pro from the notification-area icon, or
  right-click it and select **Quit**.
- **Blank window:** close TaxiNow Pro, run setup again to repair required
  components, restart Windows, and try again.
- **Red simulator status:** start MSFS 2024, MSFS 2020 or X-Plane 12 and load a flight, then restart
  TaxiNow Pro if necessary.
- **Orange simulator status:** finish loading the flight, remain on the ground,
  wait briefly, and use position refresh.
- **Missing aircraft icon:** select the correct airport and confirm the
  synchronization status is green.
- **VATSIM traffic refreshes only occasionally:** the official VATSIM
  network-data feed is regenerated about every 15 seconds. TaxiNow Pro follows
  that cadence and shares one PC-side cache between desktop and iPad views.
- **BeyondATC labels are missing or incorrect:** confirm BeyondATC has injected
  traffic into the current MSFS flight, then enable only **Show BeyondATC
  Traffic** in TaxiNow Pro. SimConnect does not identify which application injected
  an AI aircraft, so other MSFS AI traffic should be disabled.
- **SayIntentions traffic shows no aircraft:** confirm SayIntentions is running
  an active flight with AI traffic enabled, then select **Show SayIntentions
  Traffic**. TaxiNow Pro obtains the active flight ID locally and uses the official
  Tracker for callsigns; VATSIM and BeyondATC display will turn off automatically.
- **Slow map acquisition:** use 1 batch worker and retry later. Public OSM
  server-side processing is often slower when several requests compete for
  the same per-user slots. OSM normally takes 5–30 seconds; busy airports can take
  30–90 seconds. TaxiNow Pro marks an unchanged request as stalled after 45
  seconds and stops waiting for OSM after 120 seconds.

- **Stalled airport download:** use the fallback-source button in Maps & storage; fallback maps may contain less detail.
- **Old update installers:** Settings → Open update installer folder opens the folder for manual cleanup; wait until downloading or installation has finished.

### Airport-map limitations

TaxiNow Pro combines several imperfect datasets and cannot guarantee correct,
complete, or current drawing for every airport worldwide. A building-footprint
source may have no terminal name, while an aviation source may have a
“Terminal X” point but no usable outline. TaxiNow Pro matches trustworthy labels,
gate clusters, and nearby geometry automatically, but does not invent terminal
numbers and does not maintain manual per-airport drawing corrections.

---

## 中文

### 简介

TaxiNow Pro 是一款运行于本地 Windows 电脑的软件。V2.0 将机场地面地图、2D/3D
地球航线、SimBrief 导入和垂直航线剖面整合到同一工作区，通过 SimConnect 连接
MSFS，或通过本机 UDP DataRef 接口连接 X-Plane 12，显示飞机实时位置、航向和高度。

TaxiNow Pro 仅限个人模拟飞行使用，严禁用于真实飞行、真实导航、飞行计划或运行
训练。

### 模拟器兼容性

- **Microsoft Flight Simulator 2024：**已经测试并支持
- **Microsoft Flight Simulator 2020：**已经测试并支持
- **X-Plane 12：**支持本机 UDP DataRef 遥测，默认端口 49000；与 TaxiNow Pro 在同一电脑运行

### 功能

参阅[功能详解](FEATURES.md)。

### 安装方法

1. 关闭 TaxiNow Pro。V2.0 可以直接覆盖安装旧版本；如果希望先卸载，卸载器询问是否
   保留地图和用户数据时请选择 **“是”**，新版安装后即可继续使用。
2. 从上述两个官方渠道之一下载安装程序。
3. 运行 `TaxiNow-Pro-V2.0-Build-207-Setup.exe`。
4. 阅读并同意最终用户许可协议。
5. 完成安装并启动 TaxiNow Pro。

TaxiNow Pro 按当前 Windows 用户安装，通常不需要管理员权限。必要的 Windows
组件会由安装程序自动检测或安装。

### 使用方法

1. 在同一电脑启动 TaxiNow Pro 和 MSFS 2020/2024 或 X-Plane 12。
2. 默认显示地球航线。打开**飞行计划 → 导入**，载入 SimBrief 计划。
3. **航路信息**查看航路点，**垂直 / Profile**查看垂直航线剖面。
4. 通过 ICAO 选择机场，地图缺失时先下载，切换到**地面**查看滑行地图。
5. 模拟器同步为绿色后，可按需要开启飞机跟随。
6. 在**地图管理 / Maps & storage**管理下载及存储；机场下载卡住或失败时可尝试后备资源。

Portable 用户解压 ZIP 后运行 `TaxiNow.App.exe`，需要 WebView2 Runtime。
便携版不创建快捷方式或进行安装器前置检查，地图仍保存在配置的用户数据目录。

### 其他设备访问

TaxiNow Pro 可以在同一可信私人局域网中的其他设备上显示当前地图。请使用软件
顶部显示的局域网地址，并保持电脑端运行。支持基线为 Android 10+ 与 Firefox 114+，
或 iOS/iPadOS 16.4+ 与 Safari；浏览器及 GPU 需支持 WebGL 2.0。

该本地辅助功能使用不带身份验证的 HTTP。请勿在路由器中开放其端口，也不要
在公共或不可信网络中使用。如果 Windows 防火墙询问权限，请仅允许专用网络。

### 安全与隐私

TaxiNow Pro 不要求注册账号，不包含广告，不包含内置行为分析，也不会自动上传
崩溃报告。地图、设置、日志、缓存和资源数据库均保存在本机。

为了显示地面位置，TaxiNow Pro 仅从模拟器读取纬度、经度、真航向、是否在地面及
地速以及可用的海拔/离地高度。TaxiNow Pro 不会主动将实时飞机位置发送给地图数据提供方。

可选的 VATSIM 交通功能默认关闭。启用后，TaxiNow Pro 的电脑端服务会请求 VATSIM
官方公开网络数据源，缓存约 15 秒，并仅向地图提供显示附近飞机所需的字段。
TaxiNow Pro 不会把本机模拟器遥测发送给 VATSIM。

可选的 BeyondATC 与 SayIntentions 交通功能同样默认关闭。BeyondATC 交通直接通过
SimConnect 读取已经注入 MSFS 的非本机飞机。SayIntentions 模式仅从官方文档所述的
本地 SAPI 响应读取当前 `flight_id`，再通过官方 SayIntentions Tracker 获取该航班的
交通，以便将真实呼号与模拟器实时位置匹配。TaxiNow Pro 不会公开或记录 SayIntentions
API Key、邮箱地址或其他账户字段。VATSIM、BeyondATC 与 SayIntentions 一次只能
显示一种交通来源。

### 公开源代码与杀毒软件报告

针对用户评论中提到部分杀毒软件将 TaxiNow Pro 报告为恶意软件的担忧，
我决定在 [skylarkning/TaxiNow](https://github.com/skylarkning/TaxiNow)
公开源代码。

TaxiNow Pro 不包含恶意代码或病毒。我欢迎所有人检查源代码进行核验。
如果发现安全漏洞，请[在 GitHub 提交 issue](https://github.com/skylarkning/TaxiNow/issues)，
或直接联系我。

我已公开源代码供大家检查。如果你想复用 TaxiNow Pro 的任何内容，
请先阅读[许可证](../LICENSE)、[EULA](../EULA.txt)和[第三方声明](../NOTICE)。
源代码公开不改变这些条款，也不代表获得不受限制的复用权限。

感谢使用 TaxiNow Pro。

### 许可与免责声明

TaxiNow Pro 是源代码已公开的受版权保护的软件，并非公有领域软件。
源代码公开不改变许可证条款。软件完全免费，仅供个人、
非商业模拟飞行使用。未经我事先书面授权，禁止商业使用、真实飞行导航、
修改、二次创作、倒卖、重新托管或重新分发。

**TaxiNow Pro 按“现状”和“可用状态”提供，不作任何形式的担保。**

完整条款请参阅[许可协议](../LICENSE)、[最终用户许可协议](../EULA.txt)、
[免责声明](../DISCLAIMER.md)和[第三方声明](../NOTICE)。

### 卸载方法

通过 **Windows 设置 → 应用 → 已安装的应用 → TaxiNow Pro → 卸载**，或使用开始
菜单中的 TaxiNow Pro 卸载快捷方式。

卸载会删除 TaxiNow Pro 程序，并询问是否保留已下载地图和用户数据。升级时建议选择
**“是”**，重新安装后可继续使用地图与设置；选择 **“否”** 才会永久删除数据库、
缓存、设置、日志和已下载资源。

### 常见问题

- **提示已经运行：**从系统托盘恢复 TaxiNow Pro，或右键选择 **Quit**。
- **窗口空白：**退出 TaxiNow Pro，重新运行安装程序修复必要组件，重启 Windows
  后再次尝试。
- **模拟器状态为红色：**启动 MSFS 2024、MSFS 2020 或 X-Plane 12 并进入飞行，必要时重新启动 TaxiNow Pro。
- **模拟器状态为橙色：**等待飞行完全加载并保持飞机在地面，然后刷新位置。
- **没有飞机图标：**选择正确机场并确认同步状态为绿色。
- **VATSIM 交通不是持续刷新：**VATSIM 官方网络数据源约每 15 秒生成一次。
  TaxiNow Pro 遵循这一频率，并让桌面端与 iPad 共用电脑端缓存。
- **BeyondATC 呼号缺失或不正确：**确认 BeyondATC 已向当前 MSFS 飞行注入交通，
  并只启用 TaxiNow Pro 的**显示 BeyondATC 交通**。SimConnect 无法识别 AI 飞机由哪个
  程序注入，因此应关闭其他 MSFS AI 交通来源。
- **SayIntentions 没有显示交通：**确认 SayIntentions 正在运行有效航班且已开启
  AI 交通，然后选择**显示 SayIntentions 交通**。TaxiNow Pro 会在本地取得当前航班 ID，
  并使用官方 Tracker 获取呼号；VATSIM 与 BeyondATC 显示会自动关闭。
- **地图获取较慢：**选择 1 个批量任务工作线程并稍后重试。公共 OSM
  会按用户分配请求槽位，同时发送更多请求往往反而更慢。OSM 通常需要
  5–30 秒，繁忙或复杂机场可能需要 30–90 秒。连续 45
  秒无有效进展时 TaxiNow Pro 会标记为疑似卡住，等待 OSM 的最长时间为
  120 秒。中国大陆用户如果持续遇到连接重置或超时（部分中国电信线路
  尤其明显），可更换网络，或在遵守当地法律及服务条款的前提下使用可靠的
  VPN/网络加速服务后重试。

- **机场下载疑似卡住：**在地图管理中尝试后备资源，后备地图的细节可能较少。
- **清理旧更新包：**设置 → 打开更新安装包目录，下载或安装结束后自行清理，程序不会自动删除文件。

### 机场地图技术限制

TaxiNow Pro 融合多种并不完美的数据源，无法保证全球每一座机场的绘制都正确、完整或
保持最新。建筑轮廓数据可能没有航站楼名称，航空数据也可能只有“Terminal X”
名称点而没有可用轮廓。TaxiNow Pro 会自动匹配可信名称、登机口簇与邻近图形，但不会
凭空编造航站楼编号，也不维护逐机场的人工绘图修正。

---
