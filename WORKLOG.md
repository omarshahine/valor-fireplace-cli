# Worklog

## 2026-04-27

Kicked off a real investigation around a real failure pattern: the Valor
WiFi module (B6R-WME / GV60WiFi) periodically enters a state where the
WiFi LED goes red while the local LED stays green. In that state neither
the handheld remote nor the Valor app reaches the fireplace. Power-cycling
the wall wart does not clear it. Only the recessed paperclip reset does.
That combination points at corrupted state persisted to the module's
flash that survives a cold boot — a firmware bug, not a hardware failure.

Two possible architectural responses:

1. Local TCP control via this CLI bypasses the cloud bridge entirely.
   The homebridge plugin already uses this path. If the local TCP
   listener stays up during the stuck state, daily fireplace use is
   unaffected and we just have an annoying "the app is down" cosmetic.
2. An ESP32 wired to the reset pin internally would automate the
   paperclip reset and give us full self-healing.

Which response is correct depends on whether local TCP works during
the stuck state. That's an empirical question, and now we have the
tool to answer it.

Built diagnostic tooling to make that determination:

- `probe`: opens TCP, sends a status request, measures RTT, exits 0 if
  reachable. Single purpose: run this when the LEDs go red+green.
  If it succeeds the ESP32 path is nice-to-have, not required.
- `raw <hex>`: sends arbitrary bytes (with optional bridge-prefix
  framing) and dumps the response. For systematic exploration of
  unmapped Mertik GV60 opcodes, especially looking for a soft-reset.
- `watch`: long-running status tail with timestamps for behavior
  observation.
- `PROTOCOL.md`: canonical reference for the wire protocol. Framing,
  every known opcode, the status packet field map, and the open
  questions list.

Decision: kept `ProtocolExplorer` separate from `FireplaceCliController`.
The controller is for "use the fireplace normally" and carries ignition
state and retry logic. The explorer is for "what is the module doing
right now" and stays at the byte level. Mixing them would muddy both.

Decision: deferred the `discover` (LAN subnet scanner) command. Lower
diagnostic value because the user typically already knows the fireplace
IP. Trivial to add later if useful.

Verified locally that probe correctly distinguishes timeout (host not
routable) from connection-refused (immediate clean error). Couldn't
test against live hardware because the development machine is on a
different subnet from the fireplace. Live testing deferred until next
on-site visit.

Open:

- Run `valor-cli probe` the next time the LEDs go red+green. This is
  the keystone experiment that determines whether the ESP32 hardware
  mod is necessary or just a nice-to-have.
- Try `valor-cli raw` with unmapped Mertik opcode ranges (`5x`, `6x`,
  `7x` are typically Mertik diagnostic territory) to hunt for a
  soft-reset command. If one exists, the ESP32 becomes unnecessary.
- Decode the 12 unmapped status bits by toggling the fireplace through
  every state and diffing raw status packets.
- If probe fails in the stuck state and no soft-reset opcode exists,
  build the ESP32 reset trigger circuit. Roughly $5 in parts, an NPN
  or MOSFET on a GPIO pin, expose to HomeKit via HomeSpan.
- Consider extracting a shared `valor-fireplace-protocol` package that
  both this CLI and `homebridge-valor-fireplace` can import, instead
  of carrying parallel copies of the protocol code in two repos.
