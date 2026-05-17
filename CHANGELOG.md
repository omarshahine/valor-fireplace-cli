# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-05-17

### Added
- **Diagnostic commands** for protocol exploration and operational triage:
  - `probe` — TCP liveness check with RTT, distinguishes connection refused from timeout. Designed for diagnosing the B6R-WME's "stuck state" (red WiFi LED + green local LED).
  - `raw <hex>` — send arbitrary framed bytes for protocol exploration.
  - `watch` — tail status updates with timestamps until Ctrl+C.
- **Mertik GV60 ignition-lockout heuristic.** `status` now flags the bit pattern (`igniting=1, guardFlame=0, shuttingDown=0`) that indicates the receiver tripped its safety lockout after a failed ignition. Warning text acknowledges that a single snapshot cannot distinguish stuck lockout from active in-progress ignition (the same bits persist for ~20-40s during normal cold-starts); users are pointed at re-running `status` after 60s.
- **Six newly-decoded status packet fields** surfaced on `FireplaceStatus` and rendered in the `status` command output:
  - `burnerOutput` (chars 14-15) — current main-burner output 0-255, continuous (modulates in temperature mode).
  - `lightBrightness` (chars 20-21) — decorative light dimmer setpoint 0-255 (persists across light on/off).
  - `fanSpeed` (chars 22-23) — circulating fan speed 0-4.
  - `scheduleActive` (status bit 9) — schedule/timer overlay flag.
  - `lightOn` (status bit 13) — decorative light power.
  - `statusBitsHex` — raw 4-char hex of the status bit field for diagnostics.
- **Derived signals** on `FireplaceStatus`:
  - `lockoutSuspected` — heuristic candidate for hard lockout.
  - `pilotOnly` — `guardFlameOn && burnerOutput === 0`.
- **`$HOME/.fireplace-config` fallback** in `ConfigReader.findConfigFile()`. Previously the reader only walked from CWD to `/`, which broke system-wide installs (e.g. on a Raspberry Pi) when invoked from arbitrary directories. Now falls back to `$HOME/.fireplace-config` after the CWD walk.

### Changed
- **`on` and `off` are now status-driven instead of fixed-delay.** Previously `igniteFireplace()` and `guardFlameOff()` blocked on `await this.delay(40_000)` / `delay(30_000)`. Both now poll status every 2-3s, print a `[Ns] waiting for ...` tick line, and return as soon as the `guardFlameOn` transition lands (with a 90s / 30s ceiling). Shutdown empirically takes 3-5s so the old wait was pessimistic; ignition is variable but the new model returns immediately on success and gives slow ignitions room. When the ceiling is hit, the CLI now prints a clear "⚠ did not complete" message instead of falsely claiming success.
- **`status` zeroes burner output when the pilot is off.** The firmware doesn't clear chars 14-15 on shutdown so they linger at the last in-flight value (e.g. `0xE7` for Step9). The displayed percent is now gated on `guardFlameOn`; raw byte is still available via `status.burnerOutput` for diagnostics.
- **Status response wait is now event-driven.** New `waitForNextStatus()` helper listens for the next `status` event with the full `STATUS_RESPONSE_TIMEOUT`, replacing a hard-coded 500ms wait that risked reading stale `lastStatus`.

### Documentation
- **PROTOCOL.md** rewritten with full char-by-char status packet layout, empirically-confirmed end-byte map (`01`/`02`/`04`/`08`), and an Empirical Findings section recording the 2026-05-16 cabin debug session that decoded the new fields. Open Questions list now distinguishes truly unknown bits from observed-but-unmapped behaviors (handheld vs CLI eco divergence, etc).
- **README** documents the new diagnostic commands and the expanded `status` output format.

## [1.0.1] - 2026-04-26

### Fixed
- Status-frame parsing now correctly handles split TCP reads (status response can arrive across multiple `data` events).
- Race condition on cold sockets where the first command after connection could be sent before the socket was fully writable.

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
