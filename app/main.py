import time
import sqlite3
import pandas as pd
from flask import Flask, jsonify, render_template, request

import os

app = Flask(__name__, template_folder="templates", static_folder="static")

DATA_DIR = "data"
DB_PATH = os.path.join(DATA_DIR, "batttracker.db")

# Sampling / polling interval (seconds). Can be overridden via env var.
_poll_env = os.environ.get("BATTRACKER_POLL_INTERVAL_S", "5")
try:
    POLL_INTERVAL_SECONDS = max(1.0, float(_poll_env))
except ValueError:
    POLL_INTERVAL_SECONDS = 5.0

print(f"Starting battery monitor with data directory: {DATA_DIR}")
battery_name = None
# check if "BAT0" exists. if not, check for "CMB0"
# if neither exist, just have battery_name = none
if os.path.exists("/sys/class/power_supply/BAT0"):
    battery_name = "BAT0"
elif os.path.exists("/sys/class/power_supply/CMB0"):
    battery_name = "CMB0"

# RAPL energy counters (microjoules). Paths vary by kernel/platform.
cpu_energy_path = None
for _p in [
    "/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj",  # common on modern kernels
    "/sys/class/powercap/intel-rapl:0/energy_uj",            # older layout
]:
    if os.path.exists(_p):
        cpu_energy_path = _p
        break

gpu_energy_path = None  # Intel iGPU/GT via RAPL
for _p in [
    "/sys/class/powercap/intel-rapl/intel-rapl:0:1/energy_uj",
    "/sys/class/powercap/intel-rapl:0:1/energy_uj",
]:
    if os.path.exists(_p):
        gpu_energy_path = _p
        break

def _find_amd_gpu_power_path():
    """Best-effort discovery of an AMD GPU hwmon power1_average file.

    Typical layout:
      /sys/class/drm/cardX/device/hwmon/hwmonY/power1_average
    where power1_average is in microwatts.
    """
    base = "/sys/class/drm"
    if not os.path.isdir(base):
        return None
    try:
        for entry in os.listdir(base):
            if not entry.startswith("card"):
                continue
            hwmon_dir = os.path.join(base, entry, "device", "hwmon")
            if not os.path.isdir(hwmon_dir):
                continue
            for hm in os.listdir(hwmon_dir):
                candidate = os.path.join(hwmon_dir, hm, "power1_average")
                if os.path.exists(candidate):
                    return candidate
    except Exception:
        return None
    return None


amd_gpu_power_path = _find_amd_gpu_power_path()

print(f"Battery: {battery_name}\nCPU energy path: {cpu_energy_path}\nGPU energy path: {gpu_energy_path}\nAMD GPU power path: {amd_gpu_power_path}\n")


def _get_db_connection():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def _init_db():
    conn = _get_db_connection()
    cur = conn.cursor()
    # Simple schema: one row per sample, integer timestamp seconds since epoch
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS battery_power (
            timestamp INTEGER NOT NULL,
            power REAL NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS battery_charge (
            timestamp INTEGER NOT NULL,
            charge REAL NOT NULL,
            full REAL NOT NULL,
            full_design REAL NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cpu_power (
            timestamp INTEGER NOT NULL,
            power REAL NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS gpu_power (
            timestamp INTEGER NOT NULL,
            power REAL NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()

def read_battery_power():
    with open(f"/sys/class/power_supply/{battery_name}/power_now", "r") as f:
        power = int(f.read().strip())
    return power / 1_000_000

def read_battery_charge():
    # returns tuple of (current_charge, full_charge)
    with open(f"/sys/class/power_supply/{battery_name}/energy_full", "r") as f:
        full = int(f.read().strip())
    with open(f"/sys/class/power_supply/{battery_name}/energy_full_design", "r") as f:
        full_design = int(f.read().strip())
    with open(f"/sys/class/power_supply/{battery_name}/energy_now", "r") as f:
        current = int(f.read().strip())
    return current / 1_000_000, full / 1_000_000, full_design / 1_000_000


def read_cpu_energy_uj():
    """Read package energy counter in microjoules from RAPL, if available."""
    if cpu_energy_path is None:
        raise Exception("CPU energy path not available")
    with open(cpu_energy_path, "r") as f:
        return int(f.read().strip())


def read_gpu_energy_uj():
    """Read integrated GPU/GT energy counter in microjoules from RAPL, if available."""
    if gpu_energy_path is None:
        raise Exception("GPU energy path not available")
    with open(gpu_energy_path, "r") as f:
        return int(f.read().strip())


def read_amd_gpu_power_w():
    """Read AMD GPU average power in watts from hwmon, if available.

    power1_average is exposed in microwatts, so divide by 1e6.
    """
    if amd_gpu_power_path is None:
        raise Exception("AMD GPU power path not available")
    with open(amd_gpu_power_path, "r") as f:
        microwatts = int(f.read().strip())
    return microwatts / 1_000_000.0

def cap_data():
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        _init_db()

        # Measure CPU and GPU package power from RAPL energy counters over ~1s window
        cpu_power = None
        gpu_power = None
        try:
            e1_cpu = read_cpu_energy_uj()
            try:
                e1_gpu = read_gpu_energy_uj()
            except Exception:
                e1_gpu = None
            t1 = time.time()
            time.sleep(1.0)
            e2_cpu = read_cpu_energy_uj()
            try:
                e2_gpu = read_gpu_energy_uj()
            except Exception:
                e2_gpu = None
            t2 = time.time()
            dt = t2 - t1
            if dt > 0:
                delta_cpu_uj = e2_cpu - e1_cpu
                if delta_cpu_uj >= 0:
                    # energy_uj is microjoules -> convert to joules and divide by elapsed seconds
                    cpu_power = (delta_cpu_uj / 1_000_000.0) / dt
                if e1_gpu is not None and e2_gpu is not None:
                    delta_gpu_uj = e2_gpu - e1_gpu
                    if delta_gpu_uj >= 0:
                        gpu_power = (delta_gpu_uj / 1_000_000.0) / dt
        except Exception:
            # If RAPL is unavailable or unreadable, just skip CPU logging
            cpu_power = None
            gpu_power = None

        # Fallback: if no GPU power from RAPL, try AMD hwmon instantaneous power
        if gpu_power is None:
            try:
                gpu_power = read_amd_gpu_power_w()
            except Exception:
                gpu_power = None
        timestamp = int(time.time())
        date = time.strftime("%Y-%m-%d", time.localtime(timestamp))

        conn = _get_db_connection()
        cur = conn.cursor()

        # Log CPU/GPU power even if there is no battery present
        if cpu_power is not None:
            cur.execute("INSERT INTO cpu_power (timestamp, power) VALUES (?, ?)", (timestamp, cpu_power))
        if gpu_power is not None:
            cur.execute("INSERT INTO gpu_power (timestamp, power) VALUES (?, ?)", (timestamp, gpu_power))

        # Battery logging is independent and only occurs if a battery is present
        if battery_name is None:
            print("No battery found, skipping battery logging")
        else:
            power = read_battery_power()
            charge, full, full_design = read_battery_charge()

            cur.execute("INSERT INTO battery_power (timestamp, power) VALUES (?, ?)", (timestamp, power))
            cur.execute(
                "INSERT INTO battery_charge (timestamp, charge, full, full_design) VALUES (?, ?, ?, ?)",
                (timestamp, charge, full, full_design),
            )

        conn.commit()
        conn.close()
    except Exception as e:
        import traceback
        print(f"[ERROR] {time.strftime('%Y-%m-%d %H:%M:%S')} Exception in cap_data: {e}")
        traceback.print_exc()

def get_battery_status():
    def read_file(path, cast=str, scale=1):
        try:
            with open(path, "r") as f:
                return cast(f.read().strip()) / scale if scale != 1 else cast(f.read().strip())
        except Exception:
            return None

    base = f"/sys/class/power_supply/{battery_name}"
    status = read_file(f"{base}/status") or "Unknown"
    cycles = read_file(f"{base}/cycle_count", int)
    design_capacity = read_file(f"{base}/energy_full_design", int, 1_000_000)
    full = read_file(f"{base}/energy_full", int, 1_000_000)
    temp = read_file(f"{base}/temp", int, 10)  # tenths of degree C
    manufacturer = read_file(f"{base}/manufacturer")
    model = read_file(f"{base}/model_name")
    health = None
    if full and design_capacity:
        health = 100 * full / design_capacity
    return {
        "status": status,
        "cycles": cycles,
        "design_capacity": design_capacity,
        "full_capacity": full,
        "health": health,
        "temperature": temp,
        "manufacturer": manufacturer,
        "model": model
    }


def _query_series(table, select_cols, since=None, window_seconds=24 * 60 * 60):
    """Query a time series from SQLite.

    Returns a pandas DataFrame with at least a 'timestamp' column and the
    requested value columns, filtered to the last `window_seconds` and
    optionally only rows with timestamp > since.
    """
    now_ts = int(time.time())
    cutoff = now_ts - window_seconds

    where_clauses = ["timestamp >= ?"]
    params = [cutoff]
    if since is not None:
        where_clauses.append("timestamp > ?")
        params.append(int(since))

    sql = f"SELECT timestamp, {', '.join(select_cols)} FROM {table} WHERE " + " AND ".join(where_clauses) + " ORDER BY timestamp ASC"

    conn = _get_db_connection()
    try:
        df = pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()

    if df.empty:
        return None
    return df
@app.route("/")
def index():
    # Expose polling interval to frontend (milliseconds)
    return render_template("index.html", poll_interval_ms=int(POLL_INTERVAL_SECONDS * 1000))


@app.route("/api/past24")
def api_past24():
    try:
        since = request.args.get("since", type=int)
        df = _query_series("battery_power", ["power"], since=since)
        if df is None or df.empty:
            raise Exception("no battery power data")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "powers": df["power"].tolist()
        })
    except Exception:
        return jsonify({"timestamps": [], "powers": []})

# New endpoint for battery charge
@app.route("/api/charge24")
def api_charge24():
    try:
        since = request.args.get("since", type=int)
        df = _query_series("battery_charge", ["charge", "full", "full_design"], since=since)
        if df is None or df.empty:
            raise Exception("no battery charge data")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "charge": df["charge"].tolist(),
            "full": df["full"].tolist(),
            "full_design": df["full_design"].tolist()
        })
    except Exception:
        return jsonify({"timestamps": [], "charge": [], "full": [], "full_design": []})


@app.route("/api/cpu24")
def api_cpu24():
    try:
        since = request.args.get("since", type=int)
        df = _query_series("cpu_power", ["power"], since=since)
        if df is None or df.empty:
            raise Exception("no cpu data")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "powers": df["power"].tolist(),
        })
    except Exception:
        return jsonify({"timestamps": [], "powers": []})


@app.route("/api/gpu24")
def api_gpu24():
    try:
        since = request.args.get("since", type=int)
        df = _query_series("gpu_power", ["power"], since=since)
        if df is None or df.empty:
            raise Exception("no gpu data")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "powers": df["power"].tolist(),
        })
    except Exception:
        return jsonify({"timestamps": [], "powers": []})
    
@app.route("/api/status")
def api_status():
    return jsonify(get_battery_status())

def main():
    while True:
        cap_data()
        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()