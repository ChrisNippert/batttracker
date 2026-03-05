import time
import pandas as pd
from flask import Flask, jsonify, render_template

import os

app = Flask(__name__, template_folder="templates", static_folder="static")

DATA_DIR = "data"

battery_name = None
# check if "BAT0" exists. if not, check for "CMB0"
# if neither exist, just have battery_name = none
if os.path.exists("/sys/class/power_supply/BAT0"):
    battery_name = "BAT0"
elif os.path.exists("/sys/class/power_supply/CMB0"):
    battery_name = "CMB0"

# RAPL energy counters (microjoules). Paths may vary slightly by platform.
cpu_energy_path = None
if os.path.exists("/sys/class/powercap/intel-rapl:0/energy_uj"):
    cpu_energy_path = "/sys/class/powercap/intel-rapl:0/energy_uj"

gpu_energy_path = None
if os.path.exists("/sys/class/powercap/intel-rapl:0:1/energy_uj"):
    gpu_energy_path = "/sys/class/powercap/intel-rapl:0:1/energy_uj"

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

def cap_data():
    import os
    try:
        os.makedirs(DATA_DIR, exist_ok=True)

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

        if battery_name is None:
            print("No battery found, skipping data capture")
            return
        power = read_battery_power()
        charge, full, full_design = read_battery_charge()
        timestamp = int(time.time())
        date = time.strftime("%Y-%m-%d", time.localtime(timestamp))
        # Log power
        with open(f"{DATA_DIR}/battery_power_{date}.csv", "a") as f:
            f.write(f"{timestamp},{power}\n")
        # Log charge
        with open(f"{DATA_DIR}/battery_charge_{date}.csv", "a") as f:
            f.write(f"{timestamp},{charge},{full},{full_design}\n")
        # Log CPU power if available
        if cpu_power is not None:
            with open(f"{DATA_DIR}/cpu_power_{date}.csv", "a") as f:
                f.write(f"{timestamp},{cpu_power}\n")
        # Log GPU power if available
        if gpu_power is not None:
            with open(f"{DATA_DIR}/gpu_power_{date}.csv", "a") as f:
                f.write(f"{timestamp},{gpu_power}\n")
        # Update the past 24 hours file for power
        df_power = pd.read_csv(f"{DATA_DIR}/battery_power_{date}.csv", header=None, names=["timestamp", "power"])
        df_power = df_power[df_power["timestamp"] >= timestamp - 24*60*60]
        df_power.to_csv(f"{DATA_DIR}/battery_power_past_24_hours.csv", index=False)
        # Update the past 24 hours file for charge
        df_charge = pd.read_csv(f"{DATA_DIR}/battery_charge_{date}.csv", header=None, names=["timestamp", "charge", "full", "full_design"])
        df_charge = df_charge[df_charge["timestamp"] >= timestamp - 24*60*60]
        df_charge.to_csv(f"{DATA_DIR}/battery_charge_past_24_hours.csv", index=False)
        # Update the past 24 hours file for CPU power if we logged it
        if os.path.exists(f"{DATA_DIR}/cpu_power_{date}.csv"):
            df_cpu = pd.read_csv(f"{DATA_DIR}/cpu_power_{date}.csv", header=None, names=["timestamp", "power"])
            df_cpu = df_cpu[df_cpu["timestamp"] >= timestamp - 24*60*60]
            df_cpu.to_csv(f"{DATA_DIR}/cpu_power_past_24_hours.csv", index=False)
        # Update the past 24 hours file for GPU power if we logged it
        if os.path.exists(f"{DATA_DIR}/gpu_power_{date}.csv"):
            df_gpu = pd.read_csv(f"{DATA_DIR}/gpu_power_{date}.csv", header=None, names=["timestamp", "power"])
            df_gpu = df_gpu[df_gpu["timestamp"] >= timestamp - 24*60*60]
            df_gpu.to_csv(f"{DATA_DIR}/gpu_power_past_24_hours.csv", index=False)
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
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/past24")
def api_past24():
    try:
        df = pd.read_csv(f"{DATA_DIR}/battery_power_past_24_hours.csv")
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
        df = pd.read_csv(f"{DATA_DIR}/battery_charge_past_24_hours.csv")
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
        df = pd.read_csv(f"{DATA_DIR}/cpu_power_past_24_hours.csv")
        return jsonify({
            "timestamps": df["timestamp"].tolist(),
            "powers": df["power"].tolist(),
        })
    except Exception:
        return jsonify({"timestamps": [], "powers": []})


@app.route("/api/gpu24")
def api_gpu24():
    try:
        df = pd.read_csv(f"{DATA_DIR}/gpu_power_past_24_hours.csv")
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
        time.sleep(5)

if __name__ == "__main__":
    main()