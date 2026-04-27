# Valor B6R-WME / Mertik GV60 Protocol

This document captures everything currently known about the protocol spoken by
the Valor `GV60WiFi` upgrade module (sometimes called the **B6R-WME** controller).
Most of the wire-level details were reverse-engineered from the
[homebridge-mertik-fireplace](https://github.com/tritter/homebridge-mertik-fireplace)
project and validated against the live module via this CLI.

The module is a TCP-to-serial bridge for the underlying Mertik Maxitrol GV60
gas valve. Many of the command codes match the Mertik GV60 serial protocol
1:1, with an extra envelope added by the WiFi bridge.

## Transport

| | |
|---|---|
| Transport | TCP, IPv4 |
| Port | `2000` |
| Direction | Client opens, sends commands, reads responses |
| Sessions | Long-lived; the module pushes status updates on the same socket |

There is **no authentication**. Anyone on the LAN with the module's IP can
send commands.

## Framing

Every command and every response is wrapped between two control bytes:

```
0x02  payload bytes  0x03
 STX                  ETX
```

Payload bytes are ASCII-printable (typically hex digits and uppercase letters,
e.g. `030303080A1`).

The CLI's framing layer scans for `STX`, then for the next `ETX`, and treats
the bytes between them as a single message. Multiple messages can be returned
in a single TCP read, and a single message can be split across TCP reads.

## The Bridge Prefix

Every outbound command observed in this client begins with the same envelope:

```
STX  '0' '3' '0' '3' '0' '3' '0' '8' '0'  <command bytes>  ETX
0x02  30  33  30  33  30  33  30  38  30                    0x03
```

In hex, the prefix is `0233303330333033303830`. The 9 ASCII bytes after STX
(`030303080`) appear to be a fixed bridge address or session header. We do
not yet know whether this varies in any deployment; in this codebase it has
always been constant.

## Known Commands (Outbound)

All command bytes below are the **payload** that goes between the bridge
prefix and the trailing ETX. Unless noted, the command terminates with `0x03`
embedded as the final byte of the payload (matching the Mertik GV60 serial
convention).

| Operation | Hex (payload) | ASCII | Notes |
|---|---|---|---|
| Status request | `303303` | `03␃` | Module replies with a 106-char STX/ETX-framed status packet |
| Ignite | `314103` | `1A␃` | Begin ignition sequence; ~40s before guard flame is reliable |
| Guard flame off | `313003` | `10␃` | Shutdown; ~30s before fully off |
| Standby (target=0) | `3136303003` | `1600␃` | Sets flame height to step-0 |
| Set flame height N | `3136<N>03` | `16<N>␃` | `<N>` is the 4-char ASCII pair from the FlameHeight enum below |
| Mode: manual | `423003` | `B0␃` | |
| Mode: temperature | `4232303103` | `B201␃` | |
| Mode: eco | `4233303103` | `B301␃` | |
| Set target temp | `42324644303<V>03` | `B2FD0<V>␃` | `<V>` is encoded by `TemperatureRangeUtils.toBits()`; see below |
| Aux on | `32303031030a` | `2001␃\n` | Trailing LF (`0x0a`) is unusual; reason unknown |
| Aux off | `32303030030a` | `2000␃\n` | Same trailing LF |

### FlameHeight encoding

```
Step0  = '3830'   (ASCII "80")
Step1  = '3842'   (ASCII "8B")
Step2  = '3937'   (ASCII "97")
Step3  = '4132'   (ASCII "A2")
Step4  = '4145'   (ASCII "AE")
Step5  = '4239'   (ASCII "B9")
Step6  = '4335'   (ASCII "C5")
Step7  = '4430'   (ASCII "D0")
Step8  = '4443'   (ASCII "DC")
Step9  = '4537'   (ASCII "E7")
Step10 = '4633'   (ASCII "F3")
Step11 = '4646'   (ASCII "FF")
```

These are not linear; they look like calibrated 8-bit values
(`0x80` → `0xFF`) sent as ASCII pairs. Step11 is full output (255).

### Temperature encoding

`TemperatureRangeUtils.toBits(value: number): string` converts a Celsius
target into a 5-char ASCII string. The full encoding is in
`src/models/temperatureRange.ts`. The shape:

- Temperature is multiplied by 10 (so 21.5°C → 215)
- Decomposed into a "degrees" field (high byte) and "decimals" field (low nibble)
- A magic offset is added based on which 16-step band the value falls into
- Result is prepended with `0` or `1` as a region selector

Range supported by the encoder: roughly 5°C to 36°C (41°F to 97°F).

## Status Packet (Inbound)

When the module receives a status request, it replies with a 106-char ASCII
payload (between STX/ETX).

The fields the CLI parses today:

| Field | Source | Meaning |
|---|---|---|
| `mode` | char 24 + last 2 chars | Off / Manual / Temperature / Eco |
| `currentTemperature` | chars 28-32 | Hex, divided by 10 → Celsius |
| `targetTemperature` | chars 32-36 | Hex, divided by 10 → Celsius |
| `guardFlameOn` | bit 8 of chars 16-20 | Pilot lit |
| `igniting` | bit 11 of chars 16-20 | Mid-ignition |
| `shuttingDown` | bit 7 of chars 16-20 | Mid-shutdown |
| `auxOn` | bit 12 of chars 16-20 | Aux fan running |

Many bytes of the 106-char payload are not yet decoded. Worth investigating:

- Diagnostic bits (error codes, lockout state, low battery)
- Pilot millivolt reading from the thermopile
- Module firmware version
- Schedule / timer state
- Remote thermostat sensor reading

## Mode Bit Conventions

Bits in the status packet (chars 16-20, 4 hex chars = 16 bits, big-endian):

```
bit  7 = shutting down
bit  8 = guard flame on
bit 11 = igniting
bit 12 = aux on
```

The remaining 12 bits are unknown.

## Bridge Prefix Decoded

```
hex:    02 33 30 33 30 33 30 33 30 38 30
ASCII:  ␂  0  3  0  3  0  3  0  8  0
```

The pattern `030303080` looks like a length-prefixed or address-prefixed
header for the bridge layer. Three repetitions of `03` followed by `080`
suggests it might encode a fixed module address. This is the most likely
candidate for protocol variation across deployments, but no evidence of
variation has been observed in the wild.

## Open Questions

These are the questions worth answering with `valor-cli raw <hex>`:

1. **Is there a soft-reset command?**
   - The WiFi module's "stuck state" (red WiFi LED + green local LED) requires
     a paperclip reset. Power cycling the wall wart does not fix it.
   - If the module's firmware exposes a soft-reset command via this same TCP
     channel, it would let us automate recovery without an ESP32 hardware mod.
   - Try sending various unmapped opcodes and observe responses. Mertik GV60
     diagnostic ranges (`5x`, `6x`, `7x`) are good places to start.

2. **What does the module do when "stuck"?**
   - Does it still accept TCP connections on port 2000?
   - Does it still reply to status requests?
   - Does it silently fail commands, or actively reject them with an error frame?
   - This is testable any time the LEDs go red+green: run `valor-cli probe`.

3. **What are the unmapped status bits?**
   - 12 bits of the bit field are unaccounted for.
   - Toggling the fireplace through every state and dumping the raw status
     packet would let us correlate bit flips with observable state changes.

4. **Are there error / lockout reporting commands?**
   - The Mertik GV60 enters a safety lockout after failed ignition. The CLI
     today does not expose this state. Likely encoded somewhere in the status
     packet's unmapped bytes.

5. **Does the bridge prefix vary?**
   - Try sending commands with a slightly different prefix and see if the
     module rejects them.
   - If the prefix is a session token, we'd expect changes to be rejected.
   - If it's a fixed framing constant, it should be ignored.

## Investigation Workflow

The CLI's `raw` and `probe` commands are designed for systematic exploration:

```bash
# Liveness check (use this first when LEDs are weird)
valor-cli probe

# Send a known-good command via raw, verify behavior matches `status`
valor-cli raw 303303

# Send an unmapped opcode and see what the module returns
valor-cli raw 5003 --timeout=2000

# Send arbitrary bytes (no framing) for low-level probes
valor-cli raw 02ff03 --bare
```

For each interesting opcode, capture:

- The exact bytes sent
- The response bytes (hex + ASCII)
- The module's observable state before and after
- Any LED state changes

Any new findings should be added to this file with the date observed.

## References

- [homebridge-mertik-fireplace](https://github.com/tritter/homebridge-mertik-fireplace) — original reverse engineering
- [Valor GV60WIFI Upgrade Instructions](https://www.valorfireplaces.com/media/Remote/GV60WIFI-Upgrade-Instructions.pdf)
- Mertik Maxitrol GV60 service literature (paper-only, dealer-distributed)
