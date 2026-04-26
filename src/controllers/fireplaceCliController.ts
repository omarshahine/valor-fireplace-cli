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

  private async igniteFireplace() {
    if (this.igniting) {
      console.log("Already igniting...");
      return;
    }
    console.log("Igniting fireplace...");
    this.igniting = true;
    this.sendCommand("314103").catch(() => {});
    await this.delay(40_000);
    await this.refreshStatus();
  }

  private async standBy() {
    console.log("Setting to standby...");
    await this.setTemperatureValue(0);
    const msg = "3136303003";
    return this.sendCommand(msg);
  }

  private async guardFlameOff() {
    if (this.shuttingDown) {
      console.log("Already shutting down...");
      return;
    }
    console.log("Turning off guard flame...");
    this.shuttingDown = true;
    this.sendCommand("313003").catch(() => {});
    await this.delay(30_000);
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
      const payload = this.rxBuffer.subarray(stx + 1, etx).toString();
      this.rxBuffer = this.rxBuffer.subarray(etx + 1);
      if (payload.length === FireplaceCliController.STATUS_PACKET_LENGTH) {
        this.processStatusResponse(payload);
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
      await this.igniteFireplace();
      await this.delay(5_000);
      return false;
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
        await this.guardFlameOff();
        break;
    }
    return true;
  }

  private async refreshStatus(): Promise<FireplaceStatus | undefined> {
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let onStatus: ((s: FireplaceStatus) => void) | undefined;
      let timer: NodeJS.Timeout | undefined;
      try {
        const wait = new Promise<FireplaceStatus>((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("status response timeout")),
            FireplaceCliController.STATUS_RESPONSE_TIMEOUT
          );
          onStatus = (s) => resolve(s);
          this.once("status", onStatus);
        });
        await this.sendCommand("303303");
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
    }
  }

  private formatStatus(status: FireplaceStatus): string {
    const lines = [
      "──────────────────────────────────────",
      `Mode:               ${OperationMode[status.mode]}`,
      `Current Temp:       ${TemperatureConverter.formatTemperature(status.currentTemperature, this.useFahrenheit)}`,
      `Target Temp:        ${TemperatureConverter.formatTemperature(status.targetTemperature, this.useFahrenheit)}`,
      `Guard Flame:        ${status.guardFlameOn ? "On" : "Off"}`,
      `Igniting:           ${status.igniting ? "Yes" : "No"}`,
      `Shutting Down:      ${status.shuttingDown ? "Yes" : "No"}`,
      `Aux On:             ${status.auxOn ? "Yes" : "No"}`,
      "──────────────────────────────────────",
    ];
    return lines.join("\n");
  }

  // Public CLI methods
  public async turnOn() {
    try {
      console.log("Turning on fireplace...");
      await this.refreshStatus();
      await this.setModeInternal(OperationMode.Temperature, 20);
      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      console.log("✓ Fireplace turned on");
    } finally {
      this.closeConnection();
    }
  }

  public async turnOff() {
    try {
      console.log("Turning off fireplace...");
      await this.refreshStatus();
      await this.setModeInternal(OperationMode.Off);
      await this.delay(5_000);
      const status = await this.refreshStatus();
      if (status) {
        console.log("\nFireplace Status:");
        console.log(this.formatStatus(status));
      }
      console.log("✓ Fireplace turned off");
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
