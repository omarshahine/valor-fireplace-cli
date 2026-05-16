import { OperationMode } from "./operationMode";

export class FireplaceStatus {
  public readonly auxOn: boolean = false;
  public readonly mode: OperationMode = OperationMode.Off;
  public readonly currentTemperature: number = 10;
  public readonly targetTemperature: number = 10;
  public readonly igniting: boolean = false;
  public readonly guardFlameOn: boolean = false;
  public readonly shuttingDown: boolean = false;
  /** Raw 4-char hex of the status bit field (chars 16-19). Useful for diagnostics. */
  public readonly statusBitsHex: string = "";
  /**
   * Heuristic candidate for a Mertik GV60 ignition lockout: `igniting=1` with
   * `guardFlameOn=0` and `shuttingDown=0`. A real lockout looks exactly like
   * this — the valve tried to light, the thermopile never confirmed flame, and
   * the receiver killed the gas, leaving the `igniting` bit set until a reset.
   *
   * **The same pattern also holds for the first ~20-40 seconds of any normal
   * ignition**, before the thermopile confirms flame. A single status snapshot
   * cannot distinguish the two cases. Callers that need certainty should poll
   * status repeatedly and look for the pattern to persist (the homebridge
   * plugin's `FireplaceController` uses a 3-consecutive-reads threshold).
   * Empirically observed at the cabin on 2026-05-16.
   */
  public readonly lockoutSuspected: boolean = false;
  /**
   * Schedule / timer / remote-program overlay active (status bit 9).
   * Set when the handheld remote is driving the setpoint from a stored
   * program (P1/P2 timer or schedule). End byte may be `04` (program is
   * the active driver) or `01` (manual setpoint with overlay).
   */
  public readonly scheduleActive: boolean = false;
  /**
   * Decorative light on (status bit 13). Pairs with `lightBrightness` which
   * carries the dimmer setpoint independently of on/off state.
   */
  public readonly lightOn: boolean = false;
  /**
   * Decorative light brightness setpoint, 0-255 (chars 20-21). Persists
   * across light on/off — the controller remembers your last dim level.
   * Reads `0x00` only when the light has never been adjusted.
   */
  public readonly lightBrightness: number = 0;
  /**
   * Circulating fan speed, 0-4 (chars 22-23). 0 = off, 1-4 = the four
   * speed bars exposed by the Valor 10 handheld remote.
   */
  public readonly fanSpeed: number = 0;
  /**
   * Current main-burner output level, 0-255 (chars 14-15). `0x00` means
   * pilot only (no main burner flame). `0xFF` means full output (Step11).
   * The 12 commandable FlameHeight enum steps map onto this same 8-bit
   * value, but the firmware may report any intermediate value while
   * modulating in temperature / eco mode.
   */
  public readonly burnerOutput: number = 0;
  /**
   * Pilot lit but main burner is off — i.e. pilot-only mode. Triggered
   * from the Valor 10 handheld by pressing DOWN until "fireplace pilot
   * flame only" appears. Not a distinct wire mode; just a state where
   * `guardFlameOn && burnerOutput === 0`.
   */
  public readonly pilotOnly: boolean = false;

  constructor(status: string) {
    const modeBits = status.substring(24, 25);
    const statusBits = status.substring(16, 20);
    const modeEndByte = status.substring(status.length - 2);
    this.statusBitsHex = statusBits;
    this.shuttingDown = fromBitStatus(statusBits, 7);
    this.guardFlameOn = fromBitStatus(statusBits, 8);
    this.scheduleActive = fromBitStatus(statusBits, 9);
    this.igniting = fromBitStatus(statusBits, 11);
    this.auxOn = fromBitStatus(statusBits, 12);
    this.lightOn = fromBitStatus(statusBits, 13);
    this.burnerOutput = parseInt("0x" + status.substring(14, 16));
    this.lightBrightness = parseInt("0x" + status.substring(20, 22));
    this.fanSpeed = parseInt("0x" + status.substring(22, 24));
    this.currentTemperature = parseInt("0x" + status.substring(28, 32)) / 10;
    this.targetTemperature = parseInt("0x" + status.substring(32, 36)) / 10;
    this.lockoutSuspected =
      this.igniting && !this.guardFlameOn && !this.shuttingDown;
    this.pilotOnly = this.guardFlameOn && this.burnerOutput === 0;
    let opMode = operationModeOfBits(modeBits, modeEndByte);
    if (!this.guardFlameOn || this.shuttingDown) {
      opMode = OperationMode.Off;
    }
    this.mode = opMode;
  }

  public toString(): string {
    return (
      `mode:${OperationMode[this.mode]} ` +
      `ignite:${this.igniting} ` +
      `target:${this.targetTemperature} ` +
      `aux:${this.auxOn} ` +
      `current:${this.currentTemperature} ` +
      `shutdown:${this.shuttingDown} ` +
      `guardOn:${this.guardFlameOn} `
    );
  }
}

function operationModeOfBits(mode: string, endByte: string) {
  // First check the mode bit at position 24
  switch (mode) {
    case "1":
      return OperationMode.Temperature;
    case "2":
      return OperationMode.Eco;
    default:
      // For mode "0", check the end byte to distinguish
      // between remote thermostat mode and manual mode
      switch (endByte) {
        case "01": // CLI Temperature mode
        case "02": // Remote Temperature mode (variant)
        case "04": // Remote: Temp, Timer, or Schedule mode
          return OperationMode.Temperature;
        case "08": // Remote: Flame Height (Manual)
          return OperationMode.Manual;
        default:
          return OperationMode.Manual;
      }
  }
}

function hex2bin(hex: string) {
  return parseInt(hex, 16).toString(2).padStart(16, "0");
}

function fromBitStatus(hex: string, index: number) {
  return hex2bin(hex).substring(index, index + 1) === "1";
}
