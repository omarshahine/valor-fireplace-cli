import { IDeviceConfig } from "../models/deviceConfig";
import EventEmitter from "events";
import net, { Socket } from "net";
import { FireplaceStatus } from "../models/fireplaceStatus";
import { OperationMode } from "../models/operationMode";
import { FlameHeight, FlameHeightUtils } from "../models/flameHeight";
import { TemperatureRangeUtils } from "../models/temperatureRange";
import { IRequest } from "../models/request";
import { TemperatureConverter } from "../utils/temperatureConverter";

export class FireplaceCliController extends EventEmitter {
  private readonly config: IDeviceConfig;
  private readonly useFahrenheit: boolean;
  private height = FlameHeight.Step11;
  private client: Socket | null = null;
  private connectPromise: Promise<Socket> | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private lastContact: Date = new Date();
  private lastStatus: FireplaceStatus | undefined;
  private igniting = false;
  private shuttingDown = false;
  private lostConnection = false;
  private static UNREACHABLE_TIMEOUT = 1000 * 60 * 5; //5 min
  private static REFRESH_TIMEOUT = 1000 * 15; //15 seconds
  private static STATUS_PACKET_LENGTH = 106; //characters
  private static STATUS_RESPONSE_TIMEOUT = 5000; //5 seconds
  private static CONNECT_TIMEOUT = 5000; //5 seconds
  private static STX = 0x02;
  private static ETX = 0x03;

  constructor(ip: string, useFahrenheit: boolean = true) {
    super();
    this.config = {
      name: "CLI Fireplace",
      ip: ip,
    };
    this.useFahrenheit = useFahrenheit;
  }

  private processStatusResponse(response: string) {
    const newStatus = new FireplaceStatus(response);
    this.lastContact = new Date();
    this.igniting = newStatus.igniting;
    this.shuttingDown = newStatus.shuttingDown;
    this.lastStatus = newStatus;
    this.emit("status", this.lastStatus);
    if (this.lostConnection) {
      // Make sure to turn it off, as we are not sure which state we are in.
      this.guardFlameOff();
    }
  }

  private async igniteFireplace(): Promise<boolean> {
    if (this.igniting) {
      console.log("Already igniting...");
      return true;
    }
    console.log("Igniting fireplace...");
    this.igniting = true;
    this.sendCommand("314103").catch(() => {});
    // Poll until guardFlame catches (success) or we hit the ceiling. Mertik's
    // own ignition cycle takes up to ~60s; we ceiling at 90s with a tick every
    // 3s so the user sees the wait is real, not hung.
    const ok = await this.waitForTransition({
      label: "ignition",
      ceilingMs: 90_000,
      pollMs: 3_000,
      done: (s) => s.guardFlameOn,
    });
    await this.refreshStatus();
    return ok;
  }

  private async standBy() {
    console.log("Setting to standby...");
    await this.setTemperatureValue(0);
    const msg = "3136303003";
    return this.sendCommand(msg);
  }

  private async guardFlameOff(): Promise<boolean> {
    if (this.shuttingDown) {
      console.log("Already shutting down...");
      return true;
    }
    console.log("Turning off guard flame...");
    this.shuttingDown = true;
    this.sendCommand("313003").catch(() => {});
    // Empirically shutdown takes ~25-30s on a warm system (gas valve closes,
    // pilot millivolts decay, thermopile latch releases). One observed run
    // at 2026-05-17 completed in 26s — comfortably under the 45s ceiling
    // but the previous 30s was cutting it close. Bumped to 45s for headroom.
    return this.waitForTransition({
      label: "shutdown",
      ceilingMs: 45_000,
      pollMs: 2_000,
      done: (s) => !s.guardFlameOn,
    });
  }

  /**
   * Poll status until `done(status)` returns true, or we hit `ceilingMs`.
   * Prints a "[ Ns ] <label>..." tick line on each poll so the user knows
   * the command is alive. Used by ignite / shutdown to replace fixed-delay
   * `await this.delay(N)` calls — startup and shutdown vary widely in
   * duration so static delays are pessimistic for one and optimistic for
   * the other.
   */
  private async waitForTransition(opts: {
    label: string;
    ceilingMs: number;
    pollMs: number;
    done: (s: FireplaceStatus) => boolean;
  }): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < opts.ceilingMs) {
      await this.delay(opts.pollMs);
      const responsePromise = this.waitForNextStatus(
        FireplaceCliController.STATUS_RESPONSE_TIMEOUT,
      );
      try {
        await this.sendCommand("303303");
      } catch {
        /* ignore — wait for response anyway, next poll will retry if empty */
      }
      const s = await responsePromise;
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (s && opts.done(s)) {
        console.log(`[${elapsed}s] ${opts.label} complete.`);
        return true;
      }
      console.log(`[${elapsed}s] waiting for ${opts.label}...`);
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] ${opts.label} did not complete within ${Math.round(opts.ceilingMs / 1000)}s ceiling.`);
    return false;
  }

  /**
   * Wait for the next `status` event (or the existing `lastStatus` if a
   * response arrives via a concurrent handler before we subscribe). Returns
   * `undefined` if no fresh status arrives within `timeoutMs`. Used by
   * `waitForTransition` to avoid the hard-coded 500ms wait that risks
   * reading stale `lastStatus` when the device takes longer to respond.
   */
  private waitForNextStatus(timeoutMs: number): Promise<FireplaceStatus | undefined> {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (s: FireplaceStatus | undefined) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.removeListener("status", handler);
        resolve(s);
      };
      const handler = (s: FireplaceStatus) => finish(s);
      const timer = setTimeout(() => finish(this.lastStatus), timeoutMs);
      this.once("status", handler);
    });
  }

  private setEcoMode() {
    return this.sendCommand("4233303103");
  }

  private setManualMode() {
    return this.sendCommand("423003");
  }

  private setTemperatureMode() {
    return this.sendCommand("4232303103");
  }

  private handleData(chunk: Buffer) {
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    while (true) {
      const stx = this.rxBuffer.indexOf(FireplaceCliController.STX);
      if (stx < 0) {
        this.rxBuffer = Buffer.alloc(0);
        return;
      }
      const etx = this.rxBuffer.indexOf(FireplaceCliController.ETX, stx + 1);
      if (etx < 0) {
        if (stx > 0) this.rxBuffer = this.rxBuffer.subarray(stx);
        return;
      }
      const payloadBuf = this.rxBuffer.subarray(stx + 1, etx);
      this.rxBuffer = this.rxBuffer.subarray(etx + 1);
      if (payloadBuf.length === FireplaceCliController.STATUS_PACKET_LENGTH) {
        this.processStatusResponse(payloadBuf.toString("ascii"));
      }
    }
  }

  private ensureClient(): Promise<Socket> {
    if (this.client && !this.client.destroyed && this.connectPromise) {
      return this.connectPromise;
    }

    const ip = this.config.ip;
    const sock = new net.Socket();
    this.client = sock;
    this.rxBuffer = Buffer.alloc(0);

    this.connectPromise = new Promise<Socket>((resolve, reject) => {
      const connectTimer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`Connection to ${ip}:2000 timed out`));
      }, FireplaceCliController.CONNECT_TIMEOUT);

      sock.once("connect", () => {
        clearTimeout(connectTimer);
        sock.setTimeout(FireplaceCliController.REFRESH_TIMEOUT);
        resolve(sock);
      });

      sock.once("error", (err) => {
        clearTimeout(connectTimer);
        reject(err);
      });

      sock.on("close", () => {
        if (this.client === sock) {
          this.client = null;
          this.connectPromise = null;
          this.rxBuffer = Buffer.alloc(0);
        }
      });

      sock.on("data", (data) => this.handleData(data));

      sock.connect(2000, ip);
    }).catch((err) => {
      sock.destroy();
      if (this.client === sock) {
        this.client = null;
        this.connectPromise = null;
      }
      throw err;
    });

    return this.connectPromise;
  }

  private async sendCommand(command: string): Promise<boolean> {
    const prefix = "0233303330333033303830";
    const packet = Buffer.from(prefix + command, "hex");
    const sock = await this.ensureClient();
    return sock.write(packet);
  }

  private reachable(): boolean {
    const now = new Date().getTime();
    const last = this.lastContact.getTime();
    return now - last < FireplaceCliController.UNREACHABLE_TIMEOUT;
  }

  private delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  private resetFlameHeight(): void {
    const msg = "3136" + FlameHeight.Step11 + "03";
    this.sendCommand(msg).catch(() => {});
  }

  private async setFlameHeight(temperature: number) {
    const percentage = (temperature - 5) / 31;
    const height = FlameHeightUtils.ofPercentage(percentage);
    console.log(`Setting flame height to ${height.toString()}`);
    this.height = height;
    this.resetFlameHeight();
    await this.delay(10_000);
    const msg = "3136" + height + "03";
    this.sendCommand(msg).catch(() => {});
    await this.delay(1_000);
  }

  private async setTemperatureInternal(temperature: number) {
    this.setTemperatureMode().catch(() => {});
    await this.delay(1_000);
    if (this?.lastStatus?.targetTemperature !== temperature) {
      await this.setTemperatureValue(temperature);
    }
  }

  private async setTemperatureValue(temperature: number) {
    const value = TemperatureRangeUtils.toBits(temperature);
    const msg = "42324644303" + value + "03";
    this.sendCommand(msg).catch(() => {});
    await this.delay(1_000);
  }

  private async setModeInternal(
    mode: OperationMode,
    temperature?: number
  ): Promise<boolean> {
    const currentMode = this.lastStatus?.mode || OperationMode.Off;

    if (this.igniting) {
      console.log("Please wait, fireplace is igniting...");
      return false;
    }

    // Need to ignite if turning on from off state
    if (
      mode !== OperationMode.Off &&
      currentMode === OperationMode.Off &&
      !this.lastStatus?.guardFlameOn
    ) {
      console.log("Igniting fireplace first...");
      const ignited = await this.igniteFireplace();
      await this.delay(5_000);
      return ignited;
    }

    if (currentMode === mode) {
      console.log("Already in that mode");
      return true;
    }

    console.log(`Setting mode to: ${OperationMode[mode]}`);
    const targetTemperature =
      temperature ?? this.lastStatus?.targetTemperature ?? 20;

    switch (mode) {
      case OperationMode.Manual:
        this.setManualMode().catch(() => {});
        await this.delay(2_000);
        this.setFlameHeight(targetTemperature);
        break;
      case OperationMode.Eco:
        this.setFlameHeight(targetTemperature);
        await this.delay(2_000);
        this.setEcoMode().catch(() => {});
        break;
      case OperationMode.Temperature:
        await this.setTemperatureInternal(targetTemperature);
        break;
      case OperationMode.Off:
        return this.guardFlameOff();
    }
    return true;
  }

  private async refreshStatus(): Promise<FireplaceStatus | undefined> {
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let onStatus: ((s: FireplaceStatus) => void) | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        await this.sendCommand("303303");
        const wait = new Promise<FireplaceStatus>((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("status response timeout")),
            FireplaceCliController.STATUS_RESPONSE_TIMEOUT
          );
          onStatus = (s) => resolve(s);
          this.once("status", onStatus);
        });
        const status = await wait;
        if (timer) clearTimeout(timer);
        return status;
      } catch (err) {
        if (onStatus) this.off("status", onStatus);
        if (timer) clearTimeout(timer);
        if (attempt === MAX_ATTEMPTS) {
          return undefined;
        }
        await this.delay(500);
      }
    }
    return undefined;
  }

  private closeConnection() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.connectPromise = null;
    }
  }

  private formatStatus(status: FireplaceStatus): string {
    // Chars 14-15 linger at the last in-flight value after shutdown (firmware
    // doesn't clear them). Gate the displayed percent on guardFlameOn so a
    // post-shutdown read doesn't claim "Burner Output: 91%" while the pilot
    // is dead. Raw byte is still in `status.burnerOutput` for diagnostics.
    const burnerPct = status.guardFlameOn
      ? Math.round((status.burnerOutput / 255) * 100)
      : 0;
    const lightPct = Math.round((status.lightBrightness / 255) * 100);
    const lines = [
      "──────────────────────────────────────",
      `Mode:               ${OperationMode[status.mode]}${status.scheduleActive ? " (schedule/timer)" : ""}`,
      `Current Temp:       ${TemperatureConverter.formatTemperature(status.currentTemperature, this.useFahrenheit)}`,
      `Target Temp:        ${TemperatureConverter.formatTemperature(status.targetTemperature, this.useFahrenheit)}`,
      `Guard Flame:        ${status.guardFlameOn ? "On" : "Off"}${status.pilotOnly ? " (pilot only — burner off)" : ""}`,
      `Burner Output:      ${burnerPct}%  (0x${status.burnerOutput.toString(16).toUpperCase().padStart(2, "0")})`,
      `Igniting:           ${status.igniting ? "Yes" : "No"}`,
      `Shutting Down:      ${status.shuttingDown ? "Yes" : "No"}`,
      `Aux On:             ${status.auxOn ? "Yes" : "No"}`,
      `Fan Speed:          ${status.fanSpeed}/4`,
      `Light:              ${status.lightOn ? "On" : "Off"} (brightness ${lightPct}%)`,
      `Status Bits:        0x${status.statusBitsHex}`,
      "──────────────────────────────────────",
    ];
    if (status.lockoutSuspected) {
      lines.push(
        "⚠ Possible lockout OR active ignition in progress.",
        "  Bit pattern is Igniting=Yes with Guard Flame=Off and",
        "  no Shutting Down. The first ~20-40s of any normal",
        "  ignition also looks like this — a single snapshot",
        "  can't disambiguate. Re-run `valor-cli status` in 60s.",
        "  If the pattern persists, the Mertik GV60 valve has",
        "  tripped its safety lockout (cold thermopile, air in",
        "  pilot line, low LP pressure, or fouled spark gap).",
        "  Recovery needs on-site intervention (cycle gas at the",
        "  wall, retry ignition, or service call).",
        "──────────────────────────────────────",
      );
    }
    return lines.join("\n");
  }

  // Public CLI methods
  public async turnOn() {
    try {
      console.log("Turning on fireplace...");
      await this.refreshStatus();
      const ok = await this.setModeInternal(OperationMode.Temperature, 20);
      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      if (ok && status?.guardFlameOn) {
        console.log("✓ Fireplace turned on");
      } else {
        console.log("⚠ Turn-on did not complete — see status above. Try again or check the appliance.");
      }
    } finally {
      this.closeConnection();
    }
  }

  public async turnOff() {
    try {
      console.log("Turning off fireplace...");
      await this.refreshStatus();
      const ok = await this.setModeInternal(OperationMode.Off);
      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      if (ok && !status?.guardFlameOn) {
        console.log("✓ Fireplace turned off");
      } else {
        console.log("⚠ Shutdown did not complete within the timeout — see status above. The receiver may still be in transition; re-run `valor-cli status` in a few seconds.");
      }
    } finally {
      this.closeConnection();
    }
  }

  public async getStatus() {
    try {
      console.log("Getting fireplace status...\n");
      const status = await this.refreshStatus();

      if (status) {
        console.log("Fireplace Status:");
        console.log(this.formatStatus(status));
      } else {
        console.log("Unable to retrieve status");
      }
    } finally {
      this.closeConnection();
    }
  }

  public async setMode(mode: OperationMode) {
    try {
      console.log(`Setting mode to ${OperationMode[mode]}...`);
      await this.refreshStatus();
      await this.setModeInternal(mode);
      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      console.log(`✓ Mode set to ${OperationMode[mode]}`);
    } finally {
      this.closeConnection();
    }
  }

  public async setTemperature(temperature: number) {
    try {
      console.log(
        `Setting temperature to ${TemperatureConverter.formatTemperature(
          temperature,
          this.useFahrenheit
        )}...`
      );
      await this.refreshStatus();

      const currentMode = this.lastStatus?.mode || OperationMode.Off;

      if (currentMode === OperationMode.Off) {
        console.log("Fireplace is off, turning on first...");
        await this.setModeInternal(OperationMode.Temperature, temperature);
      } else if (currentMode === OperationMode.Temperature) {
        await this.setTemperatureInternal(temperature);
      } else {
        // For Manual or Eco modes, switch to Temperature mode
        console.log(
          `Switching from ${OperationMode[currentMode]} mode to Temperature mode...`
        );
        await this.setModeInternal(OperationMode.Temperature, temperature);
      }

      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      console.log(
        `✓ Temperature set to ${TemperatureConverter.formatTemperature(
          temperature,
          this.useFahrenheit
        )}`
      );
    } finally {
      this.closeConnection();
    }
  }
}
