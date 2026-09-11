'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/** 冷链超温阈值（℃），可用环境变量 OVERTEMP_THRESHOLD 覆盖 */
const OVERTEMP_THRESHOLD = Number(process.env.OVERTEMP_THRESHOLD ?? 8);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id    TEXT NOT NULL,          -- 样本编号
  device_id    TEXT NOT NULL,          -- 设备编号
  record_id    TEXT NOT NULL,          -- 设备侧记录编号（离线补传去重依据）
  collected_at TEXT NOT NULL,          -- 采集时间（ISO 8601, UTC）
  temperature  REAL NOT NULL,          -- 温度值（℃）
  is_overtemp  INTEGER NOT NULL,       -- 超温状态：1 超温 / 0 正常
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (device_id, record_id)        -- 同一设备同一条记录只算一条
);
CREATE INDEX IF NOT EXISTS idx_readings_sample_time ON readings (sample_id, collected_at);
`;

function createDb(dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coldchain.db')) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

/** 校验并规范化单条记录，返回 { ok, value | error } */
function validateRecord(rec) {
  if (rec === null || typeof rec !== 'object') {
    return { ok: false, error: '记录必须是对象' };
  }
  const { sample_id, device_id, record_id, collected_at, temperature } = rec;
  for (const [k, v] of [['sample_id', sample_id], ['device_id', device_id], ['record_id', record_id]]) {
    if (typeof v !== 'string' || v.trim() === '') {
      return { ok: false, error: `字段 ${k} 必须是非空字符串` };
    }
  }
  const temp = Number(temperature);
  if (!Number.isFinite(temp)) {
    return { ok: false, error: '字段 temperature 必须是有限数值' };
  }
  const t = new Date(collected_at);
  if (Number.isNaN(t.getTime())) {
    return { ok: false, error: '字段 collected_at 不是可解析的时间' };
  }
  return {
    ok: true,
    value: {
      sample_id: sample_id.trim(),
      device_id: device_id.trim(),
      record_id: record_id.trim(),
      collected_at: t.toISOString(),
      temperature: temp,
      // 超温状态在入库时按阈值统一判定，保证轨迹标注口径一致
      is_overtemp: temp > OVERTEMP_THRESHOLD ? 1 : 0,
    },
  };
}

/**
 * 批量写入（离线补传入口）。幂等：依赖 (device_id, record_id) 唯一约束，
 * 重复记录 INSERT OR IGNORE 后 changes === 0，计为 duplicate。
 * 返回 { received, inserted, duplicates, rejected, errors }
 */
function insertReadings(db, records) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO readings (sample_id, device_id, record_id, collected_at, temperature, is_overtemp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = { received: records.length, inserted: 0, duplicates: 0, rejected: 0, errors: [] };
  for (let i = 0; i < records.length; i++) {
    const v = validateRecord(records[i]);
    if (!v.ok) {
      result.rejected++;
      result.errors.push({ index: i, error: v.error });
      continue;
    }
    const r = v.value;
    const { changes } = stmt.run(r.sample_id, r.device_id, r.record_id, r.collected_at, r.temperature, r.is_overtemp);
    if (changes > 0) result.inserted++;
    else result.duplicates++;
  }
  return result;
}

/**
 * 温度轨迹：按采集时间升序还原（与到达顺序无关），并附统计。
 */
function getTrajectory(db, sampleId, { from, to } = {}) {
  const rows = queryReadings(db, { sample_id: sampleId, from, to });
  const temps = rows.map(r => r.temperature);
  const stats = rows.length === 0 ? null : {
    count: rows.length,
    overtemp_count: rows.filter(r => r.is_overtemp).length,
    min: Math.min(...temps),
    max: Math.max(...temps),
    avg: Number((temps.reduce((a, b) => a + b, 0) / rows.length).toFixed(2)),
  };
  return { sample_id: sampleId, threshold: OVERTEMP_THRESHOLD, points: rows, stats };
}

/** 通用查询：按样本 + 时间范围筛选，始终按采集时间升序返回 */
function queryReadings(db, { sample_id, from, to } = {}) {
  const where = [];
  const args = [];
  if (sample_id) { where.push('sample_id = ?'); args.push(sample_id); }
  if (from) {
    const d = new Date(from);
    if (Number.isNaN(d.getTime())) throw new Error('from 时间无法解析');
    where.push('collected_at >= ?'); args.push(d.toISOString());
  }
  if (to) {
    const d = new Date(to);
    if (Number.isNaN(d.getTime())) throw new Error('to 时间无法解析');
    where.push('collected_at <= ?'); args.push(d.toISOString());
  }
  const sql = `SELECT id, sample_id, device_id, record_id, collected_at, temperature, is_overtemp, created_at
               FROM readings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY collected_at ASC, id ASC`;
  return db.prepare(sql).all(...args);
}

function listSamples(db) {
  return db.prepare(`
    SELECT sample_id,
           COUNT(*) AS count,
           SUM(is_overtemp) AS overtemp_count,
           MIN(collected_at) AS first_collected_at,
           MAX(collected_at) AS last_collected_at
    FROM readings GROUP BY sample_id ORDER BY sample_id
  `).all();
}

module.exports = { createDb, insertReadings, getTrajectory, queryReadings, listSamples, validateRecord, OVERTEMP_THRESHOLD };
