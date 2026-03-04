#!/bin/bash
set -e

APP_NAME="batttracker"
INSTALL_DIR="/opt/$APP_NAME"
SYSTEMD_DIR="/etc/systemd/system"
USER=$(whoami)

SERVICE_FILE_NAME="batttracker.service"
BACKEND_SERVICE_FILE_NAME="batttracker-backend.service"

CPU_RAPL_PATH="/sys/class/powercap/intel-rapl:0/energy_uj"
GPU_RAPL_PATH="/sys/class/powercap/intel-rapl:0:1/energy_uj"
POWER_GROUP="power"

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

# Reload systemd and (re)start services
sudo systemctl restart "$SERVICE_FILE_NAME"
sudo systemctl restart "$BACKEND_SERVICE_FILE_NAME"

echo "Batttracker updated and services restarted."
echo "If this is your first time installing, you may need to log out and back in for the new '$POWER_GROUP' group membership to take effect."
