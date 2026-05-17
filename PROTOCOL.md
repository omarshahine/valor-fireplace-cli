# Valor B6R-WME / Mertik GV60 Protocol

This document captures everything currently known about the protocol spoken by
the Valor `GV60WiFi` upgrade module (sometimes called the **B6R-WME** controller).
Most of the wire-level details were reverse-engineered from the
[homebridge-mertik-fireplace](https://github.com/tritter/homebridge-mertik-fireplace)
project and then significantly extended by empirical observation against a live
module on 2026-05-16 — see [Empirical Findings](#empirical-findings-2026-05-16).

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
(`030303080`) have remained constant across every observed packet. This is
the most likely candidate for protocol variation across deployments, but no
evidence of variation has been seen.

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
| Mode: eco | `4233303103` | `B301␃` | Empirically: drives status char 24 to `2` |
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

These are calibrated 8-bit values (`0x80` → `0xFF`) sent as ASCII pairs.
Step11 is full output (255). **The same 8-bit value is reported back in
chars 14-15 of the status packet as the current burner output** — see
[Status Packet Layout](#status-packet-layout). When the firmware modulates
in temperature or eco mode, the feedback can land on *any* intermediate
value (e.g. `0xEB`, `0xBB`), not just the 12 discrete commandable steps.

### Temperature encoding

`TemperatureRangeUtils.toBits(value: number): string` converts a Celsius
target into a 5-char ASCII string. The full encoding is in
`src/models/temperatureRange.ts`. The shape:

- Temperature is multiplied by 10 (so 21.5°C → 215)
- Decomposed into a "degrees" field (high byte) and "decimals" field (low nibble)
- A magic offset is added based on which 16-step band the value falls into
- Result is prepended with `0` or `1` as a region selector

Range supported by the encoder: roughly 5°C to 36°C (41°F to 97°F).

## Status Packet Layout

When the module receives a status request, it replies with a 106-char ASCII
payload (between STX/ETX). Char indices are 0-based.

| Chars | Field | Meaning |
|---|---|---|
| 0-3 | `0303` | Constant — possibly the inbound bridge address echo |
| 4-13 | `000000034 0` | Constant header |
| 14-15 | **Burner output** | Current main-burner output, 8-bit (`0x00`-`0xFF`). `0x00` = no main flame (pilot only). `0xFF` = full output (Step11). Uses the same calibration as the FlameHeight outbound command. |
| 16-19 | **Status bits** | 16-bit field. See [Status Bits](#status-bits). |
| 20-21 | **Light brightness** | Decorative light dimmer setpoint, 8-bit (`0x00`-`0xFF`). Persists across light on/off — controller remembers your last setting. |
| 22-23 | **Fan speed** | Circulating fan setting, 8-bit. Observed values: `0x00`=off, `0x01`-`0x04` = the four speed bars on the Valor 10 handheld. |
| 24 | **Mode bits** | Mode selector. `0` = check end byte. `1` = Temperature (CLI-set). `2` = Eco (CLI-set). |
| 25-27 | Reserved | Always `000` in observed packets |
| 28-31 | Current temp | 16-bit hex, divided by 10 → Celsius |
| 32-35 | Target temp | 16-bit hex, divided by 10 → Celsius |
| 36-53 | Device name | ASCII string ("Fireplace" observed), space for ~9 chars |
| 54-77 | Name padding | `FF` bytes |
| 78-103 | Trailing data | All zeros observed; may carry diagnostic data we haven't triggered |
| 104-105 | **Mode end byte** | When char 24 = `0`, this disambiguates the mode. See [Mode End Bytes](#mode-end-bytes). |

### Status Bits

Chars 16-19 = 4 hex chars = 16 bits, big-endian. Indexing in the CLI is
MSB-first (`hex2bin(...).substring(idx, idx+1)` — index 0 = MSB).

| Bit | Set when | Empirically observed |
|---|---|---|
| 0 | Always 1 | Constant in every packet |
| 1-5 | ? | Never observed set |
| 6 | Always 1 | Constant in every packet |
| 7 | Shutting down | Set during the ~30s post-`Guard flame off` window |
| 8 | Guard flame on | Pilot lit (true in operating, pilot-only, and post-shutdown states) |
| 9 | **Schedule / timer / remote-program overlay** | Set when handheld is running P1/P2 timer or schedule program (with end byte `01` or `04`) |
| 10 | ? | Never observed set in any captured state |
| 11 | Igniting | Set mid-ignition; **also stays set as a lockout indicator** (see lockout heuristic below) |
| 12 | Aux on | Auxiliary output circuit enabled (fan + light power) |
| 13 | **Light on** | Decorative light power on/off (independent of brightness setpoint) |
| 14 | Always 1 | Constant |
| 15 | Always 1 | Constant |

**Constants** (always set): bits 0, 6, 14, 15.

**Never observed set**: bits 1, 2, 3, 4, 5, 10. These probably encode states
we haven't reached: error codes, battery low, safety lock, pilot millivolts,
firmware flags. See [Open Questions](#open-questions).

### Mode End Bytes

Char 24 (`modeBits`) is the primary mode selector; when it's `0`, chars
104-105 (the **end byte**) disambiguate. Empirically observed values:

| End byte | Source | Meaning |
|---|---|---|
| `01` | CLI-issued | Temperature mode |
| `02` | Handheld remote | Remote Temperature mode (functionally identical to `01`) |
| `04` | Handheld remote | Schedule or Timer mode (the two are *not* distinguishable on the wire) |
| `08` | Handheld remote | Manual flame height mode (the "flame icon" UI mode) — also produced by the handheld's Eco button |
| `00` | Transient | Seen during shutdown / off states |

**Important asymmetry (empirically observed 2026-05-16):** The handheld
remote's **Eco button** does NOT set char 24 to `2`. It just toggles
into end byte `08` (Manual flame). Only the CLI's `Mode: eco` command
(`4233303103`) produces the canonical char-24=`2` Eco encoding. So
"eco from handheld" and "eco from CLI" are different on the wire.

### Lockout Heuristic

A Mertik GV60 ignition lockout produces this stable signature:

```
bit  7 = 0   (not shutting down)
bit  8 = 0   (pilot not lit)
bit 11 = 1   (igniting flag stuck set)
```

The CLI surfaces this as `FireplaceStatus.lockoutSuspected`. It implies
that the valve tried to ignite, the thermopile never confirmed flame, and
the receiver killed the gas. The `igniting` bit then stays set until a
power-cycle or paperclip reset. Recovery generally requires on-site
intervention (cycle gas at the wall, retry ignition, or service the
fireplace).

**Important caveat:** the same three-bit pattern is also produced during
the first ~20-40s of any *normal* ignition, before the thermopile confirms
flame. A single status snapshot cannot distinguish "still lighting" from
"stuck in lockout". The signal is reliable only when the pattern persists
across multiple reads. Programmatic callers should use a consecutive-read
threshold (the homebridge plugin uses 3) before treating it as a real
lockout; the CLI's `status` command instead softens its warning and tells
the user to re-run after 60s.

Observed sample lockout packet (cabin module, 2026-05-16):

```
03030000000340FF82130004000000910 0C84669...
                ^^^^                  status bits = 0x8213
                                      bit 11 set, bits 7/8 clear
```

### Pilot-only state

Pilot lit but main burner off. Triggered from the Valor 10 handheld by
pressing DOWN until "fireplace pilot flame only" appears.

```
bit  8 = 1            (pilot lit)
chars 14-15 = 0x00    (no main burner output)
```

Surfaced as `FireplaceStatus.pilotOnly`.

## Empirical Findings (2026-05-16)

This section records observations from a live debugging session against the
cabin module at `192.168.1.141`. Raw packet captures live in
`captures/2026-05-16-*.log` (gitignored).

### State / end-byte map confirmed

All four end byte values empirically observed during deliberate state
transitions. End byte `08` is what the handheld's flame-control mode emits
(and also what the handheld's eco button emits — distinct from CLI eco).

### Newly decoded fields

| Field | Location | Previously thought | Now known |
|---|---|---|---|
| Current burner output | Chars 14-15 | Unknown | Continuous 0-255, with 12 canonical steps as commandable values |
| Light brightness | Chars 20-21 | Unknown | 0-255 dimmer setpoint, persists across off |
| Fan speed | Chars 22-23 | Unknown | Discrete 0-4 (off + 4 speed bars) |
| Schedule/timer overlay | Bit 9 | Unknown | Set when handheld P1/P2 program is the active driver |
| Light on | Bit 13 | Unknown | Light circuit on/off, independent of brightness setpoint |

### Transitions observed

| User action | Wire change |
|---|---|
| Fan speed 0→1→2→3→4 (full walk) | Chars 22-23 step `00`→`01`→`02`→`03`→`04` |
| Light off → on | Bit 13: 0→1; chars 20-21 keep last brightness (`0x6D` observed) |
| Aux off → on | Bit 12: 0→1, nothing else moves |
| Schedule / Timer engage | Bit 9: 0→1, end byte → `04` |
| Manual flame mode | End byte → `08` |
| Flame Low (Step0) via remote | Chars 14-15 → `0x80` |
| Flame High (Step11) via remote | Chars 14-15 → `0xFF` |
| Pilot only via remote | Chars 14-15 → `0x00`, bit 8 stays 1 |
| Shutdown initiated | Bit 7: 0→1, end byte → `00` briefly, chars 14-15 → `0` |
| CLI `mode eco` | Char 24: `0`→`2`, end byte → `01`, burner ramps to modulate |
| Handheld `eco` button | End byte → `08`, char 24 stays `0` |
| Ignition lockout (cold start, weak pilot) | Bits: `0x8213` stable, ignite bit stuck |

### Negative results

- **Timer vs Schedule are indistinguishable** on the wire. Both produce
  end byte `04` with bit 9 set. The handheld tracks the distinction in
  its own UI.
- **Bit 10 was never observed set.** My earlier hypothesis that bit 10 =
  "burner active" was wrong (arithmetic error reading the nibble).
- **The bridge prefix `030303080` never varied** across any captured
  packet.
- **Chars 14-15 = `00` doesn't mean "pilot off"** — it means "no main
  burner output". Pilot status lives independently in bit 8.

## Open Questions

1. **Soft-reset command?**
   - The WiFi module's "stuck state" (red WiFi LED + green local LED)
     requires a paperclip reset. Power cycling the wall wart does not fix it.
   - Try sending unmapped opcodes (`5x`, `6x`, `7x` Mertik diagnostic ranges)
     looking for one that resets the module without physical access.
   - This is the highest-value unknown — would let us automate recovery.

2. **What does the module do when "stuck"?**
   - Does it still accept TCP connections on port 2000?
   - Does it still reply to status requests?
   - This is testable any time the LEDs go red+green: run `valor-cli probe`.

3. **What are bits 1-5 and bit 10 used for?**
   - Never observed set in any captured state. Plausible candidates:
     error codes, battery low, safety / childproof lock, pilot millivolts,
     remote-thermostat sensor data.
   - To map them: try the childproof lock combo (`Power + Down` on the
     handheld), let the remote go battery-low, trigger another ignition
     lockout, or experience an actual fault.

4. **Are there error / lockout reporting commands?**
   - The CLI's `lockoutSuspected` heuristic catches the canonical pattern,
     but doesn't decode *what* caused it (low pressure, dead thermopile,
     fouled electrode). A dedicated lockout-code byte may exist in the
     trailing zero region (chars 78-103).
   - **Open:** find an opcode that clears the lockout without a paperclip
     reset. Worth trying the Mertik service / diagnostic opcodes.

5. **Does the bridge prefix vary?**
   - Try sending commands with a different prefix and see if the module
     rejects them. If the prefix is a session token, changes should be
     rejected; if it's a fixed framing constant, it should be ignored.

6. **3-hour auto-turndown and 7-day SmartPilot shutdown.**
   - Valor's docs describe automatic transitions after inactivity. Their
     wire signatures haven't been captured. The 3-hour event would be
     accessible with a long capture session.

7. **Eco-mode handheld vs CLI divergence.**
   - We confirmed they produce different wire states. Open: is there
     anywhere in the packet that DOES reflect the handheld's eco mode?
     We didn't check the trailing zero bytes carefully under handheld
     eco — worth a focused re-test.

## Investigation Workflow

The CLI's `raw`, `probe`, and `watch` commands are designed for systematic
exploration:

```bash
# Liveness check (use this first when LEDs are weird)
valor-cli probe

# Send a known-good command via raw, verify behavior matches `status`
valor-cli raw 303303

# Send an unmapped opcode and see what the module returns
valor-cli raw 5003 --timeout=2000

# Send arbitrary bytes (no framing) for low-level probes
valor-cli raw 02ff03 --bare

# Tail status until Ctrl+C — invaluable for catching transient transitions
valor-cli watch --interval=1500
```

For high-fidelity capture of bit transitions during state changes, a tight
loop of raw status reads works better than `watch` (which reports the
already-decoded high-level fields). See `captures/2026-05-16-raw.log`
for the format used during the May 2026 session.

For each interesting opcode, capture:

- The exact bytes sent
- The response bytes (hex + ASCII)
- The module's observable state before and after
- Any LED state changes

Any new findings should be added to this file with the date observed.

## References

- [homebridge-mertik-fireplace](https://github.com/tritter/homebridge-mertik-fireplace) — original reverse engineering
- [Valor GV60WIFI Upgrade Instructions](https://www.valorfireplaces.com/media/Remote/GV60WIFI-Upgrade-Instructions.pdf)
- [Valor remote control instructions](https://www.valorfireplaces.com/blog/gas-fireplace-remote-control-instructions.php) — handheld button semantics (Valor 10 / Plus / Max)
- Mertik Maxitrol GV60 service literature (paper-only, dealer-distributed)
