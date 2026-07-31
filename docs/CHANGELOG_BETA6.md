# TaxiNow V1.0 Beta 6 — development notes

Beta 6 is still in development. These notes distinguish completed work from
planned work and are not final release notes.

## Completed

- Correct runway-end designators from physical runway geometry instead of
  assuming that source references and LineString coordinates use the same
  order. This fixes reversed labels at ZBAA, ZGGG, and other airports while
  preserving L/C/R parallel-runway suffixes.
- Apply the correction in both the MapLibre renderer and the compatibility
  fallback renderer. Existing downloaded airport maps do not need to be
  downloaded again.
- Add regression coverage for north/south, east/west, correctly ordered,
  reversed, and parallel runways.

## Planned later

- Add and validate official Microsoft Flight Simulator 2020 support. This work
  is intentionally deferred until after the runway-label correction and is
  not included in the current change.

---

# TaxiNow V1.0 Beta 6 — 开发记录

Beta 6 仍在开发中。以下内容区分已经完成和计划后续完成的工作，并非最终发布
日志。

## 已完成

- 根据跑道真实几何方向匹配两端编号，不再假设数据源中的跑道编号顺序与坐标
  顺序一致。该修复可纠正 ZBAA、ZGGG 及其他机场中颠倒的跑道编号，同时保留
  L/C/R 平行跑道后缀。
- MapLibre 主渲染和兼容备用渲染均已采用相同修复。用户不需要重新下载已有
  机场地图。
- 新增南北向、东西向、原本顺序正确、顺序颠倒以及平行跑道的回归测试。

## 后续计划

- 增加并验证 Microsoft Flight Simulator 2020 官方支持。该工作有意安排在
  跑道编号修复之后，本次更改尚未包含 MSFS 2020 支持。
