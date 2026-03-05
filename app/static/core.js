// Core utilities and shared state for batttracker frontend

window.BattApp = window.BattApp || {};

(function (ns) {
  // Shared state used across modules (ETA, etc.)
  ns.lastBatteryStatus = null; // string, e.g. "Charging" / "Discharging"
  ns.latestPowerW = null;      // latest battery power sample in watts

  // Downsample series to ~targetBuckets points by averaging contiguous buckets.
  ns.downsampleByMean = function (timestamps, valueArrays, targetBuckets = 100) {
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
  };

  // Simple HH:MM time label for x-axes
  ns.formatTimeShort = function (ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
})(window.BattApp);
