'use strict';

/* 实验室样本冷链记录系统前端逻辑：筛选查询 + 温度轨迹 SVG 绘制 */

const $ = (id) => document.getElementById(id);

let threshold = 8;

async function fetchJSON(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `请求失败 (${res.status})`);
  return body;
}

/** 加载样本下拉框 */
async function loadSamples() {
  const { samples } = await fetchJSON('/api/samples');
  const select = $('filter-sample');
  select.innerHTML = '<option value="">全部样本</option>';
  for (const s of samples) {
    const opt = document.createElement('option');
    opt.value = s.sample_id;
    opt.textContent = `${s.sample_id}（${s.count} 条，超温 ${s.overtemp_count}）`;
    select.appendChild(opt);
  }
}

function buildQuery() {
  const params = new URLSearchParams();
  const sample = $('filter-sample').value;
  const from = $('filter-from').value;
  const to = $('filter-to').value;
  if (sample) params.set('sample_id', sample);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());
  return params;
}

/** 查询并渲染明细表 + 统计 + 轨迹 */
async function refresh() {
  const params = buildQuery();
  const data = await fetchJSON('/api/readings?' + params);
  threshold = data.threshold;
  $('threshold-label').textContent = threshold;
  renderTable(data.readings);
  renderStats(data.readings);

  // 轨迹图只在选定单个样本时绘制（多个样本的时间轴混在一起没有意义）
  const sample = $('filter-sample').value;
  if (sample) {
    const traj = await fetchJSON(`/api/samples/${encodeURIComponent(sample)}/trajectory?` + params);
    renderChart(traj.points, traj.threshold);
    $('trajectory-card').hidden = traj.points.length === 0;
  } else {
    $('trajectory-card').hidden = true;
  }
}

function renderTable(readings) {
  const tbody = $('readings-body');
  if (readings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const r of readings) {
    const tr = document.createElement('tr');
    if (r.is_overtemp) tr.className = 'overtemp-row';
    const badge = r.is_overtemp
      ? '<span class="badge overtemp">超温</span>'
      : '<span class="badge normal">正常</span>';
    tr.innerHTML = `
      <td>${esc(r.sample_id)}</td>
      <td>${esc(r.device_id)}</td>
      <td>${esc(r.record_id)}</td>
      <td>${esc(r.collected_at)}</td>
      <td>${r.temperature.toFixed(1)}</td>
      <td>${badge}</td>`;
    tbody.appendChild(tr);
  }
}

function renderStats(readings) {
  $('stats').hidden = readings.length === 0;
  if (readings.length === 0) return;
  const temps = readings.map(r => r.temperature);
  $('stat-count').textContent = readings.length;
  $('stat-overtemp').textContent = readings.filter(r => r.is_overtemp).length;
  $('stat-min').textContent = Math.min(...temps).toFixed(1);
  $('stat-max').textContent = Math.max(...temps).toFixed(1);
  $('stat-avg').textContent = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2);
}

/** 用原生 SVG 画温度轨迹：x 轴采集时间，y 轴温度，红色点为超温 */
function renderChart(points, thr) {
  const W = 960, H = 280, PAD = { l: 48, r: 16, t: 16, b: 44 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const times = points.map(p => new Date(p.collected_at).getTime());
  const temps = points.map(p => p.temperature);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const yMin = Math.floor(Math.min(...temps, thr) - 1);
  const yMax = Math.ceil(Math.max(...temps, thr) + 1);

  const x = (t) => PAD.l + (tMax === tMin ? iw / 2 : ((t - tMin) / (tMax - tMin)) * iw);
  const y = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const path = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${x(times[i]).toFixed(1)},${y(p.temperature).toFixed(1)}`).join(' ');

  const yTicks = [];
  for (let v = yMin; v <= yMax; v += Math.max(1, Math.round((yMax - yMin) / 6))) yTicks.push(v);

  const fmtTime = (t) => {
    const d = new Date(t);
    return `${String(d.getUTCMonth() + 1)}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };

  $('chart-container').innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="温度轨迹图">
    ${yTicks.map(v => `
      <line x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" stroke="#e4e9ee" />
      <text x="${PAD.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#7a8590">${v}℃</text>`).join('')}
    <line x1="${PAD.l}" y1="${y(thr)}" x2="${W - PAD.r}" y2="${y(thr)}"
          stroke="#d64545" stroke-width="1.5" stroke-dasharray="6 4" />
    <text x="${W - PAD.r}" y="${y(thr) - 5}" font-size="11" text-anchor="end" fill="#d64545">阈值 ${thr}℃</text>
    <path d="${path}" fill="none" stroke="#1a6fb5" stroke-width="2" />
    ${points.map((p, i) => `
      <circle cx="${x(times[i]).toFixed(1)}" cy="${y(p.temperature).toFixed(1)}" r="4.5"
              fill="${p.is_overtemp ? '#d64545' : '#2e9e5b'}" stroke="#fff" stroke-width="1.5">
        <title>${esc(p.collected_at)}  ${p.temperature.toFixed(1)}℃${p.is_overtemp ? '（超温）' : ''}</title>
      </circle>`).join('')}
    <text x="${x(tMin)}" y="${H - 14}" font-size="11" text-anchor="middle" fill="#7a8590">${fmtTime(tMin)}</text>
    <text x="${x(tMax)}" y="${H - 14}" font-size="11" text-anchor="middle" fill="#7a8590">${fmtTime(tMax)}</text>
    <text x="${(PAD.l + W - PAD.r) / 2}" y="${H - 14}" font-size="11" text-anchor="middle" fill="#7a8590">采集时间 (UTC)</text>
  </svg>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('filter-form').addEventListener('submit', (e) => { e.preventDefault(); refresh().catch(showError); });
$('reset-btn').addEventListener('click', () => {
  $('filter-sample').value = '';
  $('filter-from').value = '';
  $('filter-to').value = '';
  refresh().catch(showError);
});

function showError(e) { alert('查询失败：' + e.message); }

loadSamples().then(refresh).catch(showError);
