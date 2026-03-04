#!/bin/bash
set -e

# assert that rsync, systemctl, and python3 are installed
if ! command -v rsync &> /dev/null; then
    echo "rsync is required but not installed. Please install rsync and try again."
    exit 1
fi
if ! command -v systemctl &> /dev/null; then
    echo "systemctl is required but not installed. Please install systemd and try again."
    exit 1
fi
if ! command -v python3 &> /dev/null; then
    echo "python3 is required but not installed. Please install python3 and try again."
    exit 1
fi
if ! command -v grep &> /dev/null; then
    echo "grep is required but not installed. Please install grep and try again."
    exit 1
fi

# grep -R "power_now" /sys/class/power_supply/ > /dev/null 2>&1

# check for python venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

APP_NAME="batttracker"
INSTALL_DIR="/opt/$APP_NAME"
SYSTEMD_DIR="/etc/systemd/system"
USER=$(whoami)

SERVICE_FILE_NAME="batttracker.service"
SERVICE_FILE="
[Unit]
Description=Batttracker Flask App
After=network.target

[Service]
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/.venv/bin/gunicorn -w 2 -b 0.0.0.0:8678 app.main:app
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"

BACKEND_SERVICE_FILE_NAME="batttracker-backend.service"
BACKEND_SERVICE_FILE="
[Unit]
Description=Batttracker Backend
After=network.target

[Service]
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/.venv/bin/python3 app/main.py
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"


CPU_RAPL_PATH="/sys/class/powercap/intel-rapl:0/energy_uj"
GPU_RAPL_PATH="/sys/class/powercap/intel-rapl:0:1/energy_uj"
POWER_GROUP="power"


# Copy app to /opt
sudo mkdir -p "$INSTALL_DIR"
sudo rsync -a --exclude='data' --exclude='*.pyc' --exclude='__pycache__' ./ "$INSTALL_DIR/"

# Copy systemd service file
echo "$SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$SERVICE_FILE_NAME" > /dev/null
echo "$BACKEND_SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$BACKEND_SERVICE_FILE_NAME" > /dev/null

# Set permissions
sudo chown -R $USER:$USER "$INSTALL_DIR"

# Ensure a group exists for accessing RAPL energy counters and add current user
if ! getent group "$POWER_GROUP" > /dev/null 2>&1; then
    echo "Creating group '$POWER_GROUP' for power telemetry access (sudo)."
    sudo groupadd "$POWER_GROUP"
fi

echo "Adding user $USER to group '$POWER_GROUP' (sudo)."
sudo usermod -aG "$POWER_GROUP" "$USER"

# Relax permissions on CPU/GPU RAPL energy files for the power group, if present
if [ -f "$CPU_RAPL_PATH" ]; then
    echo "Granting group '$POWER_GROUP' read access to $CPU_RAPL_PATH (sudo)."
    sudo chgrp "$POWER_GROUP" "$CPU_RAPL_PATH" || true
    sudo chmod g+r "$CPU_RAPL_PATH" || true
fi

if [ -f "$GPU_RAPL_PATH" ]; then
    echo "Granting group '$POWER_GROUP' read access to $GPU_RAPL_PATH (sudo)."
    sudo chgrp "$POWER_GROUP" "$GPU_RAPL_PATH" || true
    sudo chmod g+r "$GPU_RAPL_PATH" || true
fi

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_FILE_NAME"
sudo systemctl enable --now "$BACKEND_SERVICE_FILE_NAME"

echo "Batttracker installed and service started."
echo "If this is your first time installing, you may need to log out and back in for the new '$POWER_GROUP' group membership to take effect."
