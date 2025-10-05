#!/usr/bin/env node

import { FireplaceCliController } from "./controllers/fireplaceCliController";
import { OperationMode } from "./models/operationMode";
import { TemperatureConverter } from "./utils/temperatureConverter";
import { ConfigReader } from "./utils/configReader";

const args = process.argv.slice(2);
const config = ConfigReader.readConfig();
const useFahrenheit = config.temperatureUnit === "F";

if (args.length === 0) {
  printUsage();
  process.exit(1);
}

const command = args[0].toLowerCase();
const ip = process.env.FIREPLACE_IP || config.ip || args[args.length - 1];

// Validate IP is provided
if (!ip || !isValidIP(ip)) {
  console.error("Error: Invalid or missing IP address.");
  console.error(
    "Either set FIREPLACE_IP environment variable or provide IP as last argument."
  );
  console.error("Example: fireplace-cli status 192.168.1.100");
  process.exit(1);
}

const controller = new FireplaceCliController(ip, useFahrenheit);

async function main() {
  try {
    switch (command) {
      case "on":
        await controller.turnOn();
        break;

      case "off":
        await controller.turnOff();
        break;

      case "status":
        await controller.getStatus();
        break;

      case "mode":
        if (args.length < 2) {
          console.error("Error: Mode command requires a mode argument.");
          console.error("Valid modes: manual, eco, temperature, off");
          process.exit(1);
        }
        const modeArg = args[1].toLowerCase();
        let mode: OperationMode;
        switch (modeArg) {
          case "manual":
            mode = OperationMode.Manual;
            break;
          case "eco":
            mode = OperationMode.Eco;
            break;
          case "temperature":
          case "temp":
            mode = OperationMode.Temperature;
            break;
          case "off":
            mode = OperationMode.Off;
            break;
          default:
            console.error(`Error: Invalid mode '${modeArg}'.`);
            console.error("Valid modes: manual, eco, temperature, off");
            process.exit(1);
        }
        await controller.setMode(mode);
        break;

      case "temp":
      case "temperature":
        if (args.length < 2) {
          console.error(
            "Error: Temperature command requires a temperature value."
          );
          console.error(
            TemperatureConverter.getValidRangeMessage(useFahrenheit)
          );
          process.exit(1);
        }
        const tempInput = parseFloat(args[1]);
        const tempInCelsius = TemperatureConverter.validateAndConvert(
          tempInput,
          useFahrenheit
        );
        if (isNaN(tempInput) || tempInCelsius === null) {
          console.error(`Error: Invalid temperature '${args[1]}'.`);
          console.error(
            TemperatureConverter.getValidRangeMessage(useFahrenheit)
          );
          process.exit(1);
        }
        // Round to 1 decimal place to avoid floating-point precision issues
        const roundedTempInCelsius = Math.round(tempInCelsius * 10) / 10;
        await controller.setTemperature(roundedTempInCelsius);
        break;

      default:
        console.error(`Error: Unknown command '${command}'.`);
        printUsage();
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error("Error:", err.message);
    process.exit(1);
  }
}

function printUsage() {
  const tempRange = useFahrenheit ? "41-97°F" : "5-36°C";
  const tempExample = useFahrenheit ? "72" : "21";

  console.log(`
Fireplace CLI - Control your Valor Fireplace from the terminal

Usage: fireplace-cli <command> [arguments] <ip>

Commands:
  on                          Turn on the fireplace
  off                         Turn off the fireplace
  status                      Get current fireplace status
  mode <mode>                 Set operation mode (manual, eco, temperature, off)
  temp <temperature>          Set temperature (${tempRange})

Configuration (.fireplace-config):
  FIREPLACE_IP               IP address of your fireplace
  TEMPERATURE_UNIT           Display unit: F (Fahrenheit) or C (Celsius) [default: F]

Environment Variables:
  FIREPLACE_IP               IP address of your fireplace (overrides config file)

Examples:
  fireplace-cli status 192.168.1.100
  fireplace-cli on 192.168.1.100
  fireplace-cli mode temperature 192.168.1.100
  fireplace-cli temp ${tempExample} 192.168.1.100
  
  # Using config file (.fireplace-config)
  fireplace-cli status
  fireplace-cli temp ${tempExample}
`);
}

function isValidIP(ip: string): boolean {
  // Basic IP validation
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(ip)) {
    return false;
  }

  const parts = ip.split(".");
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

main();
