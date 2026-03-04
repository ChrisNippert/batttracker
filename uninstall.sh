#!/bin/bash
set -e

APP_NAME="batttracker-flask-app"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_FILE="batttracker.service"
BACKEND_SERVICE_FILE="batttracker-backend.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "Stopping and disabling services..."
sudo systemctl disable --now "$SERVICE_FILE" || true
sudo systemctl disable --now "$BACKEND_SERVICE_FILE" || true

echo "Removing systemd service files..."
sudo rm -f "$SYSTEMD_DIR/$SERVICE_FILE"
sudo rm -f "$SYSTEMD_DIR/$BACKEND_SERVICE_FILE"

echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "Removing application files..."
sudo rm -rf "$INSTALL_DIR"

echo "Batttracker uninstalled."
