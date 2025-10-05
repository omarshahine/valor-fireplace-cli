# 🔥 Valor Fireplace CLI

[![Node.js](https://img.shields.io/badge/node-%3E%3D14.18.1-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-4.4.4-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A command-line tool to control your Valor Fireplace (powered by Mertik) directly from your terminal.

## Features

- ✅ **Fahrenheit or Celsius** - Choose your preferred temperature unit
- ✅ **Easy commands** (on, off, status, temp, mode)
- ✅ **Direct fireplace control** via TCP/IP
- ✅ **No dependencies** on Homebridge
- ✅ **Standalone binary**

## Hardware Requirements

To use this CLI tool (or the official Valor mobile app), your Valor Fireplace must have the **Valor WiFi Upgrade Kit** installed:

- **Required Hardware:** Valor WiFi Upgrade for V-module Kit - **GV60WiFi**
- **Compatible Models:** Valor L1, L1 See Thru, L2, L3, LT1, LT2, LX1, LX2, H5, H6, and P2 Heaters
- **Official Mobile App:** [Valor 1.0 Remote App](https://www.valorfireplaces.com/features/valor10-remote-app.php)
- **Installation Guide:** [GV60WIFI Upgrade Instructions (PDF)](https://www.valorfireplaces.com/media/Remote/GV60WIFI-Upgrade-Instructions.pdf)

This WiFi module enables TCP/IP control over your local network, which is what this CLI tool uses to communicate with your fireplace. Once the GV60WiFi module is installed and connected to your network, you can use either the official Valor mobile app or this command-line tool.

## Quick Start

### 1. Clone and Install
```bash
git clone https://github.com/omarshahine/valor-fireplace-cli.git
cd valor-fireplace-cli
npm install
```

### 2. Configure Your Fireplace
```bash
# Copy the example configuration
cp .fireplace-config.example .fireplace-config

# Edit with your fireplace's IP address
nano .fireplace-config
```

Set your fireplace's IP address in `.fireplace-config`:
```bash
FIREPLACE_IP=192.168.1.XXX  # Replace with your fireplace's IP
TEMPERATURE_UNIT=F          # F for Fahrenheit, C for Celsius
```

### 3. Build
```bash
npm run build
```

### 4. Use It!
```bash
# Using the wrapper script (easiest)
./fp status
./fp temp 72
./fp on
./fp off

# Or use the CLI directly
fireplace-cli status
fireplace-cli temp 72
```

### 5. Install Globally (Optional)
```bash
npm link
fireplace-cli status  # Use from anywhere
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `status` | Get fireplace status | `fireplace-cli status` |
| `on` | Turn on (starts at 68°F/20°C) | `fireplace-cli on` |
| `off` | Turn off safely | `fireplace-cli off` |
| `temp <value>` | Set temperature | `fireplace-cli temp 72` |
| `mode <mode>` | Set mode | `fireplace-cli mode eco` |

### Available Modes
- `temperature` - Temperature control mode
- `manual` - Manual flame height control
- `eco` - Energy saving mode
- `off` - Turn off

## Configuration

### Method 1: Config File (Recommended)
Create or edit `.fireplace-config`:
```bash
# Fireplace IP address
FIREPLACE_IP=192.168.1.141

# Temperature Unit: F (Fahrenheit) or C (Celsius)
# Default: F
TEMPERATURE_UNIT=F
```

**Temperature Unit Options:**
- `TEMPERATURE_UNIT=F` - Display and input temperatures in Fahrenheit (41-97°F)
- `TEMPERATURE_UNIT=C` - Display and input temperatures in Celsius (5-36°C)

### Method 2: Environment Variable
```bash
export FIREPLACE_IP=192.168.1.141
```

Add to your `~/.zshrc` for persistence:
```bash
echo 'export FIREPLACE_IP=192.168.1.141' >> ~/.zshrc
source ~/.zshrc
```

### Method 3: Command Argument
```bash
fireplace-cli status 192.168.1.141
```

## Temperature Guide

### Fahrenheit (Default)
**Comfortable Settings:**
- 68°F - Cool comfort
- 72°F - Standard warmth  
- 75°F - Warm
- 77°F - Extra warm

**Valid Range:** 41°F to 97°F

### Celsius
**Comfortable Settings:**
- 20°C - Cool comfort
- 22°C - Standard warmth
- 24°C - Warm
- 25°C - Extra warm

**Valid Range:** 5°C to 36°C

> **Note:** The fireplace uses Celsius internally. When using Fahrenheit, temperatures are automatically converted. All calculations remain accurate regardless of your display preference.
>
> 📖 **For more details about temperature units, see [TEMPERATURE_UNITS.md](TEMPERATURE_UNITS.md)**

## Examples

### Basic Usage
```bash
# Check status
fireplace-cli status

# Turn on and set temperature
fireplace-cli on
fireplace-cli temp 72

# Change mode
fireplace-cli mode eco

# Turn off
fireplace-cli off
```

### With Wrapper Script
```bash
./fp status
./fp temp 72
./fp mode temperature
```

### Status Output
```
Fireplace Status:
──────────────────────────────────────
Mode:               Temperature
Current Temp:       68°F
Target Temp:        72°F
Guard Flame:        On
Igniting:           No
Shutting Down:      No
Aux On:             No
Reachable:          Yes
──────────────────────────────────────
```

## Project Structure

```
valor-fireplace-cli/
├── src/                    # TypeScript source code
│   ├── cli.ts             # Main CLI interface
│   ├── controllers/       # Fireplace control logic
│   ├── models/            # Data models and status parsing
│   └── utils/             # Temperature conversion, config reader
├── dist/                  # Compiled JavaScript
├── fp                     # Quick wrapper script ⭐
├── .fireplace-config      # Configuration file
├── package.json           # NPM configuration
├── tsconfig.json          # TypeScript config
├── README.md              # Documentation
└── LICENSE                # Apache 2.0

```

## Development

### Build
```bash
npm run build
```

### Clean Build
```bash
npm run clean && npm run build
```

### Install Globally
```bash
npm link
fireplace-cli status
```

## Distribution

This project is **standalone** and can be:

1. **Cloned and used locally:**
   ```bash
   git clone https://github.com/yourusername/valor-fireplace-cli.git
   cd valor-fireplace-cli
   npm install
   npm run build
   ./fp status
   ```

2. **Installed globally:**
   ```bash
   npm install -g valor-fireplace-cli
   fireplace-cli status
   ```

3. **Shared as source:**
   - Zip the folder
   - Recipients need Node.js >= 14.18.1
   - Run `npm install && npm run build`

## Technical Details

- **Protocol:** TCP socket connection on port 2000
- **Hardware:** Valor WiFi Module (GV60WiFi) using Mertik protocol
- **Temperature Range:** 41-97°F (5-36°C internally)
- **Connection Timeout:** 5 minutes
- **Status Refresh:** 15 seconds
- **Ignition Time:** 30-40 seconds
- **Shutdown Time:** 30 seconds

## Advanced Features

### Temperature Unit Configuration
See [TEMPERATURE_UNITS.md](TEMPERATURE_UNITS.md) for detailed information about using Celsius or Fahrenheit.

### Customization
- Modify source code in `src/` directory
- Rebuild with `npm run build`
- Temperature ranges can be adjusted in `src/utils/temperatureConverter.ts`

## Troubleshooting

### Can't Connect
- Check fireplace is powered on
- Verify IP address is correct
- Ensure on same network
- Try: `ping 192.168.1.141`

### Command Not Found
```bash
npm run build
npm link
```

### Invalid Temperature
- **Fahrenheit:** Valid range is 41-97°F
- **Celsius:** Valid range is 5-36°C
- Check your `TEMPERATURE_UNIT` setting in `.fireplace-config`

### Need to Rebuild?
```bash
npm run clean
npm install
npm run build
```

## System Requirements

- Node.js >= 14.18.1
- TypeScript >= 4.4.4
- macOS, Linux, or Windows with WSL

## Credits

This project is built upon the excellent work from:
- **[homebridge-mertik-fireplace](https://github.com/tritter/homebridge-mertik-fireplace)** by [tritter](https://github.com/tritter)

## License

Apache-2.0

## Author

Omar Shahine

---

**Your fireplace, your command line. 🔥**
