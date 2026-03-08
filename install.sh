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

# grep -R "power_now" /sys/class/power_supply/f > /dev/null 2>&1

# check for python venv
python3 -m venv .venv
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
User=root
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
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/.venv/bin/python3 app/main.py
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"


# Copy app to /opt
sudo mkdir -p "$INSTALL_DIR"
sudo rsync -a --exclude='data' --exclude='*.pyc' --exclude='__pycache__' ./ "$INSTALL_DIR/"

# Copy systemd service file
echo "$SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$SERVICE_FILE_NAME" > /dev/null
echo "$BACKEND_SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$BACKEND_SERVICE_FILE_NAME" > /dev/null

# Set permissions
sudo chown -R $USER:$USER "$INSTALL_DIR"

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_FILE_NAME"
sudo systemctl enable --now "$BACKEND_SERVICE_FILE_NAME"

echo "Batttracker installed and service started."
