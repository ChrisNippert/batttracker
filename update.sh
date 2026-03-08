#!/bin/bash
set -e

APP_NAME="batttracker"
INSTALL_DIR="/opt/$APP_NAME"
SYSTEMD_DIR="/etc/systemd/system"
USER=$(whoami)

SERVICE_FILE_NAME="batttracker.service"
BACKEND_SERVICE_FILE_NAME="batttracker-backend.service"

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

# Stop services during update so files aren't changing underneath us
sudo systemctl stop "$SERVICE_FILE_NAME" "$BACKEND_SERVICE_FILE_NAME" 2>/dev/null || true


# Copy app to /opt, but keep existing data and virtualenv in place
sudo mkdir -p "$INSTALL_DIR"
sudo rsync -a \
    --exclude='data' \
    --exclude='.venv' \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    ./ "$INSTALL_DIR/"

# Set permissions
sudo chown -R $USER:$USER "$INSTALL_DIR"

# Rewrite service files on update so behavior stays consistent across upgrades.
echo "$SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$SERVICE_FILE_NAME" > /dev/null
echo "$BACKEND_SERVICE_FILE" | sudo tee "$SYSTEMD_DIR/$BACKEND_SERVICE_FILE_NAME" > /dev/null

# Reload systemd and (re)start services
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_FILE_NAME"
sudo systemctl restart "$BACKEND_SERVICE_FILE_NAME"

echo "Batttracker updated and services restarted."
