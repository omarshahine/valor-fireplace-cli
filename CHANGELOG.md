# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-10-05

### Initial Release
- Command-line interface for Valor Fireplaces (powered by Mertik)
- Support for Valor models: L1, L1 See Thru, L2, L3, LT1, LT2, LX1, LX2, H5, H6, P2
- Requires GV60WiFi WiFi module for network connectivity
- Commands: on, off, status, temp, mode
- Operation modes: temperature, manual, eco, off
- Temperature unit configuration (Fahrenheit or Celsius)
  - Choose F or C in `.fireplace-config`
  - Defaults to Fahrenheit
  - Automatic conversion between units
- Direct TCP/IP control via port 2000
- Standalone binary with zero external dependencies
- Apache-2.0 License
- Built upon homebridge-mertik-fireplace by tritter
- TypeScript codebase
- Wrapper script `fp` for quick access
- Comprehensive documentation
