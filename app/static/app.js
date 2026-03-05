// Batttracker frontend logic extracted from index.html

let lastBatteryStatus = null;

async function updateBatteryStatusBar() {
  try {
    const res = await fetch('/api/status');
    const json = await res.json();

    const status = json.status || 'Unknown';
    const cycles = json.cycles;
    const designCap = json.design_capacity;
    const health = json.health;
    const temp = json.temperature;
    const manuf = json.manufacturer;
    const model = json.model;

    const centerStatusEl = document.getElementById('battery-stat-status');
    const centerHealthEl = document.getElementById('battery-stat-health');
    const centerTempEl = document.getElementById('battery-stat-temp');
    const centerCyclesEl = document.getElementById('battery-stat-cycles');
    const centerDesignEl = document.getElementById('battery-stat-design');
    const centerManufEl = document.getElementById('battery-stat-manuf');

    if (centerStatusEl) centerStatusEl.textContent = status;

    if (cycles !== null && cycles !== undefined) {
      if (centerCyclesEl) centerCyclesEl.textContent = cycles;
    } else {
      if (centerCyclesEl) centerCyclesEl.textContent = '–';
    }

    if (designCap !== null && designCap !== undefined) {
      if (centerDesignEl) centerDesignEl.textContent = designCap.toFixed(2);
    } else {
      if (centerDesignEl) centerDesignEl.textContent = '–';
    }

    if (health !== null && health !== undefined) {
      if (centerHealthEl) centerHealthEl.textContent = `${health.toFixed(1)}%`;
    } else {
      if (centerHealthEl) centerHealthEl.textContent = '–';
    }

    if (temp !== null && temp !== undefined) {
      if (centerTempEl) centerTempEl.textContent = temp.toFixed(1);
    } else {
      if (centerTempEl) centerTempEl.textContent = '–';
    }

    if (manuf || model) {
      if (centerManufEl) centerManufEl.textContent = `${manuf || ''}${manuf && model ? ' ' : ''}${model || ''}`;
    } else {
      if (centerManufEl) centerManufEl.textContent = '–';
    }

    lastBatteryStatus = status;
  } catch (e) {
    const centerStatusEl = document.getElementById('battery-stat-status');
    if (centerStatusEl) centerStatusEl.textContent = 'Unknown';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateBatteryStatusBar();
  setInterval(updateBatteryStatusBar, 10000);

  // Downsample series to ~targetBuckets points by averaging contiguous buckets.
  function downsampleByMean(timestamps, valueArrays, targetBuckets = 100) {
    if (!timestamps || timestamps.length === 0) {
      return { timestamps, values: valueArrays };
    }
    const n = timestamps.length;
    if (n <= targetBuckets) {
      return { timestamps, values: valueArrays };
    }
    const bucketSize = Math.ceil(n / targetBuckets);
    const newT = [];
    const newVals = valueArrays.map(() => []);
    for (let i = 0; i < n; i += bucketSize) {
      const end = Math.min(i + bucketSize, n);
      const sliceT = timestamps.slice(i, end);
      const tAvg = sliceT.reduce((a, b) => a + b, 0) / sliceT.length;
      newT.push(tAvg);
      valueArrays.forEach((arr, idx) => {
        const sliceV = arr.slice(i, end);
        const m = sliceV.reduce((a, b) => a + b, 0) / sliceV.length;
        newVals[idx].push(m);
      });
    }
    return { timestamps: newT, values: newVals };
  }

  // --- Battery Charge Panel JS ---
  const chargeCanvasEl = document.getElementById('chargeChart');
  const chargeCtx = chargeCanvasEl.getContext('2d');
  let chargeTimestamps = [];
  let chargeWhs = [];
  let chargeFulls = [];
  let chargePercents = [];
  // selection for charge
  let chargeSelectedStartTs = null;
  let chargeSelectedEndTs = null;
  let chargeSelectedStartIdx = null;
  let chargeSelectedEndIdx = null;
  let chargeIsDragging = false;
  let chargeDragStartIdx = null;
  let chargeDragEndIdx = null;
  let chargeHasUserSelection = false;

  function formatPercent(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(1);
  }
  function formatWh(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(2);
  }
  function formatDurationHours(h) {
    if (!Number.isFinite(h) || h <= 0) return '–';
    const totalMinutes = Math.round(h * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 12) {
      return `${h.toFixed(1)} h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
  function updateChargeSelectionStats(startIdx, endIdx) {
    const slopeEl = document.getElementById('battery-stat-slope');
    if (!slopeEl) return;
    if (!chargePercents.length || startIdx == null || endIdx == null) {
      slopeEl.textContent = '–';
      return;
    }
    const s = Math.max(0, Math.min(startIdx, endIdx));
    const e = Math.min(chargePercents.length - 1, Math.max(startIdx, endIdx));
    if (e <= s) {
      slopeEl.textContent = '–';
      return;
    }
    const subPercents = chargePercents.slice(s, e + 1);
    const subWhs = chargeWhs.slice(s, e + 1);
    const tsStart = chargeTimestamps[s];
    const tsEnd = chargeTimestamps[e];
    const dt = (tsEnd - tsStart) / 3600; // hours
    let slopeStr = '–';
    if (dt > 0.01) {
      const dPercent = subPercents[subPercents.length - 1] - subPercents[0];
      const dWh = subWhs[subWhs.length - 1] - subWhs[0];
      // dWh/dt in hours is watts; show correct units
      slopeStr = `${formatPercent(dPercent / dt)}%/hr, ${formatWh(dWh / dt)} W`;
    }
    slopeEl.textContent = slopeStr;
  }
  function chargeFindClosestIndexForTs(ts) {
    if (!chargeTimestamps.length || ts == null) return null;
    let bestIdx = 0;
    let bestDiff = Math.abs(chargeTimestamps[0] - ts);
    for (let i = 1; i < chargeTimestamps.length; i++) {
      const d = Math.abs(chargeTimestamps[i] - ts);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  const chargeSelectionPlugin = {
    id: 'chargeSelectionHighlight',
    beforeDraw(chart) {
      if (!chart.canvas || chart.canvas !== chargeCanvasEl) return;
      const xScale = chart.scales.x;
      const { ctx, chartArea } = chart;
      if (!xScale || !chartArea) return;
      const { top, bottom } = chartArea;
      function drawBand(startIdx, endIdx, color) {
        if (startIdx == null || endIdx == null) return;
        const s = Math.max(0, Math.min(startIdx, endIdx));
        const e = Math.min(chargePercents.length - 1, Math.max(startIdx, endIdx));
        if (e <= s) return;
        const x1 = xScale.getPixelForValue(s);
        const x2 = xScale.getPixelForValue(e);
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.restore();
      }
      if (chargeHasUserSelection) {
        drawBand(chargeSelectedStartIdx, chargeSelectedEndIdx, 'rgba(59,130,246,0.18)');
      }
      if (chargeIsDragging) {
        drawBand(chargeDragStartIdx, chargeDragEndIdx, 'rgba(96,165,250,0.3)');
      }
    }
  };
  Chart.register(chargeSelectionPlugin);
  const chargeChart = new Chart(chargeCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Charge (Wh)',
          data: [],
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y',
        },
        {
          label: 'Charge (%)',
          data: [],
          borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,0.10)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: '#6b7280',
            maxTicksLimit: 8,
            callback: (value) => {
              const label = chargeChart.data.labels[value];
              return label || '';
            }
          },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Wh', color: '#38bdf8' },
          ticks: { color: '#38bdf8' },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '%', color: '#fbbf24' },
          ticks: { color: '#fbbf24' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { color: '#9ca3af' } }
      }
    }
  });
  function updateChargeEta() {
    const centerEtaEmptyEl = document.getElementById('battery-stat-eta-empty');
    const centerEtaFullEl = document.getElementById('battery-stat-eta-full');
    if (!centerEtaEmptyEl || !centerEtaFullEl) return;

    if (!chargeWhs.length || !chargeFulls.length || latestPowerW == null || !Number.isFinite(latestPowerW) || Math.abs(latestPowerW) < 0.1) {
      centerEtaEmptyEl.textContent = '–';
      centerEtaFullEl.textContent = '–';
      return;
    }

    const currentWh = chargeWhs[chargeWhs.length - 1];
    const fullWh = chargeFulls[chargeFulls.length - 1];
    const remainingWh = Math.max(fullWh - currentWh, 0);
    const p = Math.abs(latestPowerW);

    let etaEmpty = null;
    let etaFull = null;

    if (p > 0) {
      if (lastBatteryStatus === 'Discharging') {
        etaEmpty = currentWh / p;
      } else if (lastBatteryStatus === 'Charging') {
        if (remainingWh > 0) {
          etaFull = remainingWh / p;
        }
      } else if (lastBatteryStatus === 'Full') {
        // battery is full; no ETA needed
      } else {
        // Unknown status: estimate both directions
        etaEmpty = currentWh / p;
        if (remainingWh > 0) {
          etaFull = remainingWh / p;
        }
      }
    }

    const etaEmptyStr = etaEmpty && etaEmpty > 0.03 ? formatDurationHours(etaEmpty) : '–';
    const etaFullStr = etaFull && etaFull > 0.03 ? formatDurationHours(etaFull) : '–';

    centerEtaEmptyEl.textContent = etaEmptyStr;
    centerEtaFullEl.textContent = etaFullStr;
  }
  async function fetchChargeData() {
    try {
      const res = await fetch('/api/charge24');
      const json = await res.json();
      let timestamps = (json.timestamps || []).map(Number);
      let whs = (json.charge || []).map(Number);
      let fulls = (json.full || []).map(Number);
      // percent = charge / full * 100
      let percents = whs.map((v, i) => (fulls[i] ? (v / fulls[i]) * 100 : null));
      // sort by time
      const zipped = timestamps.map((t, i) => [t, whs[i], fulls[i], percents[i]])
        .filter(([t, v, f, p]) => Number.isFinite(t) && Number.isFinite(v) && Number.isFinite(f) && Number.isFinite(p))
        .sort((a, b) => a[0] - b[0]);
      if (!zipped.length) {
        chargeTimestamps = [];
        chargeWhs = [];
        chargeFulls = [];
        chargePercents = [];
        chargeChart.data.labels = [];
        chargeChart.data.datasets[0].data = [];
        chargeChart.data.datasets[1].data = [];
        chargeChart.update('none');
        updateChargeSelectionStats(null, null);
        document.getElementById('charge-last-updated').textContent = 'last update: no data yet';
        return;
      }
      let tsArr = zipped.map(p => p[0]);
      let whArr = zipped.map(p => p[1]);
      let fullArr = zipped.map(p => p[2]);
      let pctArr = zipped.map(p => p[3]);
      const ds = downsampleByMean(tsArr, [whArr, fullArr, pctArr]);
      chargeTimestamps = ds.timestamps;
      [chargeWhs, chargeFulls, chargePercents] = ds.values;
      const labels = chargeTimestamps.map(ts => formatTime(ts));
      chargeChart.data.labels = labels;
      chargeChart.data.datasets[0].data = chargeWhs;
      chargeChart.data.datasets[1].data = chargePercents;
      chargeChart.update('none');
      // Update centerpiece battery stats that depend on charge history
      const centerPercentEl = document.getElementById('battery-stat-percent');
      const centerNowEl = document.getElementById('battery-stat-now');
      const centerFullEl = document.getElementById('battery-stat-full');
      if (chargePercents.length && centerPercentEl) {
        const lastPct = chargePercents[chargePercents.length - 1];
        centerPercentEl.textContent = Number.isFinite(lastPct) ? formatPercent(lastPct) : '–';
      }
      if (chargeWhs.length && centerNowEl) {
        const lastWh = chargeWhs[chargeWhs.length - 1];
        centerNowEl.textContent = Number.isFinite(lastWh) ? formatWh(lastWh) : '–';
      }
      if (chargeFulls.length && centerFullEl) {
        const lastFullWh = chargeFulls[chargeFulls.length - 1];
        centerFullEl.textContent = Number.isFinite(lastFullWh) ? formatWh(lastFullWh) : '–';
      }
      const lastTs = chargeTimestamps[chargeTimestamps.length - 1];
      const lastUpdated = document.getElementById('charge-last-updated');
      if (lastTs) {
        lastUpdated.textContent = 'last update: ' + new Date(lastTs * 1000).toLocaleTimeString();
      } else {
        lastUpdated.textContent = 'last update: no data yet';
      }
      if (chargeHasUserSelection && chargeSelectedStartTs != null && chargeSelectedEndTs != null) {
        chargeSelectedStartIdx = chargeFindClosestIndexForTs(chargeSelectedStartTs);
        chargeSelectedEndIdx = chargeFindClosestIndexForTs(chargeSelectedEndTs);
        updateChargeSelectionStats(chargeSelectedStartIdx, chargeSelectedEndIdx);
      } else {
        // No explicit user selection: show full-range stats and keep them updated
        if (chargePercents.length) {
          updateChargeSelectionStats(0, chargePercents.length - 1);
        } else {
          updateChargeSelectionStats(null, null);
        }
      }
      updateChargeEta();
      chargeChart.draw();
    } catch (e) {
      console.error(e);
    }
  }
  fetchChargeData();
  setInterval(fetchChargeData, 5000);
  function chargeGetRelativeX(evt) {
    const rect = chargeCanvasEl.getBoundingClientRect();
    return evt.clientX - rect.left;
  }
  function chargeIndexFromX(x) {
    const xScale = chargeChart.scales.x;
    if (!xScale) return null;
    let v = xScale.getValueForPixel(x);
    if (!isFinite(v)) return null;
    v = Math.round(v);
    v = Math.max(0, Math.min(chargePercents.length - 1, v));
    return v;
  }
  function chargeFinishDrag() {
    if (!chargeIsDragging) return;
    chargeIsDragging = false;
    if (chargeDragStartIdx == null || chargeDragEndIdx == null) {
      chargeDragStartIdx = chargeDragEndIdx = null;
      return;
    }
    const s = Math.max(0, Math.min(chargeDragStartIdx, chargeDragEndIdx));
    const e = Math.min(chargePercents.length - 1, Math.max(chargeDragStartIdx, chargeDragEndIdx));
    if (Math.abs(e - s) < 2) {
      // clear user selection and revert to full-range stats
      chargeHasUserSelection = false;
      chargeSelectedStartTs = chargeSelectedEndTs = null;
      chargeSelectedStartIdx = chargeSelectedEndIdx = null;
      chargeDragStartIdx = chargeDragEndIdx = null;
      if (chargePercents.length) {
        updateChargeSelectionStats(0, chargePercents.length - 1);
      } else {
        updateChargeSelectionStats(null, null);
      }
      chargeChart.draw();
      return;
    }
    chargeSelectedStartIdx = s;
    chargeSelectedEndIdx = e;
    chargeSelectedStartTs = chargeTimestamps[s];
    chargeSelectedEndTs = chargeTimestamps[e];
    chargeHasUserSelection = true;
    chargeDragStartIdx = chargeDragEndIdx = null;
    updateChargeSelectionStats(chargeSelectedStartIdx, chargeSelectedEndIdx);
    chargeChart.draw();
  }
  chargeCanvasEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!chargePercents.length) return;
    chargeIsDragging = true;
    const x = chargeGetRelativeX(e);
    const idx = chargeIndexFromX(x);
    chargeDragStartIdx = chargeDragEndIdx = idx;
    chargeChart.draw();
  });
  chargeCanvasEl.addEventListener('mousemove', (e) => {
    e.preventDefault();
    if (!chargeIsDragging) return;
    const x = chargeGetRelativeX(e);
    const idx = chargeIndexFromX(x);
    chargeDragEndIdx = idx;
    chargeChart.draw();
  });
  chargeCanvasEl.addEventListener('mouseup', (e) => {
    e.preventDefault();
    chargeFinishDrag();
  });
  chargeCanvasEl.addEventListener('mouseleave', (e) => {
    e.preventDefault();
    if (chargeIsDragging) chargeFinishDrag();
  });
  chargeCanvasEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
  });

  // Battery power chart
  const canvasEl = document.getElementById('powerChart');
  const ctx = canvasEl.getContext('2d');

  // data we actually plot / use for stats
  let denseTimestamps = [];
  let densePowers = [];
  let latestPowerW = null;

  // whether the user has explicitly chosen a selection range
  let hasUserSelection = false;

  // selection in *time* space (kept across refreshes)
  let selectedStartTs = null;
  let selectedEndTs = null;
  // same selection in index space
  let selectedStartIdx = null;
  let selectedEndIdx = null;

  // drag state (index space)
  let isDragging = false;
  let dragStartIdx = null;
  let dragEndIdx = null;

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function formatW(v) {
    if (v === null || Number.isNaN(v)) return '–';
    return v.toFixed(2);
  }

  function formatTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function updateQuarterStats() {
    const qEls = [
      document.getElementById('q1-avg'),
      document.getElementById('q2-avg'),
      document.getElementById('q3-avg'),
      document.getElementById('q4-avg')
    ];

    if (!densePowers.length) {
      qEls.forEach(el => el.textContent = '–');
      return;
    }

    const n = densePowers.length;
    const base = Math.floor(n / 4) || 1;
    const boundaries = [
      0,
      Math.min(base, n),
      Math.min(base * 2, n),
      Math.min(base * 3, n),
      n
    ];

    for (let i = 0; i < 4; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const slice = densePowers.slice(start, end);
      qEls[i].textContent = slice.length ? formatW(mean(slice)) : '–';
    }
  }

  function updateSelectionStats(startIdx, endIdx) {
    const rangeEl = document.getElementById('sel-range');
    const minEl = document.getElementById('sel-min');
    const meanEl = document.getElementById('sel-mean');
    const maxEl = document.getElementById('sel-max');

    if (!densePowers.length || startIdx == null || endIdx == null) {
      rangeEl.textContent = 'no selection';
      minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
      return;
    }

    const s = Math.max(0, Math.min(startIdx, endIdx));
    const e = Math.min(densePowers.length - 1, Math.max(startIdx, endIdx));

    if (e <= s) {
      rangeEl.textContent = 'no selection';
      minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
      return;
    }

    const subPowers = densePowers.slice(s, e + 1);
    const tsStart = denseTimestamps[s];
    const tsEnd = denseTimestamps[e];

    const minV = Math.min(...subPowers);
    const maxV = Math.max(...subPowers);
    const meanV = mean(subPowers);

    rangeEl.textContent = `${formatTime(tsStart)} → ${formatTime(tsEnd)}`;
    minEl.textContent = formatW(minV);
    meanEl.textContent = formatW(meanV);
    maxEl.textContent = formatW(maxV);
  }

  function findClosestIndexForTs(ts) {
    if (!denseTimestamps.length || ts == null) return null;
    let bestIdx = 0;
    let bestDiff = Math.abs(denseTimestamps[0] - ts);
    for (let i = 1; i < denseTimestamps.length; i++) {
      const d = Math.abs(denseTimestamps[i] - ts);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  const selectionPlugin = {
    id: 'selectionHighlight',
    beforeDraw(chart) {
      if (!chart.canvas || chart.canvas !== canvasEl) return;
      const xScale = chart.scales.x;
      const { ctx, chartArea } = chart;
      if (!xScale || !chartArea) return;

      const { top, bottom } = chartArea;

      function drawBand(startIdx, endIdx, color) {
        if (startIdx == null || endIdx == null) return;
        const s = Math.max(0, Math.min(startIdx, endIdx));
        const e = Math.min(densePowers.length - 1, Math.max(startIdx, endIdx));
        if (e <= s) return;
        const x1 = xScale.getPixelForValue(s);
        const x2 = xScale.getPixelForValue(e);
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x1, top, x2 - x1, bottom - top);
        ctx.restore();
      }

      // Saved selection only if user explicitly selected a range
      if (hasUserSelection) {
        drawBand(selectedStartIdx, selectedEndIdx, 'rgba(59,130,246,0.18)');
      }
      // Live drag
      if (isDragging) {
        drawBand(dragStartIdx, dragEndIdx, 'rgba(96,165,250,0.3)');
      }
    }
  };

  Chart.register(selectionPlugin);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Power (W)',
        data: [],
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.20)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: '#6b7280',
            maxTicksLimit: 8,
            callback: (value) => {
              const label = chart.data.labels[value];
              return label || '';
            }
          },
          grid: { color: 'rgba(31,41,55,0.4)' }
        },
        y: {
          ticks: { color: '#6b7280' },
          grid: { color: 'rgba(31,41,55,0.4)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#9ca3af' } }
      }
    }
  });

  async function fetchData() {
    try {
      const res = await fetch('/api/past24');
      const json = await res.json();

      // force numeric + sort by time
      let timestamps = (json.timestamps || []).map(Number);
      let powers = (json.powers || []).map(Number);
      const zipped = timestamps.map((t, i) => [t, powers[i]])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
        .sort((a, b) => a[0] - b[0]);

      if (!zipped.length) {
        denseTimestamps = [];
        densePowers = [];
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update('none');
        updateQuarterStats();
        updateSelectionStats(null, null);
        document.getElementById('last-updated').textContent = 'last update: no data yet';
        return;
      }

      timestamps = zipped.map(p => p[0]);
      powers = zipped.map(p => p[1]);

      if (powers.length) {
        latestPowerW = powers[powers.length - 1];
      }

      // build dense arrays, inserting a 0 in large gaps
      denseTimestamps = [timestamps[0]];
      densePowers = [powers[0]];
      const GAP_THRESHOLD = 15; // seconds; your capture interval is 5s

      for (let i = 1; i < timestamps.length; i++) {
        const prevT = timestamps[i - 1];
        const currT = timestamps[i];
        const currV = powers[i];

        const gap = currT - prevT;
        if (gap > GAP_THRESHOLD) {
          const mid = prevT + gap / 2;
          denseTimestamps.push(mid);
          densePowers.push(0);    // gap -> treat as 0, but only one point
        }

        denseTimestamps.push(currT);
        densePowers.push(currV);
      }

      const ds2 = downsampleByMean(denseTimestamps, [densePowers]);
      denseTimestamps = ds2.timestamps;
      [densePowers] = ds2.values;

      const labels = denseTimestamps.map(ts => formatTime(ts));
      chart.data.labels = labels;
      chart.data.datasets[0].data = densePowers;
      chart.update('none');

      const lastTs = denseTimestamps[denseTimestamps.length - 1];
      const lastUpdated = document.getElementById('last-updated');
      if (lastTs) {
        lastUpdated.textContent = 'last update: ' +
          new Date(lastTs * 1000).toLocaleTimeString();
      } else {
        lastUpdated.textContent = 'last update: no data yet';
      }

      updateQuarterStats();

      // If the user has a saved selection, remap it; otherwise show full-range stats.
      if (hasUserSelection && selectedStartTs != null && selectedEndTs != null) {
        selectedStartIdx = findClosestIndexForTs(selectedStartTs);
        selectedEndIdx = findClosestIndexForTs(selectedEndTs);
        updateSelectionStats(selectedStartIdx, selectedEndIdx);
      } else {
        updateSelectionStats(0, densePowers.length - 1);
      }

      chart.draw();
    } catch (e) {
      console.error(e);
    }
  }

  fetchData();
  setInterval(fetchData, 5000);

  function getRelativeX(evt) {
    const rect = canvasEl.getBoundingClientRect();
    return evt.clientX - rect.left;
  }

  function indexFromX(x) {
    const xScale = chart.scales.x;
    if (!xScale) return null;
    let v = xScale.getValueForPixel(x);
    if (!isFinite(v)) return null;
    v = Math.round(v);
    v = Math.max(0, Math.min(densePowers.length - 1, v));
    return v;
  }

  function finishDrag() {
    if (!isDragging) return;
    isDragging = false;

    if (dragStartIdx == null || dragEndIdx == null) {
      dragStartIdx = dragEndIdx = null;
      return;
    }

    const s = Math.max(0, Math.min(dragStartIdx, dragEndIdx));
    const e = Math.min(densePowers.length - 1, Math.max(dragStartIdx, dragEndIdx));

    // tiny drag -> clear user selection and revert to full-range stats
    if (Math.abs(e - s) < 2) {
      hasUserSelection = false;
      selectedStartTs = selectedEndTs = null;
      selectedStartIdx = selectedEndIdx = null;
      dragStartIdx = dragEndIdx = null;
      if (densePowers.length) {
        updateSelectionStats(0, densePowers.length - 1);
      } else {
        updateSelectionStats(null, null);
      }
      chart.draw();
      return;
    }

    selectedStartIdx = s;
    selectedEndIdx = e;
    selectedStartTs = denseTimestamps[s];
    selectedEndTs = denseTimestamps[e];
    hasUserSelection = true;

    dragStartIdx = dragEndIdx = null;
    updateSelectionStats(selectedStartIdx, selectedEndIdx);
    chart.draw();
  }

  canvasEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!densePowers.length) return;
    isDragging = true;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    dragStartIdx = dragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mousemove', (e) => {
    e.preventDefault();
    if (!isDragging) return;
    const x = getRelativeX(e);
    const idx = indexFromX(x);
    dragEndIdx = idx;
    chart.draw();
  });

  canvasEl.addEventListener('mouseup', (e) => {
    e.preventDefault();
    finishDrag();
  });

  canvasEl.addEventListener('mouseleave', (e) => {
    e.preventDefault();
    if (isDragging) finishDrag();
  });

  // Prevent drag and drop image behavior on the canvas
  canvasEl.addEventListener('dragstart', (e) => {
    e.preventDefault();
  });

  // CPU chart
  (function () {
    const cpuCanvasEl = document.getElementById('cpuChart');
    if (!cpuCanvasEl) return;

    const cpuCtx = cpuCanvasEl.getContext('2d');
    let cpuTimestamps = [];
    let cpuPowers = [];

    let cpuSelectedStartTs = null;
    let cpuSelectedEndTs = null;
    let cpuSelectedStartIdx = null;
    let cpuSelectedEndIdx = null;
    let cpuIsDragging = false;
    let cpuDragStartIdx = null;
    let cpuDragEndIdx = null;
    let cpuHasUserSelection = false;

    function cpuMean(arr) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    function cpuFormatW(v) {
      if (v === null || Number.isNaN(v)) return '–';
      return v.toFixed(2);
    }

    function cpuFormatTime(ts) {
      const d = new Date(ts * 1000);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function cpuUpdateQuarterStats() {
      const qEls = [
        document.getElementById('cpu-q1-avg'),
        document.getElementById('cpu-q2-avg'),
        document.getElementById('cpu-q3-avg'),
        document.getElementById('cpu-q4-avg'),
      ];
      if (!cpuPowers.length) {
        qEls.forEach((el) => (el.textContent = '–'));
        return;
      }
      const n = cpuPowers.length;
      const base = Math.floor(n / 4) || 1;
      const boundaries = [0, Math.min(base, n), Math.min(base * 2, n), Math.min(base * 3, n), n];
      for (let i = 0; i < 4; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const slice = cpuPowers.slice(start, end);
        qEls[i].textContent = slice.length ? cpuFormatW(cpuMean(slice)) : '–';
      }
    }

    function cpuUpdateSelectionStats(startIdx, endIdx) {
      const rangeEl = document.getElementById('cpu-sel-range');
      const minEl = document.getElementById('cpu-sel-min');
      const meanEl = document.getElementById('cpu-sel-mean');
      const maxEl = document.getElementById('cpu-sel-max');

      if (!cpuPowers.length || startIdx == null || endIdx == null) {
        rangeEl.textContent = 'no selection';
        minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
        return;
      }

      const s = Math.max(0, Math.min(startIdx, endIdx));
      const e = Math.min(cpuPowers.length - 1, Math.max(startIdx, endIdx));
      if (e <= s) {
        rangeEl.textContent = 'no selection';
        minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
        return;
      }

      const subPowers = cpuPowers.slice(s, e + 1);
      const tsStart = cpuTimestamps[s];
      const tsEnd = cpuTimestamps[e];
      const minV = Math.min(...subPowers);
      const maxV = Math.max(...subPowers);
      const meanV = cpuMean(subPowers);

      rangeEl.textContent = `${cpuFormatTime(tsStart)} → ${cpuFormatTime(tsEnd)}`;
      minEl.textContent = cpuFormatW(minV);
      meanEl.textContent = cpuFormatW(meanV);
      maxEl.textContent = cpuFormatW(maxV);
    }

    function cpuFindClosestIndexForTs(ts) {
      if (!cpuTimestamps.length || ts == null) return null;
      let bestIdx = 0;
      let bestDiff = Math.abs(cpuTimestamps[0] - ts);
      for (let i = 1; i < cpuTimestamps.length; i++) {
        const d = Math.abs(cpuTimestamps[i] - ts);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    const cpuSelectionPlugin = {
      id: 'cpuSelectionHighlight',
      beforeDraw(chart) {
        if (!chart.canvas || chart.canvas !== cpuCanvasEl) return;
        const xScale = chart.scales.x;
        const { ctx, chartArea } = chart;
        if (!xScale || !chartArea) return;
        const { top, bottom } = chartArea;

        function drawBand(startIdx, endIdx, color) {
          if (startIdx == null || endIdx == null) return;
          const s = Math.max(0, Math.min(startIdx, endIdx));
          const e = Math.min(cpuPowers.length - 1, Math.max(startIdx, endIdx));
          if (e <= s) return;
          const x1 = xScale.getPixelForValue(s);
          const x2 = xScale.getPixelForValue(e);
          ctx.save();
          ctx.fillStyle = color;
          ctx.fillRect(x1, top, x2 - x1, bottom - top);
          ctx.restore();
        }

        if (cpuHasUserSelection) {
          drawBand(cpuSelectedStartIdx, cpuSelectedEndIdx, 'rgba(59,130,246,0.18)');
        }
        if (cpuIsDragging) {
          drawBand(cpuDragStartIdx, cpuDragEndIdx, 'rgba(96,165,250,0.3)');
        }
      },
    };

    Chart.register(cpuSelectionPlugin);

    const cpuChart = new Chart(cpuCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'CPU power (W)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.18)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              color: '#6b7280',
              maxTicksLimit: 8,
              callback: (value) => {
                const label = cpuChart.data.labels[value];
                return label || '';
              },
            },
            grid: { color: 'rgba(31,41,55,0.4)' },
          },
          y: {
            ticks: { color: '#6b7280' },
            grid: { color: 'rgba(31,41,55,0.4)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#9ca3af' } },
        },
      },
    });

    async function fetchCpuData() {
      try {
        const res = await fetch('/api/cpu24');
        const json = await res.json();
        let timestamps = (json.timestamps || []).map(Number);
        let powers = (json.powers || []).map(Number);
        const zipped = timestamps
          .map((t, i) => [t, powers[i]])
          .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
          .sort((a, b) => a[0] - b[0]);

        if (!zipped.length) {
          cpuTimestamps = [];
          cpuPowers = [];
          cpuChart.data.labels = [];
          cpuChart.data.datasets[0].data = [];
          cpuChart.update('none');
          cpuUpdateQuarterStats();
          cpuUpdateSelectionStats(null, null);
          const lastUpdated = document.getElementById('cpu-last-updated');
          if (lastUpdated) lastUpdated.textContent = 'last update: no data yet';
          return;
        }

        let cpuTsArr = zipped.map((p) => p[0]);
        let cpuPowArr = zipped.map((p) => p[1]);
        const cpuDs = downsampleByMean(cpuTsArr, [cpuPowArr]);
        cpuTimestamps = cpuDs.timestamps;
        [cpuPowers] = cpuDs.values;
        const labels = cpuTimestamps.map((ts) => cpuFormatTime(ts));
        cpuChart.data.labels = labels;
        cpuChart.data.datasets[0].data = cpuPowers;
        cpuChart.update('none');

        const lastTs = cpuTimestamps[cpuTimestamps.length - 1];
        const lastUpdated = document.getElementById('cpu-last-updated');
        if (lastUpdated) {
          if (lastTs) {
            lastUpdated.textContent = 'last update: ' + new Date(lastTs * 1000).toLocaleTimeString();
          } else {
            lastUpdated.textContent = 'last update: no data yet';
          }
        }

        cpuUpdateQuarterStats();
        if (cpuHasUserSelection && cpuSelectedStartTs != null && cpuSelectedEndTs != null) {
          cpuSelectedStartIdx = cpuFindClosestIndexForTs(cpuSelectedStartTs);
          cpuSelectedEndIdx = cpuFindClosestIndexForTs(cpuSelectedEndTs);
          cpuUpdateSelectionStats(cpuSelectedStartIdx, cpuSelectedEndIdx);
        } else {
          // No explicit user selection: show full-range stats and keep them updated
          if (cpuPowers.length) {
            cpuUpdateSelectionStats(0, cpuPowers.length - 1);
          } else {
            cpuUpdateSelectionStats(null, null);
          }
        }

        cpuChart.draw();
      } catch (e) {
        console.error(e);
      }
    }

    fetchCpuData();
    setInterval(fetchCpuData, 5000);

    function cpuGetRelativeX(evt) {
      const rect = cpuCanvasEl.getBoundingClientRect();
      return evt.clientX - rect.left;
    }

    function cpuIndexFromX(x) {
      const xScale = cpuChart.scales.x;
      if (!xScale) return null;
      let v = xScale.getValueForPixel(x);
      if (!isFinite(v)) return null;
      v = Math.round(v);
      v = Math.max(0, Math.min(cpuPowers.length - 1, v));
      return v;
    }

    function cpuFinishDrag() {
      if (!cpuIsDragging) return;
      cpuIsDragging = false;

      if (cpuDragStartIdx == null || cpuDragEndIdx == null) {
        cpuDragStartIdx = cpuDragEndIdx = null;
        return;
      }

      const s = Math.max(0, Math.min(cpuDragStartIdx, cpuDragEndIdx));
      const e = Math.min(cpuPowers.length - 1, Math.max(cpuDragStartIdx, cpuDragEndIdx));

      if (Math.abs(e - s) < 2) {
        // clear user selection and revert to full-range stats
        cpuHasUserSelection = false;
        cpuSelectedStartTs = cpuSelectedEndTs = null;
        cpuSelectedStartIdx = cpuSelectedEndIdx = null;
        cpuDragStartIdx = cpuDragEndIdx = null;
        if (cpuPowers.length) {
          cpuUpdateSelectionStats(0, cpuPowers.length - 1);
        } else {
          cpuUpdateSelectionStats(null, null);
        }
        cpuChart.draw();
        return;
      }

      cpuSelectedStartIdx = s;
      cpuSelectedEndIdx = e;
      cpuSelectedStartTs = cpuTimestamps[s];
      cpuSelectedEndTs = cpuTimestamps[e];
      cpuHasUserSelection = true;
      cpuDragStartIdx = cpuDragEndIdx = null;
      cpuUpdateSelectionStats(cpuSelectedStartIdx, cpuSelectedEndIdx);
      cpuChart.draw();
    }

    cpuCanvasEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!cpuPowers.length) return;
      cpuIsDragging = true;
      const x = cpuGetRelativeX(e);
      const idx = cpuIndexFromX(x);
      cpuDragStartIdx = cpuDragEndIdx = idx;
      cpuChart.draw();
    });

    cpuCanvasEl.addEventListener('mousemove', (e) => {
      e.preventDefault();
      if (!cpuIsDragging) return;
      const x = cpuGetRelativeX(e);
      const idx = cpuIndexFromX(x);
      cpuDragEndIdx = idx;
      cpuChart.draw();
    });

    cpuCanvasEl.addEventListener('mouseup', (e) => {
      e.preventDefault();
      cpuFinishDrag();
    });

    cpuCanvasEl.addEventListener('mouseleave', (e) => {
      e.preventDefault();
      if (cpuIsDragging) cpuFinishDrag();
    });

    cpuCanvasEl.addEventListener('dragstart', (e) => {
      e.preventDefault();
    });
  })();

  // GPU chart
  (function () {
    const gpuCanvasEl = document.getElementById('gpuChart');
    if (!gpuCanvasEl) return;

    const gpuCtx = gpuCanvasEl.getContext('2d');
    let gpuTimestamps = [];
    let gpuPowers = [];

    let gpuSelectedStartTs = null;
    let gpuSelectedEndTs = null;
    let gpuSelectedStartIdx = null;
    let gpuSelectedEndIdx = null;
    let gpuIsDragging = false;
    let gpuDragStartIdx = null;
    let gpuDragEndIdx = null;
    let gpuHasUserSelection = false;

    function gpuMean(arr) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    function gpuFormatW(v) {
      if (v === null || Number.isNaN(v)) return '–';
      return v.toFixed(2);
    }

    function gpuFormatTime(ts) {
      const d = new Date(ts * 1000);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function gpuUpdateQuarterStats() {
      const qEls = [
        document.getElementById('gpu-q1-avg'),
        document.getElementById('gpu-q2-avg'),
        document.getElementById('gpu-q3-avg'),
        document.getElementById('gpu-q4-avg'),
      ];
      if (!gpuPowers.length) {
        qEls.forEach((el) => (el.textContent = '–'));
        return;
      }
      const n = gpuPowers.length;
      const base = Math.floor(n / 4) || 1;
      const boundaries = [0, Math.min(base, n), Math.min(base * 2, n), Math.min(base * 3, n), n];
      for (let i = 0; i < 4; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const slice = gpuPowers.slice(start, end);
        qEls[i].textContent = slice.length ? gpuFormatW(gpuMean(slice)) : '–';
      }
    }

    function gpuUpdateSelectionStats(startIdx, endIdx) {
      const rangeEl = document.getElementById('gpu-sel-range');
      const minEl = document.getElementById('gpu-sel-min');
      const meanEl = document.getElementById('gpu-sel-mean');
      const maxEl = document.getElementById('gpu-sel-max');

      if (!gpuPowers.length || startIdx == null || endIdx == null) {
        rangeEl.textContent = 'no selection';
        minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
        return;
      }

      const s = Math.max(0, Math.min(startIdx, endIdx));
      const e = Math.min(gpuPowers.length - 1, Math.max(startIdx, endIdx));
      if (e <= s) {
        rangeEl.textContent = 'no selection';
        minEl.textContent = meanEl.textContent = maxEl.textContent = '–';
        return;
      }

      const subPowers = gpuPowers.slice(s, e + 1);
      const tsStart = gpuTimestamps[s];
      const tsEnd = gpuTimestamps[e];
      const minV = Math.min(...subPowers);
      const maxV = Math.max(...subPowers);
      const meanV = gpuMean(subPowers);

      rangeEl.textContent = `${gpuFormatTime(tsStart)} → ${gpuFormatTime(tsEnd)}`;
      minEl.textContent = gpuFormatW(minV);
      meanEl.textContent = gpuFormatW(meanV);
      maxEl.textContent = gpuFormatW(maxV);
    }

    function gpuFindClosestIndexForTs(ts) {
      if (!gpuTimestamps.length || ts == null) return null;
      let bestIdx = 0;
      let bestDiff = Math.abs(gpuTimestamps[0] - ts);
      for (let i = 1; i < gpuTimestamps.length; i++) {
        const d = Math.abs(gpuTimestamps[i] - ts);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    const gpuSelectionPlugin = {
      id: 'gpuSelectionHighlight',
      beforeDraw(chart) {
        if (!chart.canvas || chart.canvas !== gpuCanvasEl) return;
        const xScale = chart.scales.x;
        const { ctx, chartArea } = chart;
        if (!xScale || !chartArea) return;
        const { top, bottom } = chartArea;

        function drawBand(startIdx, endIdx, color) {
          if (startIdx == null || endIdx == null) return;
          const s = Math.max(0, Math.min(startIdx, endIdx));
          const e = Math.min(gpuPowers.length - 1, Math.max(startIdx, endIdx));
          if (e <= s) return;
          const x1 = xScale.getPixelForValue(s);
          const x2 = xScale.getPixelForValue(e);
          ctx.save();
          ctx.fillStyle = color;
          ctx.fillRect(x1, top, x2 - x1, bottom - top);
          ctx.restore();
        }

        if (gpuHasUserSelection) {
          drawBand(gpuSelectedStartIdx, gpuSelectedEndIdx, 'rgba(59,130,246,0.18)');
        }
        if (gpuIsDragging) {
          drawBand(gpuDragStartIdx, gpuDragEndIdx, 'rgba(96,165,250,0.3)');
        }
      },
    };

    Chart.register(gpuSelectionPlugin);

    const gpuChart = new Chart(gpuCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'GPU power (W)',
            data: [],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.18)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              color: '#6b7280',
              maxTicksLimit: 8,
              callback: (value) => {
                const label = gpuChart.data.labels[value];
                return label || '';
              },
            },
            grid: { color: 'rgba(31,41,55,0.4)' },
          },
          y: {
            ticks: { color: '#6b7280' },
            grid: { color: 'rgba(31,41,55,0.4)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#9ca3af' } },
        },
      },
    });

    async function fetchGpuData() {
      try {
        const res = await fetch('/api/gpu24');
        const json = await res.json();
          let timestamps = (json.timestamps || []).map(Number);
          let powers = (json.powers || []).map(Number);
        const zipped = timestamps
          .map((t, i) => [t, powers[i]])
          .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
          .sort((a, b) => a[0] - b[0]);

        if (!zipped.length) {
          gpuTimestamps = [];
          gpuPowers = [];
          gpuChart.data.labels = [];
          gpuChart.data.datasets[0].data = [];
          gpuChart.update('none');
          gpuUpdateQuarterStats();
          gpuUpdateSelectionStats(null, null);
          const lastUpdated = document.getElementById('gpu-last-updated');
          if (lastUpdated) lastUpdated.textContent = 'last update: no data yet';
          return;
        }

          let gpuTsArr = zipped.map((p) => p[0]);
          let gpuPowArr = zipped.map((p) => p[1]);
          const gpuDs = downsampleByMean(gpuTsArr, [gpuPowArr]);
          gpuTimestamps = gpuDs.timestamps;
          [gpuPowers] = gpuDs.values;
        const labels = gpuTimestamps.map((ts) => gpuFormatTime(ts));
        gpuChart.data.labels = labels;
        gpuChart.data.datasets[0].data = gpuPowers;
        gpuChart.update('none');

        const lastTs = gpuTimestamps[gpuTimestamps.length - 1];
        const lastUpdated = document.getElementById('gpu-last-updated');
        if (lastUpdated) {
          if (lastTs) {
            lastUpdated.textContent = 'last update: ' + new Date(lastTs * 1000).toLocaleTimeString();
          } else {
            lastUpdated.textContent = 'last update: no data yet';
          }
        }

        gpuUpdateQuarterStats();
        if (gpuHasUserSelection && gpuSelectedStartTs != null && gpuSelectedEndTs != null) {
          gpuSelectedStartIdx = gpuFindClosestIndexForTs(gpuSelectedStartTs);
          gpuSelectedEndIdx = gpuFindClosestIndexForTs(gpuSelectedEndTs);
          gpuUpdateSelectionStats(gpuSelectedStartIdx, gpuSelectedEndIdx);
        } else {
          // No explicit user selection: show full-range stats and keep them updated
          if (gpuPowers.length) {
            gpuUpdateSelectionStats(0, gpuPowers.length - 1);
          } else {
            gpuUpdateSelectionStats(null, null);
          }
        }

        gpuChart.draw();
      } catch (e) {
        console.error(e);
      }
    }

    fetchGpuData();
    setInterval(fetchGpuData, 5000);

    function gpuGetRelativeX(evt) {
      const rect = gpuCanvasEl.getBoundingClientRect();
      return evt.clientX - rect.left;
    }

    function gpuIndexFromX(x) {
      const xScale = gpuChart.scales.x;
      if (!xScale) return null;
      let v = xScale.getValueForPixel(x);
      if (!isFinite(v)) return null;
      v = Math.round(v);
      v = Math.max(0, Math.min(gpuPowers.length - 1, v));
      return v;
    }

    function gpuFinishDrag() {
      if (!gpuIsDragging) return;
      gpuIsDragging = false;

      if (gpuDragStartIdx == null || gpuDragEndIdx == null) {
        gpuDragStartIdx = gpuDragEndIdx = null;
        return;
      }

      const s = Math.max(0, Math.min(gpuDragStartIdx, gpuDragEndIdx));
      const e = Math.min(gpuPowers.length - 1, Math.max(gpuDragStartIdx, gpuDragEndIdx));

      if (Math.abs(e - s) < 2) {
        // clear user selection and revert to full-range stats
        gpuHasUserSelection = false;
        gpuSelectedStartTs = gpuSelectedEndTs = null;
        gpuSelectedStartIdx = gpuSelectedEndIdx = null;
        gpuDragStartIdx = gpuDragEndIdx = null;
        if (gpuPowers.length) {
          gpuUpdateSelectionStats(0, gpuPowers.length - 1);
        } else {
          gpuUpdateSelectionStats(null, null);
        }
        gpuChart.draw();
        return;
      }

      gpuSelectedStartIdx = s;
      gpuSelectedEndIdx = e;
      gpuSelectedStartTs = gpuTimestamps[s];
      gpuSelectedEndTs = gpuTimestamps[e];
      gpuHasUserSelection = true;
      gpuDragStartIdx = gpuDragEndIdx = null;
      gpuUpdateSelectionStats(gpuSelectedStartIdx, gpuSelectedEndIdx);
      gpuChart.draw();
    }

    gpuCanvasEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!gpuPowers.length) return;
      gpuIsDragging = true;
      const x = gpuGetRelativeX(e);
      const idx = gpuIndexFromX(x);
      gpuDragStartIdx = gpuDragEndIdx = idx;
      gpuChart.draw();
    });

    gpuCanvasEl.addEventListener('mousemove', (e) => {
      e.preventDefault();
      if (!gpuIsDragging) return;
      const x = gpuGetRelativeX(e);
      const idx = gpuIndexFromX(x);
      gpuDragEndIdx = idx;
      gpuChart.draw();
    });

    gpuCanvasEl.addEventListener('mouseup', (e) => {
      e.preventDefault();
      gpuFinishDrag();
    });

    gpuCanvasEl.addEventListener('mouseleave', (e) => {
      e.preventDefault();
      if (gpuIsDragging) gpuFinishDrag();
    });

    gpuCanvasEl.addEventListener('dragstart', (e) => {
      e.preventDefault();
    });
  })();
});
