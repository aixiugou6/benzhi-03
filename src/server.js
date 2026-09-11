'use strict';

const path = require('node:path');
const express = require('express');
const { insertReadings, getTrajectory, queryReadings, listSamples, OVERTEMP_THRESHOLD } = require('./db');

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 批量补传（离线场景）：POST /api/readings/batch  { records: [...] }
  app.post('/api/readings/batch', (req, res) => {
    const records = req.body && req.body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: '请求体必须是 { records: [...] } 且 records 非空' });
    }
    if (records.length > 5000) {
      return res.status(413).json({ error: '单批次最多 5000 条' });
    }
    const result = insertReadings(db, records);
    // 全部非法 → 400；其余（含部分非法、全部重复）→ 200，由调用方按统计字段处理
    res.status(result.inserted === 0 && result.rejected > 0 ? 400 : 200).json(result);
  });

  // 单条上报：POST /api/readings  { sample_id, device_id, record_id, collected_at, temperature }
  app.post('/api/readings', (req, res) => {
    const result = insertReadings(db, [req.body]);
    if (result.rejected > 0) {
      return res.status(400).json({ error: result.errors[0].error });
    }
    res.status(result.inserted ? 201 : 200).json({ ...result, duplicate: result.duplicates > 0 });
  });

  // 列表查询：GET /api/readings?sample_id=&from=&to=
  app.get('/api/readings', (req, res) => {
    try {
      const { sample_id, from, to } = req.query;
      res.json({ threshold: OVERTEMP_THRESHOLD, readings: queryReadings(db, { sample_id, from, to }) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // 温度轨迹：GET /api/samples/:sampleId/trajectory?from=&to=
  app.get('/api/samples/:sampleId/trajectory', (req, res) => {
    try {
      const { from, to } = req.query;
      res.json(getTrajectory(db, req.params.sampleId, { from, to }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // 样本列表（筛选下拉框用）
  app.get('/api/samples', (req, res) => {
    res.json({ samples: listSamples(db) });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(400).json({ error: '请求格式错误：' + err.message });
  });

  return app;
}

module.exports = { createApp };
