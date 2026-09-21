/* ============================================================
   服装予報 — app.js
   データ元: Open-Meteo Forecast API（APIキー不要・CORS開放）
   確定仕様書.md の決定36項目に従う。
   ============================================================ */
'use strict';

/* ── 地点 ───────────────────────────────── */
const CITIES = {
  toyohashi: { name: '豊橋', lat: 34.7692, lon: 137.3915 },
  tokyo:     { name: '東京', lat: 35.691667, lon: 139.75 }  // 気象庁 東京観測点（北の丸公園）
};

/* ── WMO 天気コード → アイコンと呼び名（API精査レポート §7）── */
const WX = [
  [[0, 1],                         'wx_clear',      '晴れ'],
  [[2],                            'wx_partly',     '晴れ時々曇り'],
  [[3],                            'wx_cloudy',     '曇り'],
  [[45, 48],                       'wx_fog',        '霧'],
  [[51, 53, 55],                   'wx_drizzle',    '小雨'],
  [[61, 63],                       'wx_rain',       '雨'],
  [[65],                           'wx_heavy_rain', '強い雨'],
  [[56, 57, 66, 67],               'wx_sleet',      'みぞれ'],
  [[71, 73, 75, 77, 85, 86],       'wx_snow',       '雪'],
  [[80, 81, 82],                   'wx_shower',     'にわか雨'],
  [[95, 96, 99],                   'wx_thunder',    '雷']
];
function wx(code) {
  for (const [codes, file, label] of WX) if (codes.includes(code)) return { file, label };
  return { file: 'wx_cloudy', label: '—' };
}

/* ── 服装6段階（暑い→寒い）。判定は体感温度の最高値 ── */
const WEAR = [
  { file: 'wear_1_tee_shorts', name: '半袖・半ズボン',   v: '--lv1' },
  { file: 'wear_2_tee_pants',  name: '半袖・長ズボン',   v: '--lv2' },
  { file: 'wear_3_shirt',      name: 'シャツ姿くらい',   v: '--lv3' },
  { file: 'wear_4_longsleeve', name: '長袖・長ズボン',   v: '--lv4' },
  { file: 'wear_5_jacket',     name: 'ジャケットが必要', v: '--lv5' },
  { file: 'wear_6_coat',       name: 'コートが必要',     v: '--lv6' }
];
/* しきい値＝各段階の下限（℃）。最後の段階に下限はない。 */
const DEF_TH = [28, 24, 20, 16, 11];

const POP_UMBRELLA = 50;   // 傘
const POP_BOOTS    = 70;   // 長靴は傘より強い雨のときだけ

/* 快適度。＋が「暑かった」側。 */
const COMFORT = [
  { v:  2, label: '暑すぎた' },
  { v:  1, label: '少し暑かった' },
  { v:  0, label: 'ちょうどよかった' },
  { v: -1, label: '少し寒かった' },
  { v: -2, label: '寒すぎた' }
];

/* ── 状態 ───────────────────────────────── */
const CACHE_MS = 60 * 60 * 1000;               // 1時間キャッシュ
const LS = { city: 'fy.city', th: 'fy.th', log: 'fy.log', data: c => 'fy.d.' + c };
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let city = load(LS.city, 'toyohashi');
let th = loadTh();
let log = loadLog();
let current = null;

function load(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch { /* 容量超過などは無視 */ } }

function loadTh() {
  try {
    const a = JSON.parse(localStorage.getItem(LS.th));
    if (Array.isArray(a) && a.length === 5 && a.every(n => typeof n === 'number' && isFinite(n))) return a;
  } catch { /* 壊れていたら既定へ */ }
  return DEF_TH.slice();
}
function saveTh() { save(LS.th, JSON.stringify(th)); }

function loadLog() {
  try {
    const a = JSON.parse(localStorage.getItem(LS.log));
    if (Array.isArray(a)) return a.filter(r => r && r.d && typeof r.t === 'number');
  } catch { /* 同上 */ }
  return [];
}
function saveLog() { save(LS.log, JSON.stringify(log)); }

/* しきい値から段階を引く。th は降順である前提。 */
function wearIdx(appMax) {
  for (let i = 0; i < th.length; i++) if (appMax >= th[i]) return i;
  return WEAR.length - 1;
}
function rangeText(i) {
  if (i === 0) return `${fmt(th[0])}℃ 以上`;
  if (i === WEAR.length - 1) return `${fmt(th[4])}℃ 未満`;
  return `${fmt(th[i])} 〜 ${fmt(th[i - 1])}℃`;
}
const fmt = n => (Math.round(n * 10) / 10).toString();

/* ── 取得 ───────────────────────────────── */
function url(c) {
  const p = new URLSearchParams({
    latitude: c.lat, longitude: c.lon,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,' +
           'precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    hourly: 'relative_humidity_2m,temperature_2m,precipitation_probability',
    timezone: 'Asia/Tokyo', forecast_days: '16', past_days: '1'
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p;
}

async function getData(key) {
  let cached = null;
  try {
    const raw = localStorage.getItem(LS.data(key));
    if (raw) cached = JSON.parse(raw);
  } catch { /* 壊れていたら取り直す */ }

  if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached, stale: false };

  try {
    const res = await fetch(url(CITIES[key]), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const rec = { at: Date.now(), json };
    save(LS.data(key), JSON.stringify(rec));
    return { ...rec, stale: false };
  } catch (e) {
    if (cached) return { ...cached, stale: true };   // 電波がなければ前回分を出す
    throw e;
  }
}

/* ── 小道具 ─────────────────────────────── */
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
const r0 = n => Math.round(n);
const clock = iso => iso ? iso.slice(11, 16) : '—';

function dayAvg(arr, dayIdx, from = 9, to = 18) {
  const v = [];
  for (let h = from; h <= to; h++) {
    const x = arr[dayIdx * 24 + h];
    if (x != null) v.push(x);
  }
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function isoToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** その日付の体感温度（最高）を、いま読み込んでいるデータから探す。なければ null。 */
function appTempOn(date) {
  if (!current) return null;
  const i = current.json.daily.time.indexOf(date);
  return i < 0 ? null : current.json.daily.apparent_temperature_max[i];
}

/* ── 描画：今日 ─────────────────────────── */
function renderToday(d) {
  const D = d.daily, H = d.hourly, i = 1;             // 0=昨日, 1=今日
  const date = new Date(D.time[i] + 'T00:00:00+09:00');
  const wi = wearIdx(D.apparent_temperature_max[i]);
  const w = WEAR[wi];
  const hum = dayAvg(H.relative_humidity_2m, i);
  const diff = D.temperature_2m_max[i] - D.temperature_2m_max[0];
  const info = wx(D.weather_code[i]);

  $('#today-h').textContent =
    `${date.getMonth() + 1}月${date.getDate()}日（${WD[date.getDay()]}）${info.label}`;

  const img = $('#today-wx');
  img.src = `img/${info.file}.png`;
  img.alt = info.label;

  $('#t-max').textContent = r0(D.temperature_2m_max[i]) + '℃';
  $('#t-min').textContent = r0(D.temperature_2m_min[i]) + '℃';
  $('#t-app').textContent = `体感 ${r0(D.apparent_temperature_max[i])}℃（湿度と風を織り込んだ値）`;

  const sign = diff > 0 ? '高い' : '低い';
  $('#t-diff').textContent = Math.abs(diff) < 0.5
    ? '昨日とほぼ同じ'
    : `昨日より ${r1(Math.abs(diff))}℃ ${sign}`;

  $('#t-hum').textContent = hum == null ? '' : `湿度 ${r0(hum)}%（9〜18時の平均）`;

  const wimg = $('#wear-img');
  wimg.src = `img/${w.file}.png`;
  wimg.alt = w.name;
  wimg.closest('.wear-art').style.background = `var(${w.v})`;
  $('#wear-name').textContent = w.name;
  $('#wear-why').textContent = `体感の最高 ${r0(D.apparent_temperature_max[i])}℃ から判定（${rangeText(wi)}）`;

  const pop = D.precipitation_probability_max[i];
  const gear = $('#wear-gear');
  if (pop >= POP_BOOTS) { gear.textContent = `☔ 降水確率 ${pop}%　傘と長靴を`; gear.hidden = false; }
  else if (pop >= POP_UMBRELLA) { gear.textContent = `☔ 降水確率 ${pop}%　傘を持って`; gear.hidden = false; }
  else { gear.hidden = true; }

  $('#today').hidden = false;
}

/* ── 描画：時間別グラフ ──────────────────
   気温（℃）と降水確率（%）はスケールが違うので、
   二軸で重ねず、x軸を共有した2つのグラフに分ける。   */
const VB = { w: 340, h: 118, l: 30, r: 8, t: 12, b: 20 };
const px = i => VB.l + (VB.w - VB.l - VB.r) * (i / 23);

function renderTempChart(temps) {
  const lo = Math.floor(Math.min(...temps) / 2) * 2 - 1;
  const hi = Math.ceil(Math.max(...temps) / 2) * 2 + 1;
  const py = v => VB.t + (VB.h - VB.t - VB.b) * (1 - (v - lo) / (hi - lo));

  let g = '';
  const step = (hi - lo) <= 10 ? 2 : 5;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    g += `<line x1="${VB.l}" y1="${py(v)}" x2="${VB.w - VB.r}" y2="${py(v)}" stroke="var(--viz-grid)" stroke-width="1"/>` +
         `<text x="${VB.l - 4}" y="${py(v) + 3.5}" text-anchor="end" font-size="8" fill="var(--viz-ink-2)">${v}</text>`;
  }
  const dAttr = temps.map((t, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(t).toFixed(1)}`).join(' ');

  // 選択的な直接ラベル（最高と最低のみ。全点に数字は置かない）
  const iMax = temps.indexOf(Math.max(...temps));
  const iMin = temps.indexOf(Math.min(...temps));
  let lab = '';
  for (const [idx, dy] of [[iMax, -6], [iMin, 12]]) {
    const x = px(idx), y = py(temps[idx]);
    lab += `<circle cx="${x}" cy="${y}" r="3" fill="var(--viz-temp)" stroke="var(--viz-surface)" stroke-width="2"/>` +
           `<text x="${Math.min(Math.max(x, VB.l + 12), VB.w - VB.r - 12)}" y="${y + dy}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--viz-ink)">${r0(temps[idx])}℃</text>`;
  }
  return `<svg viewBox="0 0 ${VB.w} ${VB.h}" role="img" aria-label="今日の気温の推移">` + g +
    `<path d="${dAttr}" fill="none" stroke="var(--viz-temp)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    lab + `<line class="cross" x1="0" y1="${VB.t}" x2="0" y2="${VB.h - VB.b}" stroke="var(--viz-ink-2)" stroke-width="1" opacity="0"/></svg>`;
}

function renderPopChart(pops) {
  const py = v => VB.t + (VB.h - VB.t - VB.b) * (1 - v / 100);
  let g = '';
  for (const v of [0, 50, 100]) {
    g += `<line x1="${VB.l}" y1="${py(v)}" x2="${VB.w - VB.r}" y2="${py(v)}" stroke="var(--viz-grid)" stroke-width="1"/>` +
         `<text x="${VB.l - 4}" y="${py(v) + 3.5}" text-anchor="end" font-size="8" fill="var(--viz-ink-2)">${v}</text>`;
  }
  const slot = (VB.w - VB.l - VB.r) / 24;
  const bw = Math.max(2, slot - 2);                     // 2px の間隔をあける
  let bars = '';
  pops.forEach((p, i) => {
    const v = p ?? 0;
    const y = py(v), h = (VB.h - VB.b) - y;
    if (h <= 0.4) return;
    bars += `<rect x="${(VB.l + slot * i + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 2)}" fill="var(--viz-pop)"/>`;
  });
  let xl = '';
  for (const h of [0, 6, 12, 18, 23]) {
    xl += `<text x="${px(h)}" y="${VB.h - 6}" text-anchor="middle" font-size="8" fill="var(--viz-ink-2)">${h}時</text>`;
  }
  return `<svg viewBox="0 0 ${VB.w} ${VB.h}" role="img" aria-label="今日の降水確率">` + g + bars + xl +
    `<line class="cross" x1="0" y1="${VB.t}" x2="0" y2="${VB.h - VB.b}" stroke="var(--viz-ink-2)" stroke-width="1" opacity="0"/></svg>`;
}

function renderCharts(d) {
  const H = d.hourly, s = 24;                            // 今日の0時
  const temps = H.temperature_2m.slice(s, s + 24);
  const pops = H.precipitation_probability.slice(s, s + 24);
  if (temps.length < 24 || temps.some(v => v == null)) { $('#charts').hidden = true; return; }

  $('#chart-temp').innerHTML = renderTempChart(temps);
  $('#chart-pop').innerHTML = renderPopChart(pops);
  $('#charts').hidden = false;

  let rows = '';
  for (let h = 0; h < 24; h += 3) {
    rows += `<tr><th scope="row">${h}時</th><td>${r1(temps[h])}℃</td><td>${pops[h] ?? 0}%</td></tr>`;
  }
  $('#chart-table').innerHTML =
    `<table><thead><tr><th scope="col">時刻</th><th scope="col">気温</th><th scope="col">降水確率</th></tr></thead><tbody>${rows}</tbody></table>`;

  const boxes = [$('#chart-temp'), $('#chart-pop')];
  const lines = boxes.map(b => b.querySelector('.cross'));
  const readout = $('#chart-read');

  function at(ev, box) {
    const svg = box.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const rel = (ev.clientX - rect.left) / rect.width * VB.w;
    let i = Math.round((rel - VB.l) / (VB.w - VB.l - VB.r) * 23);
    i = Math.max(0, Math.min(23, i));
    lines.forEach(l => { l.setAttribute('x1', px(i)); l.setAttribute('x2', px(i)); l.setAttribute('opacity', '1'); });
    readout.textContent = `${i}時　気温 ${r1(temps[i])}℃　降水確率 ${pops[i] ?? 0}%`;
  }
  function off() { lines.forEach(l => l.setAttribute('opacity', '0')); readout.textContent = ''; }

  boxes.forEach(box => {
    box.addEventListener('pointermove', e => at(e, box));
    box.addEventListener('pointerdown', e => at(e, box));
    box.addEventListener('pointerleave', off);
  });
}

/* ── 描画：2週間リスト ──────────────────── */
function renderDays(d) {
  const D = d.daily, H = d.hourly;
  const ol = $('#days');
  ol.innerHTML = '';

  for (let i = 2; i <= 15; i++) {                       // あした〜14日先
    const dayNo = i - 1;                                // 今日を1日目とする
    const far = dayNo >= 8;                             // 8日目以降は精度が落ちる
    if (dayNo === 8) {
      const note = document.createElement('li');
      note.className = 'far-note';
      note.textContent = 'ここから先は参考値です（予報の精度が落ちます）';
      ol.appendChild(note);
    }

    const date = new Date(D.time[i] + 'T00:00:00+09:00');
    const wd = date.getDay();
    const info = wx(D.weather_code[i]);
    const wi = wearIdx(D.apparent_temperature_max[i]);
    const w = WEAR[wi];
    const pop = D.precipitation_probability_max[i];

    let gear = '';
    if (pop >= POP_UMBRELLA) gear += `<img src="img/gear_umbrella.png" alt="傘">`;
    if (pop >= POP_BOOTS) gear += `<img src="img/gear_boots.png" alt="長靴">`;

    const li = document.createElement('li');
    li.className = 'day' + (far ? ' far' : '');
    li.innerHTML =
      `<button class="day-btn" type="button" aria-expanded="false">
         <span class="d-date ${wd === 0 ? 'd-sun' : wd === 6 ? 'd-sat' : ''}">
           <b class="d-md">${date.getMonth() + 1}/${date.getDate()}</b>
           <span class="d-wd">${WD[wd]}曜</span>
         </span>
         <img class="d-wx" src="img/${info.file}.png" alt="${info.label}">
         <p class="d-t"><b>${r0(D.temperature_2m_max[i])}℃</b> <i>/ ${r0(D.temperature_2m_min[i])}℃</i></p>
         <p class="d-sub">
           <span>体感 ${r0(D.apparent_temperature_max[i])}℃</span>
           <span>降水 ${pop}%</span>
           ${gear ? `<span class="d-gear">${gear}</span>` : ''}
         </p>
         <span class="d-wear" style="background:var(${w.v})">
           <img src="img/${w.file}.png" alt="${w.name}">
         </span>
       </button>`;

    const btn = li.querySelector('.day-btn');
    btn.addEventListener('click', () => {
      const open = li.querySelector('.d-detail');
      if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const hum = dayAvg(H.relative_humidity_2m, i);
      const div = document.createElement('div');
      div.className = 'd-detail';
      div.innerHTML =
        `<dl>
           <dt>服装</dt><dd>${w.name}（${rangeText(wi)}）</dd>
           <dt>湿度</dt><dd>${hum == null ? '—' : r0(hum) + '%（9〜18時の平均）'}</dd>
           <dt>最大風速</dt><dd>${r1(D.wind_speed_10m_max[i])} km/h</dd>
           <dt>日の出</dt><dd>${clock(D.sunrise[i])}</dd>
           <dt>日の入り</dt><dd>${clock(D.sunset[i])}</dd>
         </dl>
         <button class="link-btn" type="button" data-log="${D.time[i]}">この日の記録をつける</button>`;
      div.querySelector('[data-log]').addEventListener('click', e => {
        e.stopPropagation();
        openLog('add', D.time[i]);
      });
      li.appendChild(div);
      btn.setAttribute('aria-expanded', 'true');
    });

    ol.appendChild(li);
  }
  $('#forecast').hidden = false;
}

/* ── 全体 ───────────────────────────────── */
function renderAll() {
  if (!current) return;
  renderToday(current.json);
  renderCharts(current.json);
  renderDays(current.json);

  const t = new Date(current.at);
  const hhmm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  $('#fetched').textContent = current.stale
    ? `オフラインのため ${hhmm} 時点の情報を表示しています`
    : `${hhmm} 時点の情報`;
  $('#status').hidden = true;
}

async function show(key) {
  city = key;
  save(LS.city, key);
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.city === key)));

  const st = $('#status');
  if (!current) { st.hidden = false; st.className = 'status'; st.textContent = '読み込み中…'; }

  try {
    current = await getData(key);
    renderAll();
  } catch {
    current = null;
    ['#today', '#charts', '#forecast'].forEach(s => { $(s).hidden = true; });
    st.hidden = false;
    st.className = 'status err';
    st.textContent = '天気を取得できませんでした。通信状況を確かめて、もう一度お試しください。';
  }
}

/* ============================================================
   設定：しきい値の手動編集
   ============================================================ */
function paintThresholds() {
  $('#th-list').innerHTML = WEAR.map((w, i) => `
    <li class="th-row">
      <span class="sw" style="background:var(${w.v})"></span>
      <span class="th-name">${w.name}</span>
      ${i < th.length
        ? `<span class="th-in"><input type="number" step="0.5" inputmode="decimal" data-th="${i}" value="${fmt(th[i])}">℃以上</span>`
        : `<span class="th-in last">これ未満</span>`}
    </li>`).join('');

  $$('#th-list input[data-th]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.th);
      const v = Number(inp.value);
      if (!isFinite(v)) { inp.value = fmt(th[i]); return; }
      th[i] = v;
      if (!checkTh()) return;
      saveTh(); renderAll(); paintTune();
    });
  });
  checkTh();
}

/** 上から順に小さくなっているか。崩れていたら警告を出す。 */
function checkTh() {
  const bad = th.some((v, i) => i > 0 && v >= th[i - 1]);
  const warn = $('#th-warn');
  warn.hidden = !bad;
  if (bad) warn.textContent = '数字が上から順に小さくなっていません。この状態では正しく判定できません。';
  return !bad;
}

function applyPreset(off) {
  th = DEF_TH.map(v => v + off);
  saveTh(); paintThresholds(); renderAll(); paintTune();
}

/* ============================================================
   記録（フィードバック）
   ============================================================ */
function openLog(pane, date) {
  paintAddForm(date || isoToday());
  paintLogList();
  paintTune();
  switchPane(pane || 'add');
  $('#dlg-log').showModal();
}

function switchPane(name) {
  $$('.seg-b').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === name)));
  ['add', 'list', 'tune'].forEach(p => { $('#pane-' + p).hidden = p !== name; });
}

function paintAddForm(date) {
  $('#f-date').value = date;
  $('#f-wear').innerHTML = WEAR.map((w, i) => `<option value="${i}">${w.name}</option>`).join('');
  $('#f-comfort').innerHTML = COMFORT.map(c => `
    <label class="cf">
      <input type="radio" name="comfort" value="${c.v}"${c.v === 0 ? ' checked' : ''}>
      <span>${c.label}</span>
    </label>`).join('');
  $('#f-memo').value = '';
  $('#f-msg').textContent = '';
  syncTempForDate();
  $('#f-date').onchange = syncTempForDate;
  $('#f-temp').oninput = syncWearHint;
}

function syncTempForDate() {
  const t = appTempOn($('#f-date').value);
  const hint = $('#f-temp-hint');
  if (t != null) {
    $('#f-temp').value = r1(t);
    hint.textContent = 'その日の予報値を入れました。実感と違えば書き換えてください。';
  } else {
    hint.textContent = 'この日付のデータが手元にないので、体感温度を手で入れてください。';
  }
  syncWearHint();
}

function syncWearHint() {
  const t = Number($('#f-temp').value);
  const hint = $('#f-wear-hint');
  if (!isFinite(t)) { hint.textContent = ''; return; }
  const i = wearIdx(t);
  $('#f-wear').value = String(i);
  hint.textContent = `いまの目安では「${WEAR[i].name}」です。違うものを着たならそれを選んでください。`;
}

function saveEntry() {
  const d = $('#f-date').value;
  const t = Number($('#f-temp').value);
  const w = Number($('#f-wear').value);
  const c = Number(($$('input[name="comfort"]').find(r => r.checked) || {}).value);
  const msg = $('#f-msg');

  if (!d) { msg.textContent = '日付を入れてください。'; msg.className = 'msg err'; return; }
  if (!isFinite(t)) { msg.textContent = '体感温度を入れてください。'; msg.className = 'msg err'; return; }

  log = log.filter(r => r.d !== d);                 // 同じ日は上書き
  log.push({ d, t, w, c: isFinite(c) ? c : 0, m: $('#f-memo').value.trim() });
  log.sort((a, b) => b.d.localeCompare(a.d));
  saveLog();

  msg.textContent = `${d} の記録を保存しました（全 ${log.length} 件）`;
  msg.className = 'msg ok';
  paintLogList();
  paintTune();
}

function paintLogList() {
  const box = $('#log-list');
  if (!log.length) {
    box.innerHTML = '<p class="note">まだ記録がありません。「つける」から1件目を入れてください。</p>';
    return;
  }
  box.innerHTML = '<ul class="lg">' + log.map(r => {
    const c = COMFORT.find(x => x.v === r.c) || COMFORT[2];
    const cls = r.c > 0 ? 'hot' : r.c < 0 ? 'cold' : 'ok';
    return `<li class="lg-i">
      <div class="lg-main">
        <b>${r.d}</b>
        <span class="lg-t">体感 ${fmt(r.t)}℃</span>
        <span class="lg-w"><span class="sw" style="background:var(${WEAR[r.w].v})"></span>${WEAR[r.w].name}</span>
        <span class="lg-c ${cls}">${c.label}</span>
        ${r.m ? `<span class="lg-m">${escapeHtml(r.m)}</span>` : ''}
      </div>
      <button class="x sm" type="button" data-del="${r.d}">✕<span class="sr-only">${r.d} を削除</span></button>
    </li>`;
  }).join('') + '</ul>';

  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    log = log.filter(r => r.d !== b.dataset.del);
    saveLog(); paintLogList(); paintTune();
  }));
}

const escapeHtml = s => s.replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ── 記録から目安のずらし方を出す ──────────
   快適度を数値にして平均する。＋なら暑すぎた側なので、
   しきい値を下げて薄着寄りにする。1段階が約4℃幅なので、
   快適度1目盛りを約2℃とみなす。                        */
function suggest() {
  if (log.length < 3) return null;
  const avg = log.reduce((s, r) => s + r.c, 0) / log.length;
  const shift = Math.round(-avg * 2 * 2) / 2;      // 0.5℃ 刻み
  return { n: log.length, avg, shift };
}

function paintTune() {
  const box = $('#tune-body');
  const s = suggest();

  if (!s) {
    box.innerHTML = `<p class="note">
      記録が <b>${log.length} 件</b>です。<b>3件</b>たまると、
      目安をどれだけずらすとよさそうかを出します。</p>`;
    return;
  }

  const dir = s.shift < 0 ? '薄着寄り' : s.shift > 0 ? '厚着寄り' : '';
  const head = Math.abs(s.shift) < 0.5
    ? `<p class="tune-lead">いまの目安で <b>ちょうど良さそう</b>です。ずらす必要はありません。</p>`
    : `<p class="tune-lead">目安を <b class="big">${s.shift > 0 ? '＋' : '−'}${Math.abs(s.shift)}℃</b>
       ずらすと（${dir}）、記録に近づきます。</p>`;

  // 段階ごとの内訳
  const by = WEAR.map((w, i) => {
    const rs = log.filter(r => r.w === i);
    if (!rs.length) return null;
    const a = rs.reduce((x, r) => x + r.c, 0) / rs.length;
    return { i, w, n: rs.length, a };
  }).filter(Boolean);

  const rows = by.map(b => {
    const tone = b.a > 0.4 ? 'hot' : b.a < -0.4 ? 'cold' : 'ok';
    const say = b.a > 0.4 ? '暑かった' : b.a < -0.4 ? '寒かった' : 'ちょうど';
    return `<tr>
      <td><span class="sw" style="background:var(${b.w.v})"></span>${b.w.name}</td>
      <td>${b.n}件</td>
      <td class="${tone}">${say}</td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    ${head}
    <p class="note sm">${s.n}件の記録から。「ちょうどよかった」を0として平均 ${(Math.round(s.avg * 100) / 100)}。</p>
    ${Math.abs(s.shift) >= 0.5
      ? `<div class="row-end"><button id="tune-apply" class="btn primary" type="button">この分ずらす</button></div>`
      : ''}
    <h3 class="sub-h">着たものごとの感じ方</h3>
    <table class="tune-tbl"><tbody>${rows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>
    <p class="note sm">
      ここが偏っている段階だけを直したいときは、⚙の画面でその段階の数字を手で書き換えてください。
    </p>`;

  const ap = $('#tune-apply');
  if (ap) ap.addEventListener('click', () => {
    th = th.map(v => v + s.shift);
    saveTh(); renderAll(); paintThresholds(); paintTune();
    const lead = box.querySelector('.tune-lead');
    if (lead) lead.innerHTML = `<b class="ok">ずらしました。</b>⚙の画面で結果を確認できます。`;
  });
}

/* ── 書き出し・読み込み ─────────────────── */
function exportLog() {
  const blob = new Blob([JSON.stringify({ v: 1, th, log }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `服装予報_記録_${isoToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importLog(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const o = JSON.parse(fr.result);
      if (Array.isArray(o.log)) {
        const seen = new Set();
        log = [...o.log, ...log].filter(r => r && r.d && !seen.has(r.d) && seen.add(r.d))
          .sort((a, b) => b.d.localeCompare(a.d));
        saveLog();
      }
      if (Array.isArray(o.th) && o.th.length === 5) { th = o.th; saveTh(); }
      paintLogList(); paintTune(); paintThresholds(); renderAll();
      alert(`読み込みました（全 ${log.length} 件）`);
    } catch {
      alert('このファイルは読み込めませんでした。');
    }
  };
  fr.readAsText(file);
}

/* ── 起動 ───────────────────────────────── */
$$('.tab').forEach(b =>
  b.addEventListener('click', () => { if (b.dataset.city !== city) show(b.dataset.city); }));

$('#btn-settings').addEventListener('click', () => { paintThresholds(); $('#dlg-set').showModal(); });
$('#btn-log').addEventListener('click', () => openLog('add'));
$('#btn-quicklog').addEventListener('click', () => openLog('add', current?.json.daily.time[1]));

$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('[data-preset]').forEach(b => b.addEventListener('click', () => applyPreset(Number(b.dataset.preset))));
$$('.seg-b').forEach(b => b.addEventListener('click', () => switchPane(b.dataset.pane)));

$('#f-save').addEventListener('click', saveEntry);
$('#log-export').addEventListener('click', exportLog);
$('#log-import').addEventListener('change', e => { if (e.target.files[0]) importLog(e.target.files[0]); e.target.value = ''; });

show(city);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
