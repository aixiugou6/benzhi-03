'use strict';

const { insertReadings } = require('./db');

/**
 * 内置示例数据：3 个样本、2 台设备。
 * 注意数组顺序故意打乱（模拟离线补传乱序到达），
 * 且包含 2 条重复记录（验证幂等去重）和若干超温点（> 8℃）。
 */
const SEED_RECORDS = [
  // 样本 SAMP-001 / 设备 DEV-A：采集于 08:00–13:00，乱序到达
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1003', collected_at: '2026-09-10T11:00:00Z', temperature: 4.1 },
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1001', collected_at: '2026-09-10T09:00:00Z', temperature: 3.2 },
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1005', collected_at: '2026-09-10T13:00:00Z', temperature: 9.6 },  // 超温
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1002', collected_at: '2026-09-10T10:00:00Z', temperature: 3.8 },
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1004', collected_at: '2026-09-10T12:00:00Z', temperature: 8.4 },  // 超温
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1000', collected_at: '2026-09-10T08:00:00Z', temperature: 2.9 },
  // 重复补传（应被去重）
  { sample_id: 'SAMP-001', device_id: 'DEV-A', record_id: 'A-1002', collected_at: '2026-09-10T10:00:00Z', temperature: 3.8 },

  // 样本 SAMP-002 / 设备 DEV-B：一次明显超温回升
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-202', collected_at: '2026-09-10T10:30:00Z', temperature: 5.5 },
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-200', collected_at: '2026-09-10T09:30:00Z', temperature: 4.8 },
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-204', collected_at: '2026-09-10T12:30:00Z', temperature: 11.2 }, // 超温
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-201', collected_at: '2026-09-10T10:00:00Z', temperature: 5.1 },
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-203', collected_at: '2026-09-10T11:30:00Z', temperature: 7.9 },
  { sample_id: 'SAMP-002', device_id: 'DEV-B', record_id: 'B-205', collected_at: '2026-09-10T13:30:00Z', temperature: 10.4 }, // 超温

  // 样本 SAMP-003 / 设备 DEV-A：全程正常
  { sample_id: 'SAMP-003', device_id: 'DEV-A', record_id: 'A-2001', collected_at: '2026-09-11T08:15:00Z', temperature: 3.0 },
  { sample_id: 'SAMP-003', device_id: 'DEV-A', record_id: 'A-2002', collected_at: '2026-09-11T09:15:00Z', temperature: 3.4 },
  { sample_id: 'SAMP-003', device_id: 'DEV-A', record_id: 'A-2003', collected_at: '2026-09-11T10:15:00Z', temperature: 3.1 },
  // 与 A-2002 同设备同记录号（应被去重）
  { sample_id: 'SAMP-003', device_id: 'DEV-A', record_id: 'A-2002', collected_at: '2026-09-11T09:15:00Z', temperature: 3.4 },
];

/** 幂等种子：重复执行不会插入重复数据 */
function seed(db) {
  return insertReadings(db, SEED_RECORDS);
}

module.exports = { seed, SEED_RECORDS };
