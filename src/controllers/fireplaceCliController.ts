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
  private lastContact: Date = new Date();
  private lastStatus: FireplaceStatus | undefined;
  private igniting = false;
  private shuttingDown = false;
  private lostConnection = false;
  private static UNREACHABLE_TIMEOUT = 1000 * 60 * 5; //5 min
  private static REFRESH_TIMEOUT = 1000 * 15; //15 seconds
  private static STATUS_PACKET_LENGTH = 106; //characters

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
    this.sendCommand("314103");
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
    this.sendCommand("313003");
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

  private ensureClient(): Socket {
    const ip = this.config.ip;
    if (
      !this.client ||
      typeof this.client === "undefined" ||
      typeof this.client.destroyed !== "boolean" ||
      this.client.destroyed === true
    ) {
      this.client = new net.Socket();
      this.client.connect(2000, ip);
      this.client.setTimeout(FireplaceCliController.REFRESH_TIMEOUT);
      this.client.on("data", (data) => {
        const tempData = data.toString().substring(1, data.length - 1);
        if (tempData.length === FireplaceCliController.STATUS_PACKET_LENGTH) {
          this.processStatusResponse(tempData);
        }
      });
      this.client.on("error", (err) => {
        console.error("Socket error: " + err.message);
        if (this.client && typeof this.client.destroy === "function") {
          this.client.destroy();
        }
      });
    }
    return this.client;
  }

  private sendCommand(command: string): boolean {
    const prefix = "0233303330333033303830";
    const packet = Buffer.from(prefix + command, "hex");
    return this.ensureClient().write(packet);
  }

  private reachable(): boolean {
    const now = new Date().getTime();
    const last = this.lastContact.getTime();
    return now - last < FireplaceCliController.UNREACHABLE_TIMEOUT;
  }

  private delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  private resetFlameHeight(): void {
    const msg = "3136" + FlameHeight.Step11 + "03";
    this.sendCommand(msg);
  }

  private async setFlameHeight(temperature: number) {
    const percentage = (temperature - 5) / 31;
    const height = FlameHeightUtils.ofPercentage(percentage);
    console.log(`Setting flame height to ${height.toString()}`);
    this.height = height;
    this.resetFlameHeight();
    await this.delay(10_000);
    const msg = "3136" + height + "03";
    this.sendCommand(msg);
    await this.delay(1_000);
  }

  private async setTemperatureInternal(temperature: number) {
    this.setTemperatureMode();
    await this.delay(1_000);
    if (this?.lastStatus?.targetTemperature !== temperature) {
      await this.setTemperatureValue(temperature);
    }
  }

  private async setTemperatureValue(temperature: number) {
    const value = TemperatureRangeUtils.toBits(temperature);
    const msg = "42324644303" + value + "03";
    this.sendCommand(msg);
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
        this.setManualMode();
        await this.delay(2_000);
        this.setFlameHeight(targetTemperature);
        break;
      case OperationMode.Eco:
        this.setFlameHeight(targetTemperature);
        await this.delay(2_000);
        this.setEcoMode();
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
    try {
      this.sendCommand("303303");
      await this.delay(2_000);
      return this.lastStatus;
    } catch (error) {
      console.error("Failed to refresh status");
      throw error;
    }
  }

  private closeConnection() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
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
        console.log(status.toString());
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
        console.log(status.toString());
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
        console.log("──────────────────────────────────────");
        console.log(`Mode:               ${OperationMode[status.mode]}`);
        console.log(
          `Current Temp:       ${TemperatureConverter.formatTemperature(
            status.currentTemperature,
            this.useFahrenheit
          )}`
        );
        console.log(
          `Target Temp:        ${TemperatureConverter.formatTemperature(
            status.targetTemperature,
            this.useFahrenheit
          )}`
        );
        console.log(
          `Guard Flame:        ${status.guardFlameOn ? "On" : "Off"}`
        );
        console.log(`Igniting:           ${status.igniting ? "Yes" : "No"}`);
        console.log(
          `Shutting Down:      ${status.shuttingDown ? "Yes" : "No"}`
        );
        console.log(`Aux On:             ${status.auxOn ? "Yes" : "No"}`);
        console.log(`Reachable:          ${this.reachable() ? "Yes" : "No"}`);
        console.log("──────────────────────────────────────");
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
        console.log(status.toString());
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
        console.log(status.toString());
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
