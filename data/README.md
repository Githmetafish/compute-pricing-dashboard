# 数据目录

生产数据文件固定为：

```text
data/compute-pricing.json
```

如果这个文件不存在、为空，或没有有效记录，面板会自动回退到 `sample-data.json`。

`sample-data.json` 只用于展示，不应当被当成真实监控数据。

推荐字段：

```json
{
  "date": "2026-07-06",
  "platform": "GCP Spot",
  "sku": "H100 SXM",
  "mode": "spot",
  "price": 3.62,
  "supply": 128,
  "discount": 0.59,
  "frequency": "daily"
}
```

`discount` 用小数表示，`0.59` 表示 59% 折扣。
