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

`supply` 表示可观察供给，不是统一库存口径。Vast.ai 当前用符合条件的公开 offer 数；其他平台未披露实时库存时页面显示“无法抓取数据”，表示未抓到公开供给数据，不代表没有库存。

GCP Spot 默认优先通过 Google Cloud Billing Catalog API 抓取公开 Spot/Preemptible GPU SKU。要启用自动抓取，在 GitHub Actions secrets 里设置 `GCP_BILLING_API_KEY`。未设置时，脚本会继续尝试 `GCP_SPOT_JSON_URL` 和 `data/manual/gcp-spot.json`。
