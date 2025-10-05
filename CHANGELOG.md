# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-10-05

### Added
- **Temperature Unit Configuration** - Users can now choose between Fahrenheit (°F) and Celsius (°C)
  - New `TEMPERATURE_UNIT` setting in `.fireplace-config`
  - Supports both `F` (Fahrenheit) and `C` (Celsius)
  - Automatic conversion between units
  - Safe validation in both temperature scales
  - Updated documentation with temperature guides for both units

- **New Configuration Reader** - `src/utils/configReader.ts`
  - Reads `.fireplace-config` file
  - Searches in current and parent directories
  - Parses temperature unit preference

- **Documentation**
  - `TEMPERATURE_UNITS.md` - Comprehensive guide to temperature unit feature
  - `SWITCHING_UNITS.md` - Quick reference for switching between F and C
  - `IMPLEMENTATION_SUMMARY.md` - Technical details of implementation
  - `.fireplace-config.celsius-example` - Example configuration for Celsius users

### Changed
- Updated `README.md` with temperature unit configuration instructions
- Updated `INSTALL.md` to mention temperature unit option
- Enhanced wrapper script `fp` to display active temperature unit
- CLI help text now shows temperature unit configuration option
- Version bumped to 1.1.0

### Technical Details
- Temperature conversion uses standard formulas with full precision
- Internal operations remain in Celsius (fireplace's native format)
- Display formatting adjusts based on user preference
- Backward compatible - defaults to Fahrenheit if not specified

## [1.0.0] - 2025-10-05

### Initial Release
- Command-line interface for Valor Fireplaces (powered by Mertik)
- Support for Valor models: L1, L1 See Thru, L2, L3, LT1, LT2, LX1, LX2, H5, H6, P2
- Requires GV60WiFi module
- Commands: on, off, status, temp, mode
- Operation modes: temperature, manual, eco, off
- Fahrenheit temperature support (41-97°F)
- Direct TCP/IP control
- Standalone binary with zero dependencies
- Apache-2.0 License
- Built upon homebridge-mertik-fireplace by tritter

---

## Version History Summary

- **v1.1.0** - Added Celsius/Fahrenheit configuration option
- **v1.0.0** - Initial standalone CLI release
