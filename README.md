# 实验室样本冷链记录系统

记录实验室样本在冷链运输/存储过程中的温度数据，支持设备**离线补传**（幂等去重）、**乱序到达数据按采集时间还原温度轨迹**并标注超温点，前端页面可按样本和时间范围筛选查询。

- 前端：原生 HTML / CSS / JS（无构建步骤）
- 后端：Node.js + Express
- 数据库：SQLite（使用 Node 22 内置 `node:sqlite`，零原生依赖）

## 数据字段

| 字段 | 说明 |
|---|---|
| `sample_id` | 样本编号 |
| `device_id` | 设备编号 |
| `record_id` | 设备侧记录编号（与设备编号共同构成去重键） |
| `collected_at` | 采集时间（ISO 8601，服务端统一归一化为 UTC） |
| `temperature` | 温度值（℃） |
| `is_overtemp` | 超温状态，入库时按阈值（默认 8℃，`OVERTEMP_THRESHOLD` 环境变量可改）自动判定：`temperature > 阈值` 即超温 |

## 启动

```bash
npm install
npm start          # 默认 http://localhost:3000，PORT 环境变量可改端口
```

首次启动自动建库（`data/coldchain.db`）并写入 15 条内置示例数据
（3 个样本、2 台设备，含乱序到达和超温片段；种子本身幂等，重复启动不会插重）。

打开浏览器访问 <http://localhost:3000>：选择样本、起止时间后点「查询」，
页面展示统计卡片、温度轨迹图（红色点为超温，红色虚线为阈值线）和明细表。

## 验证

### 自动化测试

```bash
npm test
```

覆盖题目要求的两大块（`test/api.test.js`，使用内存数据库，不影响本地数据）：

1. **离线补传幂等去重**：同批/跨批重复上传 `(device_id, record_id)` 相同的记录只入库一条；
   不同设备的相同记录号互不影响；非法记录被拒绝且不影响同批合法记录。
2. **乱序还原轨迹与超温标注**：乱序到达（含后补一条更早的历史记录）的数据，
   轨迹接口始终按采集时间升序返回，超温点（> 阈值）标注正确，统计值正确。
   另附样本 + 时间范围筛选的接口测试。

### 手工验证（curl）

```bash
# 1) 批量补传两条记录
curl -X POST http://localhost:3000/api/readings/batch \
  -H 'Content-Type: application/json' \
  -d '{"records":[
    {"sample_id":"SAMP-001","device_id":"DEV-A","record_id":"A-9001","collected_at":"2026-09-10T14:00:00Z","temperature":6.1},
    {"sample_id":"SAMP-001","device_id":"DEV-A","record_id":"A-9002","collected_at":"2026-09-10T15:00:00Z","temperature":9.9}
  ]}'
# → {"received":2,"inserted":2,"duplicates":0,...}

# 2) 原样重发同一批（模拟设备离线恢复后重传）→ 只算一条都不插
curl -X POST http://localhost:3000/api/readings/batch \
  -H 'Content-Type: application/json' \
  -d '{"records":[
    {"sample_id":"SAMP-001","device_id":"DEV-A","record_id":"A-9001","collected_at":"2026-09-10T14:00:00Z","temperature":6.1},
    {"sample_id":"SAMP-001","device_id":"DEV-A","record_id":"A-9002","collected_at":"2026-09-10T15:00:00Z","temperature":9.9}
  ]}'
# → {"received":2,"inserted":0,"duplicates":2,...}

# 3) 查看还原后的轨迹（按采集时间升序，与到达顺序无关），9.9℃ 那条 is_overtemp=1
curl "http://localhost:3000/api/samples/SAMP-001/trajectory"

# 4) 按样本 + 时间范围筛选
curl "http://localhost:3000/api/readings?sample_id=SAMP-001&from=2026-09-10T12:00:00Z&to=2026-09-10T16:00:00Z"
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/readings/batch` | 批量补传 `{records:[...]}`，返回 `{received, inserted, duplicates, rejected, errors}` |
| `POST` | `/api/readings` | 单条上报，重复时返回 200 且 `duplicate: true` |
| `GET` | `/api/readings?sample_id=&from=&to=` | 明细查询（按采集时间升序） |
| `GET` | `/api/samples` | 样本列表及各自记录数/超温数 |
| `GET` | `/api/samples/:id/trajectory?from=&to=` | 温度轨迹 + 统计（count / overtemp_count / min / max / avg） |

## 设计要点

- **幂等去重**：表上建 `UNIQUE(device_id, record_id)`，写入用 `INSERT OR IGNORE`，
  靠 `changes` 计数区分「新插入」与「重复」，天然幂等，重传任意多次结果一致。
- **乱序还原**：采集时间入库时归一化为 UTC ISO 字符串，查询一律 `ORDER BY collected_at`，
  轨迹与到达顺序完全解耦；后补的历史数据自动插入轨迹正确位置。
- **超温判定**：入库时按统一阈值计算 `is_overtemp` 落库，保证列表、轨迹、统计口径一致。

## 目录结构

```
src/
  index.js   入口：建库、写种子、启动服务
  server.js  Express 应用与路由（createApp 可注入测试库）
  db.js      SQLite 连接、schema、校验、写入/查询逻辑
  seed.js    内置示例数据（幂等）
public/      原生前端（index.html / style.css / app.js）
test/        node:test 测试（内存库，不碰 data/）
```
