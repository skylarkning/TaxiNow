# TaxiNow V1.2 — Build 111

Build date: August 6, 2026

- Added complete Traditional Chinese and Japanese interface translations.
- TaxiNow now opens the last successfully displayed airport when it is still
  installed, instead of always preferring CYYZ.
- Added an optional heading-up map lock. It keeps the aircraft heading at the
  top and follows the aircraft from the lower center, while preserving the
  existing free-rotation and north-reset controls.
- Improved arrival taxi routing with aircraft-heading-aware start snapping,
  rejection of reverse runway exits, and prevention of near-180-degree ground
  reversals.
- Rebalanced route scoring so main taxiways remain preferred without allowing
  a clearly longer loop to beat a practical direct connection.

---

# TaxiNow V1.2 — 内部版本 111

构建日期：2026年8月6日

- 新增完整的繁体中文和日语界面。
- 启动时优先打开上次成功显示且仍已安装的机场，不再总是优先打开 CYYZ。
- 新增机头朝上地图锁定模式：飞机保持机头朝上并位于画面下方中央，同时保留原有自由旋转和恢复朝北功能。
- 到达滑行路线现在会结合飞机实时航向选择接入点，排除反向跑道脱离，并阻止接近 180° 的原地掉头路线。
- 重新平衡主滑行道权重，继续优先使用主滑行道，同时避免明显绕远的路线胜过合理直达路线。
