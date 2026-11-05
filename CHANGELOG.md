# Changelog

## 0.1.0 — 2026-11-06

首个版本：能力漂移检测。

- `drift_baseline` / `drift_check` / `drift_list` 三个工具
- 能力画像：安装期脚本、危险 API、外联域名、凭据路径、原生依赖
- 只报新增（删除与版本号变化不报），严重度分 high / medium / low
- 画像稳定：同目录两次结果一致
- 测试 14 条断言（正常 / 新增 shell / 能力减少 / 新增 hook+凭据 / 新增域名 / 只改版本号）
