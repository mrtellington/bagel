#!/bin/bash
# One-time setup for GCP Compute Engine VM
set -euo pipefail

echo "=== Bagel Agent VM Setup ==="

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Claude Code CLI (for Granola bridge)
npm install -g @anthropic-ai/claude-code

# Create app directory
sudo mkdir -p /opt/bagel
sudo chown $USER:$USER /opt/bagel

# Create log directory
mkdir -p ~/.bagel

# Install systemd service
sudo cp /opt/bagel/infra/bagel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bagel

echo "=== Setup complete ==="
echo "Next steps:"
echo "1. Authenticate Claude CLI: claude login"
echo "2. Set secrets in Secret Manager"
echo "3. Deploy code to /opt/bagel"
echo "4. Run: sudo systemctl start bagel"
echo "5. Install bridge cron: /opt/bagel/bridge/install-bridge-cron.sh"
