'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, OVERTEMP_THRESHOLD } = require('../src/db');
const { createApp } = require('../src/server');

let server, base, db;

before(async () => {
  db = createDb(':memory:');
  server = createApp(db).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); db.close(); });

async function postBatch(records) {
  const res = await fetch(`${base}/api/readings/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  return { status: res.status, body: await res.json() };
}

const rec = (record_id, collected_at, temperature, extra = {}) => ({
  sample_id: 'SAMP-T1', device_id: 'DEV-T', record_id, collected_at, temperature, ...extra,
});

/* ---------- 第一块：离线补传幂等去重 ---------- */

test('同一设备同一条记录重复补传只算一条', async () => {
  const r1 = await postBatch([
    rec('T-001', '2026-09-10T08:00:00Z', 3.5),
    rec('T-002', '2026-09-10T09:00:00Z', 4.0),
  ]);
  assert.equal(r1.status, 200);
  assert.deepEqual(
    { inserted: r1.body.inserted, duplicates: r1.body.duplicates, rejected: r1.body.rejected },
    { inserted: 2, duplicates: 0, rejected: 0 },
  );

  // 同一批记录原样重传（设备离线恢复后重发）
  const r2 = await postBatch([
    rec('T-001', '2026-09-10T08:00:00Z', 3.5),
    rec('T-002', '2026-09-10T09:00:00Z', 4.0),
  ]);
  assert.equal(r2.body.inserted, 0);
  assert.equal(r2.body.duplicates, 2);

  // 同一批次内部也含重复
  const r3 = await postBatch([
    rec('T-003', '2026-09-10T10:00:00Z', 5.0),
    rec('T-003', '2026-09-10T10:00:00Z', 5.0),
  ]);
  assert.equal(r3.body.inserted, 1);
  assert.equal(r3.body.duplicates, 1);

  // 数据库里确实只有 3 条
  const list = await (await fetch(`${base}/api/readings?sample_id=SAMP-T1`)).json();
  assert.equal(list.readings.length, 3);
});

test('不同设备可以使用相同的记录编号，互不去重', async () => {
  const r = await postBatch([
    rec('SHARED-1', '2026-09-10T08:00:00Z', 3.0, { device_id: 'DEV-X' }),
    rec('SHARED-1', '2026-09-10T08:00:00Z', 3.1, { device_id: 'DEV-Y' }),
  ]);
  assert.equal(r.body.inserted, 2);
});

test('非法记录被拒绝且不影响同批合法记录', async () => {
  const r = await postBatch([
    rec('T-010', '2026-09-10T11:00:00Z', 4.2),
    { sample_id: 'SAMP-T1', device_id: 'DEV-T', record_id: 'T-011', collected_at: 'not-a-time', temperature: 4 },
    { sample_id: 'SAMP-T1', device_id: 'DEV-T', record_id: 'T-012', collected_at: '2026-09-10T12:00:00Z', temperature: 'hot' },
  ]);
  assert.equal(r.body.inserted, 1);
  assert.equal(r.body.rejected, 2);
  assert.equal(r.body.errors.length, 2);
});

/* ---------- 第二块：乱序到达 → 按采集时间还原轨迹并标超温 ---------- */

test('乱序补传的数据按采集时间排序还原，超温点正确标注', async () => {
  // 故意乱序上报：晚的采集时间先到
  const shuffled = [
    rec('T-104', '2026-09-11T12:00:00Z', 9.5),   // 超温
    rec('T-101', '2026-09-11T09:00:00Z', 3.0),
    rec('T-103', '2026-09-11T11:00:00Z', 8.1),   // 超温（刚好越过阈值）
    rec('T-100', '2026-09-11T08:00:00Z', 2.5),
    rec('T-102', '2026-09-11T10:00:00Z', 4.0),
    rec('T-105', '2026-09-11T13:00:00Z', 8.0),   // 等于阈值，不算超温
  ];
  const up = await postBatch(shuffled.map(r => ({ ...r, sample_id: 'SAMP-T2' })));
  assert.equal(up.body.inserted, 6);

  const res = await fetch(`${base}/api/samples/SAMP-T2/trajectory`);
  const traj = await res.json();
  assert.equal(res.status, 200);
  assert.equal(traj.threshold, OVERTEMP_THRESHOLD);

  // 轨迹必须按采集时间升序，与到达顺序无关
  const times = traj.points.map(p => p.collected_at);
  assert.deepEqual(times, [...times].sort());
  assert.deepEqual(times, [
    '2026-09-11T08:00:00.000Z', '2026-09-11T09:00:00.000Z', '2026-09-11T10:00:00.000Z',
    '2026-09-11T11:00:00.000Z', '2026-09-11T12:00:00.000Z', '2026-09-11T13:00:00.000Z',
  ]);

  // 超温标注：> 阈值才算
  assert.deepEqual(traj.points.map(p => p.is_overtemp), [0, 0, 0, 1, 1, 0]);
  assert.equal(traj.stats.count, 6);
  assert.equal(traj.stats.overtemp_count, 2);
  assert.equal(traj.stats.max, 9.5);
  assert.equal(traj.stats.min, 2.5);
});

test('补传一条更早的历史记录后，轨迹插入到正确位置', async () => {
  // 先传 10:00 和 12:00
  await postBatch([
    rec('T-202', '2026-09-12T10:00:00Z', 4.0, { sample_id: 'SAMP-T3' }),
    rec('T-204', '2026-09-12T12:00:00Z', 9.0, { sample_id: 'SAMP-T3' }),
  ]);
  // 离线恢复后补传中间的 11:00
  await postBatch([rec('T-203', '2026-09-12T11:00:00Z', 5.0, { sample_id: 'SAMP-T3' })]);

  const traj = await (await fetch(`${base}/api/samples/SAMP-T3/trajectory`)).json();
  assert.deepEqual(
    traj.points.map(p => [p.record_id, p.temperature]),
    [['T-202', 4.0], ['T-203', 5.0], ['T-204', 9.0]],
  );
  assert.deepEqual(traj.points.map(p => p.is_overtemp), [0, 0, 1]);
});

/* ---------- 筛选查询 ---------- */

test('按样本和时间范围筛选', async () => {
  const all = await (await fetch(`${base}/api/readings?sample_id=SAMP-T2`)).json();
  assert.equal(all.readings.length, 6);

  const ranged = await (await fetch(
    `${base}/api/readings?sample_id=SAMP-T2&from=2026-09-11T10:00:00Z&to=2026-09-11T12:00:00Z`,
  )).json();
  assert.equal(ranged.readings.length, 3);
  assert.deepEqual(ranged.readings.map(r => r.record_id), ['T-102', 'T-103', 'T-104']);

  const none = await (await fetch(`${base}/api/readings?sample_id=NOPE`)).json();
  assert.equal(none.readings.length, 0);

  const bad = await fetch(`${base}/api/readings?from=not-a-time`);
  assert.equal(bad.status, 400);
});
