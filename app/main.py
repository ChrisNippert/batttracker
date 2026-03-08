import time
import sqlite3
import subprocess
import shutil
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


def _run_text_command(args, timeout=2):
    try:
        res = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception:
        return None
    if res.returncode != 0:
        return None
    return (res.stdout or "").strip()


def detect_cpu_name():
    """Best-effort CPU model detection."""
    try:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if line.lower().startswith("model name"):
                    parts = line.split(":", 1)
                    if len(parts) == 2:
                        value = parts[1].strip()
                        if value:
                            return value
    except Exception:
        pass

    out = _run_text_command(["lscpu"])
    if out:
        for line in out.splitlines():
            if line.lower().startswith("model name:"):
                value = line.split(":", 1)[1].strip()
                if value:
                    return value

    return "CPU"


def detect_gpu_name():
    """Best-effort GPU model detection."""
    if shutil.which("nvidia-smi"):
        out = _run_text_command(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            timeout=2,
        )
        if out:
            names = [line.strip() for line in out.splitlines() if line.strip()]
            if names:
                # If there are multiple GPUs, keep it compact in the title.
                return names[0] if len(names) == 1 else f"{names[0]} (+{len(names)-1} more)"

    if shutil.which("lspci"):
        out = _run_text_command(["lspci"], timeout=2)
        if out:
            for line in out.splitlines():
                lower = line.lower()
                if "vga compatible controller" in lower or "3d controller" in lower or "display controller" in lower:
                    parts = line.split(": ", 1)
                    value = parts[1].strip() if len(parts) == 2 else line.strip()
                    if value:
                        return value

    if amd_gpu_power_path:
        return "AMD GPU"
    if gpu_energy_path:
        return "Integrated GPU"
    return "GPU"

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


def make_sysfs_int_reader(path):
    """Create a function that reads an integer value from a sysfs file."""
    def _read_int():
        if not path:
            raise Exception("path not available")
        with open(path, "r") as f:
            return int(f.read().strip())
    return _read_int


def read_amd_gpu_power_w():
    """Read AMD GPU average power in watts from hwmon, if available.

    power1_average is exposed in microwatts, so divide by 1e6.
    """
    if amd_gpu_power_path is None:
        raise Exception("AMD GPU power path not available")
    with open(amd_gpu_power_path, "r") as f:
        microwatts = int(f.read().strip())
    return microwatts / 1_000_000.0


def read_nvidia_smi_gpu_power_w():
    """Read total NVIDIA GPU power draw in watts via nvidia-smi."""
    result = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=power.draw",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=2,
    )
    if result.returncode != 0:
        raise Exception(f"nvidia-smi failed: {result.stderr.strip()}")
    values = []
    for line in result.stdout.splitlines():
        raw = line.strip()
        if not raw or raw == "N/A":
            continue
        values.append(float(raw))
    if not values:
        raise Exception("no NVIDIA GPU power values found")
    return sum(values)


def make_delta_power_getter(read_counter, counter_scale=1_000_000.0):
    """Create a getter that converts monotonically increasing counters to watts."""
    state = {"prev_t": None, "prev_e": None}

    def _get_power_w():
        now = time.time()
        energy = read_counter()
        prev_t = state["prev_t"]
        prev_e = state["prev_e"]
        state["prev_t"] = now
        state["prev_e"] = energy
        if prev_t is None or prev_e is None:
            return None
        dt = now - prev_t
        delta_uj = energy - prev_e
        if dt <= 0 or delta_uj < 0:
            return None
        return (delta_uj / counter_scale) / dt

    return _get_power_w


CPU_POWER_PROVIDERS = [
    {
        "name": "intel_rapl_cpu",
        "detect": lambda: cpu_energy_path is not None,
        "build_getter": lambda: make_delta_power_getter(
            make_sysfs_int_reader(cpu_energy_path), counter_scale=1_000_000.0
        ),
    },
]

GPU_POWER_PROVIDERS = [
    {
        "name": "intel_rapl_gpu",
        "detect": lambda: gpu_energy_path is not None,
        "build_getter": lambda: make_delta_power_getter(
            make_sysfs_int_reader(gpu_energy_path), counter_scale=1_000_000.0
        ),
    },
    {
        "name": "amd_hwmon_gpu",
        "detect": lambda: amd_gpu_power_path is not None,
        "build_getter": lambda: read_amd_gpu_power_w,
    },
    {
        "name": "nvidia_smi_gpu",
        "detect": lambda: shutil.which("nvidia-smi") is not None,
        "build_getter": lambda: read_nvidia_smi_gpu_power_w,
    },
]


def _build_enabled_getters(provider_defs):
    enabled = []
    for provider in provider_defs:
        try:
            if provider["detect"]():
                enabled.append(
                    {
                        "name": provider["name"],
                        "getter": provider["build_getter"](),
                    }
                )
        except Exception:
            continue
    return enabled


CPU_GETTERS = _build_enabled_getters(CPU_POWER_PROVIDERS)
GPU_GETTERS = _build_enabled_getters(GPU_POWER_PROVIDERS)
CPU_DEVICE_NAME = detect_cpu_name()
GPU_DEVICE_NAME = detect_gpu_name()

print(
    f"Battery: {battery_name}\n"
    f"CPU energy path: {cpu_energy_path}\n"
    f"GPU energy path: {gpu_energy_path}\n"
    f"AMD GPU power path: {amd_gpu_power_path}\n"
    f"CPU name: {CPU_DEVICE_NAME}\n"
    f"GPU name: {GPU_DEVICE_NAME}\n"
    f"CPU providers: {[p['name'] for p in CPU_GETTERS]}\n"
    f"GPU providers: {[p['name'] for p in GPU_GETTERS]}\n"
)


def _collect_and_write_power(cur, table_name, timestamp, getter_defs):
    """Run provider getter(s) and write first successful value to SQLite."""
    for provider in getter_defs:
        value = write_power_sample(
            cur,
            table_name,
            timestamp,
            provider["getter"],
            provider_name=provider["name"],
        )
        if value is not None:
            return value
    print(f"[WARN] no sample written for {table_name} at {timestamp}")
    return None


def write_power_sample(cur, table_name, timestamp, get_power_w, provider_name="unknown"):
    """Call any power getter function and write a valid sample to SQLite."""
    try:
        value = get_power_w()
    except Exception as e:
        print(
            f"[WARN] provider '{provider_name}' failed for {table_name} at {timestamp}: {e}"
        )
        return None
    if value is None:
        print(
            f"[DEBUG] provider '{provider_name}' returned no value for {table_name} at {timestamp}"
        )
        return None
    cur.execute(
        f"INSERT INTO {table_name} (timestamp, power) VALUES (?, ?)",
        (timestamp, value),
    )
    print(
        f"[DEBUG] wrote {table_name} sample from '{provider_name}' at {timestamp}: {value:.3f} W"
    )
    return value


def collect_cpu_power(cur, timestamp, getter_defs):
    return _collect_and_write_power(cur, "cpu_power", timestamp, getter_defs)


def collect_gpu_power(cur, timestamp, getter_defs):
    return _collect_and_write_power(cur, "gpu_power", timestamp, getter_defs)

def cap_data():
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        _init_db()
        timestamp = int(time.time())

        conn = _get_db_connection()
        cur = conn.cursor()

        # Log CPU/GPU power even if there is no battery present.
        collect_cpu_power(cur, timestamp, CPU_GETTERS)
        collect_gpu_power(cur, timestamp, GPU_GETTERS)

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
        "model": model,
        "cpu_name": CPU_DEVICE_NAME,
        "gpu_name": GPU_DEVICE_NAME,
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


@app.route("/api/hardware")
def api_hardware():
    return jsonify({
        "cpu_name": CPU_DEVICE_NAME,
        "gpu_name": GPU_DEVICE_NAME,
        "cpu_providers": [p["name"] for p in CPU_GETTERS],
        "gpu_providers": [p["name"] for p in GPU_GETTERS],
    })

def main():
    while True:
        cap_data()
        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
