#!/bin/bash

# Quick wrapper script for fireplace-cli
# Automatically loads the IP from .fireplace-config

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Load the IP from config file
if [ -f "$SCRIPT_DIR/.fireplace-config" ]; then
    source "$SCRIPT_DIR/.fireplace-config"
fi

# If FIREPLACE_IP is not set, use the default
if [ -z "$FIREPLACE_IP" ]; then
    export FIREPLACE_IP=192.168.1.141
fi

# If TEMPERATURE_UNIT is not set, use the default
if [ -z "$TEMPERATURE_UNIT" ]; then
    export TEMPERATURE_UNIT=F
fi

# Show what we're using
echo "🔥 Using fireplace at: $FIREPLACE_IP"
echo "🌡️  Temperature unit: $TEMPERATURE_UNIT"
echo ""

# Run the fireplace-cli command using local dist version
node "$SCRIPT_DIR/dist/cli.js" "$@"
