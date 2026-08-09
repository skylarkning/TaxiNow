# TaxiNow V1.3 — Build 114

Release date: August 9, 2026

TaxiNow V1.3 supports Microsoft Flight Simulator 2020 and 2024 on Windows x64.

## Changelog

- Added complete Korean interface support.
- Replaced the language globe with a Settings menu and moved language selection
  into its submenu.
- Added a persistent **Keep window visible** option for the Windows app.
- Fixed header overlap at narrow window widths by hiding the airport name first
  while retaining the ICAO code.
- Corrected Traditional Chinese FAQ wording, including the aircraft-position
  synchronization question after using simulator warp.
- Removed the obsolete fast-country-download FAQ entry.
- Added a multilingual FAQ statement clarifying that TaxiNow is not affiliated
  with NavApron and restating TaxiNow's copyright and reuse policy.
- Header content now collapses from measured on-screen collisions instead of
  fixed width thresholds, improving narrow-window behavior in every language.
- Expanded and retranslated the NavApron FAQ using the approved full statement.

Automatic routes are generic simulation guidance and may not reflect ATC
instructions, taxiway restrictions, aircraft limits, or real-world procedures.
TaxiNow must not be used for real-world navigation.

## Upgrade

Close TaxiNow, then run `TaxiNow-V1.3-Build-114-Setup.exe`. You may install it
over an earlier version. If you uninstall first, choose **Yes / Keep data** to
retain downloaded airport maps.

---

# TaxiNow V1.3 — 内部版本 114

发布日期：2026年8月9日

TaxiNow V1.3支持Windows x64上的Microsoft Flight Simulator 2020与2024。

## 更新日志

- 新增完整韩语界面。
- 将语言地球图标改为设置菜单，并把语言选择移入其子菜单。
- Windows客户端新增可保存的**保持窗口始终可见**选项。
- 修复窄窗口下页头文字重叠：空间不足时优先隐藏机场名称并保留ICAO。
- 修正繁体中文FAQ文字，包括“使用瞬移後，為什麼航機位置沒有同步？”。
- 删除已经不再需要的“按国家高速下载”FAQ。
- 新增多语言FAQ，说明TaxiNow与NavApron无关联，并重申TaxiNow的版权与复用政策。
- 页头现按屏幕上的实际文字碰撞逐级折叠，不再使用固定宽度阈值，改善所有语言的窄窗口显示。
- 按获准的完整声明扩展并重新翻译NavApron多语言FAQ。

自动路线仅为通用算法生成的模拟飞行参考，可能不会反映ATC指令、滑行道限制、
机型限制或真实运行程序。严禁将TaxiNow用于真实飞行导航。

## 升级方法

关闭TaxiNow，然后运行`TaxiNow-V1.3-Build-114-Setup.exe`，可直接覆盖安装旧版本。
如先卸载旧版，请选择**“是 / 保留数据”**，以继续使用已下载的机场地图。

## Acknowledgements and credits / 致谢

TaxiNow thanks the contributors and maintainers of OpenStreetMap, OurAirports,
FAA Airport Mapping Open Data, Geofabrik, Overture Maps, Microsoft Global ML
Building Footprints, X-Plane Scenery Gateway, SkyCharts, MapLibre GL JS,
Microsoft .NET, WebView2, SimConnect, SQLite, PyInstaller, and Inno Setup.

TaxiNow is free for personal, non-commercial flight-simulation use and is
provided **“AS IS”**, without warranties of any kind.
