#!/bin/bash
# Installs the Granola bridge cron job
# Runs every 5 min, Monday-Friday, 9 AM - 6 PM ET

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_SCRIPT="$SCRIPT_DIR/granola-sync.sh"

chmod +x "$BRIDGE_SCRIPT"

# Create crontab entry (every 5 min, M-F, 9-17 hours ET)
# Note: cron uses the system timezone, ensure TZ=America/New_York
CRON_ENTRY="*/5 9-17 * * 1-5 TZ=America/New_York $BRIDGE_SCRIPT"

# Add to crontab if not already present
(crontab -l 2>/dev/null | grep -v "granola-sync" ; echo "$CRON_ENTRY") | crontab -

echo "Granola bridge cron installed:"
echo "  $CRON_ENTRY"
echo ""
echo "View logs: tail -f ~/.bagel/bridge.log"
