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
if ! command -v python &> /dev/null; then
    echo "python is required but not installed. Please install python and try again."
    exit 1
fi

# check for python venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

APP_NAME="batttracker"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_FILE="batttracker.service"
BACKEND_SERVICE_FILE="batttracker-backend.service"
SYSTEMD_DIR="/etc/systemd/system"
USER=$(whoami)

# Copy app to /opt
sudo mkdir -p "$INSTALL_DIR"
sudo rsync -a --exclude='data' --exclude='*.pyc' --exclude='__pycache__' ./ "$INSTALL_DIR/"

# Copy systemd service file
sudo cp "$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_FILE"
sudo cp "$BACKEND_SERVICE_FILE" "$SYSTEMD_DIR/$BACKEND_SERVICE_FILE"

# Set permissions
sudo chown -R $USER:$USER "$INSTALL_DIR"

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_FILE"
sudo systemctl enable --now "$BACKEND_SERVICE_FILE"

echo "Batttracker installed and service started."
