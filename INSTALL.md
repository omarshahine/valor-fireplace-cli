# Fireplace CLI - Standalone Installation

## For Valor Fireplaces (Mertik-Compatible)

## Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure your fireplace:**
   ```bash
   # Copy the example config
   cp .fireplace-config.example .fireplace-config
   
   # Edit with your fireplace's IP address
   nano .fireplace-config
   # or
   vim .fireplace-config
   ```
   
   Set your fireplace's IP address and optionally change temperature unit:
   - `FIREPLACE_IP=192.168.1.XXX` (replace with your IP)
   - `TEMPERATURE_UNIT=F` (or `C` for Celsius)

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Install globally (optional):**
   ```bash
   npm link
   ```

5. **Make wrapper script executable:**
   ```bash
   chmod +x fp
   ```

## Usage

### Option 1: Use the quick wrapper
```bash
./fp status
./fp temp 72
./fp on
./fp off
```

### Option 2: Use valor-cli directly
```bash
valor-cli status
valor-cli temp 72
```

### Option 3: Run from dist folder
```bash
node dist/cli.js status
node dist/cli.js temp 72
```

## First Test

After setup, test your connection:
```bash
./fp status
```

You should see output like:
```
🔥 Using fireplace at: 192.168.1.141

Fireplace Status:
──────────────────────────────────────
Mode:               Temperature
Current Temp:       68°F
Target Temp:        72°F
Guard Flame:        On
...
```

## Need Help?

See `README.md` for complete documentation.

Run `./temp-guide.sh` for temperature reference.
