# AI 算力价格监控面板

这是一个 Vercel 可发布的静态面板，用来跟踪 GPU 云租赁价格、可用供给和折扣变化。

## 文件结构

```text
index.html
styles.css
app.js
sample-data.json
data/compute-pricing.json
scripts/normalize-data.mjs
scripts/fetch-prices.mjs
vercel.json
```

面板优先读取 `data/compute-pricing.json`。如果这个文件为空或没有有效记录，会自动回退到 `sample-data.json`。

注意：`sample-data.json` 只用于展示面板效果，不会被抓取脚本写入生产数据。

## 本地预览

```bash
python3 -m http.server 4173
```

然后打开：

```text
http://localhost:4173
```

## Vercel 发布

1. 把本目录推到 GitHub。
2. Vercel 新建项目，选择这个目录作为项目根目录。
3. Framework 选择 `Other` 或静态站点。
4. Build Command 留空。
5. Output Directory 留空。

如果你把 `outputs/compute-pricing-dashboard` 里的文件直接作为一个新仓库根目录，Vercel 可以直接发布。

也可以用 Vercel CLI 直接发布：

```bash
npm i -g vercel
vercel login
npm run deploy:prod
```

或者直接运行本目录里的脚本：

```bash
./publish-to-vercel.sh
```

如果使用 token：

```bash
VERCEL_TOKEN=your_token npx vercel --prod --token "$VERCEL_TOKEN"
```

## 更新数据

把新的 `.json` 或 `.csv` 转成生产数据：

```bash
node scripts/normalize-data.mjs --out data/compute-pricing.json raw-data.csv
```

只检查数据格式：

```bash
npm run validate:data
```

抓取公开报价并合并进生产数据：

```bash
npm run fetch:prices
```

只抓部分平台：

```bash
npm run fetch:prices -- --sources runpod,lambda,coreweave
```

当前抓取策略：

| 来源 | 方式 | 说明 |
|---|---|---|
| RunPod | 公开 pricing 页 | 抓 Pods 的 Secure Cloud 报价 |
| Lambda | 公开 pricing 页 | 抓 Instances 的 `PRICE/GPU/HR` |
| CoreWeave | 公开 pricing 页 | 抓 on-demand/spot，按 GPU count 折成单 GPU 小时 |
| Vast.ai | 官方 bundles API | 需要 `VAST_API_KEY`，取 p25 单 GPU 小时价和 offer 数 |
| GCP Spot | 手动 JSON 或远程 JSON | 用 `data/manual/gcp-spot.json` 或 `GCP_SPOT_JSON_URL` 注入 |

Vercel 只负责展示，不适合把抓取结果写回仓库。推荐用 GitHub Actions 定时抓取并提交 `data/compute-pricing.json`，提交后 Vercel 自动重新部署。

如果某次抓取没有拿到任何有效数据，脚本会保留旧的 `data/compute-pricing.json`，不会用样本数据覆盖。

## GitHub Actions 定时更新

已经内置 workflow：

```text
.github/workflows/update-prices.yml
```

如果把本目录作为 GitHub 仓库根目录，它会每天运行一次，也可以在 Actions 页面手动触发。

可选 secrets：

```text
VAST_API_KEY
GCP_SPOT_JSON_URL
```

没有 `VAST_API_KEY` 时会跳过 Vast.ai；没有 `GCP_SPOT_JSON_URL` 时会读取 `data/manual/gcp-spot.json`。

## 数据格式

支持导入 `.json` 或 `.csv`。字段如下：

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
