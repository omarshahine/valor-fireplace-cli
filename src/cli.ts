#!/usr/bin/env node

import { FireplaceCliController } from "./controllers/fireplaceCliController";
import { ProtocolExplorer } from "./controllers/protocolExplorer";
import { OperationMode } from "./models/operationMode";
import { FireplaceStatus } from "./models/fireplaceStatus";
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

// Commands that don't require an IP (e.g. they scan or print help).
const NO_IP_COMMANDS = new Set(["discover", "help", "--help", "-h"]);

const ip = process.env.FIREPLACE_IP || config.ip || args[args.length - 1];

if (!NO_IP_COMMANDS.has(command)) {
  if (!ip || !isValidIP(ip)) {
    console.error("Error: Invalid or missing IP address.");
    console.error(
      "Either set FIREPLACE_IP environment variable or provide IP as last argument."
    );
    console.error("Example: valor-cli status 192.168.1.100");
    process.exit(1);
  }
}

async function main() {
  try {
    switch (command) {
      case "on":
        await new FireplaceCliController(ip, useFahrenheit).turnOn();
        break;

      case "off":
        await new FireplaceCliController(ip, useFahrenheit).turnOff();
        break;

      case "status":
        await new FireplaceCliController(ip, useFahrenheit).getStatus();
        break;

      case "mode": {
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
        await new FireplaceCliController(ip, useFahrenheit).setMode(mode);
        break;
      }

      case "temp":
      case "temperature": {
        if (args.length < 2) {
          console.error("Error: Temperature command requires a temperature value.");
          console.error(TemperatureConverter.getValidRangeMessage(useFahrenheit));
          process.exit(1);
        }
        const tempInput = parseFloat(args[1]);
        const tempInCelsius = TemperatureConverter.validateAndConvert(tempInput, useFahrenheit);
        if (isNaN(tempInput) || tempInCelsius === null) {
          console.error(`Error: Invalid temperature '${args[1]}'.`);
          console.error(TemperatureConverter.getValidRangeMessage(useFahrenheit));
          process.exit(1);
        }
        const roundedTempInCelsius = Math.round(tempInCelsius * 10) / 10;
        await new FireplaceCliController(ip, useFahrenheit).setTemperature(roundedTempInCelsius);
        break;
      }

      case "probe":
        await runProbe(ip, args.slice(1));
        break;

      case "raw":
        await runRaw(ip, args.slice(1));
        break;

      case "watch":
        await runWatch(ip, args.slice(1));
        break;

      case "discover":
        console.error("Error: 'discover' is not implemented yet. See PROTOCOL.md for context.");
        process.exit(2);
        break;

      case "help":
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
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

/**
 * `valor-cli probe [--timeout=ms] [ip]`
 *
 * Open TCP, send status request, measure round-trip time, exit 0 if reachable.
 * Designed for diagnosing the WiFi module's red+green stuck state: if the
 * probe still succeeds in that state, local control is unaffected and the
 * fault is isolated to the cloud bridge.
 */
async function runProbe(ip: string, rest: string[]) {
  const flags = parseFlags(rest);
  const timeoutMs = parseInt(String(flags.timeout ?? 5000), 10);

  console.log(`Probing ${ip}:2000 (timeout ${timeoutMs}ms)...`);
  const result = await ProtocolExplorer.probe(ip, timeoutMs);

  if (result.reachable) {
    console.log(`✓ Reachable in ${result.rttMs}ms`);
    console.log(`  Response bytes: ${result.responseBytes}`);
    console.log(`  Status packet:  ${result.statusPacketValid ? "valid (106 chars)" : "non-standard"}`);
    process.exit(0);
  } else {
    console.log(`✗ Unreachable after ${result.rttMs}ms`);
    if (result.error) console.log(`  Error: ${result.error}`);
    process.exit(1);
  }
}

/**
 * `valor-cli raw <hex> [--bare] [--no-etx] [--timeout=ms] [ip]`
 *
 * Send arbitrary hex bytes and dump the response. Defaults to wrapping the
 * input as STX + bridge prefix + <input> + ETX, matching the existing
 * controller's framing. Use --bare to send raw bytes verbatim.
 *
 * Intended for protocol exploration: discovering unmapped GV60 commands,
 * looking for a soft-reset opcode, observing module response to malformed
 * input.
 */
async function runRaw(ip: string, rest: string[]) {
  const flags = parseFlags(rest);
  const positional = rest.filter((a) => !a.startsWith("--"));
  // Last positional may be the IP; if there are 2+ positionals and the last
  // looks like an IP, exclude it from hex input.
  let hexParts = positional;
  if (positional.length > 1 && isValidIP(positional[positional.length - 1])) {
    hexParts = positional.slice(0, -1);
  }
  const hexInput = hexParts.join("");

  if (!hexInput) {
    console.error("Error: raw command requires a hex string.");
    console.error("Example: valor-cli raw 303303              # status request (with prefix+ETX)");
    console.error("Example: valor-cli raw 02333030383003 --bare  # send literal bytes");
    process.exit(1);
  }

  const usePrefix = !flags.bare;
  const appendEtx = Boolean(flags["add-etx"]);
  const timeoutMs = parseInt(String(flags.timeout ?? 2000), 10);

  console.log(`Sending to ${ip}:2000`);
  console.log(`  Mode:    ${usePrefix ? "framed (prefix + input" + (appendEtx ? " + ETX)" : ")") : "bare (verbatim)"}`);
  console.log(`  Input:   ${hexInput}`);
  console.log(`  Timeout: ${timeoutMs}ms\n`);

  const result = await ProtocolExplorer.sendRaw(ip, hexInput, {
    prefix: usePrefix,
    appendEtx,
    timeoutMs,
  });

  if (result.error) {
    console.log(`✗ Error: ${result.error}`);
  }
  console.log(`Sent (${Math.floor(result.sentHex.length / 2)} bytes): ${result.sentHex}`);
  console.log(`Received (${result.receivedBytes} bytes in ${result.totalMs}ms):`);
  if (result.receivedHex) {
    console.log(`  hex:    ${result.receivedHex}`);
    const ascii = Buffer.from(result.receivedHex, "hex").toString("ascii").replace(/[\x00-\x1f\x7f]/g, ".");
    console.log(`  ascii:  ${ascii}`);
  } else {
    console.log("  (none)");
  }
  if (result.framedPackets.length > 0) {
    console.log(`\nFramed packets (${result.framedPackets.length}):`);
    for (let i = 0; i < result.framedPackets.length; i++) {
      const p = result.framedPackets[i];
      console.log(`  [${i}] (${p.length} chars) ${p}`);
    }
  }

  process.exit(result.error ? 1 : 0);
}

/**
 * `valor-cli watch [--interval=ms] [ip]`
 *
 * Long-running status tail with timestamps. Useful for observing module
 * behavior over time and capturing state transitions. Exits cleanly on Ctrl+C.
 */
async function runWatch(ip: string, rest: string[]) {
  const flags = parseFlags(rest);
  const intervalMs = parseInt(String(flags.interval ?? 5000), 10);

  console.log(`Watching ${ip}:2000 (poll every ${intervalMs}ms). Press Ctrl+C to stop.\n`);

  const handle = ProtocolExplorer.tail(
    ip,
    (payload) => {
      const ts = new Date().toISOString();
      if (payload.length === 106) {
        try {
          const status = new FireplaceStatus(payload);
          const cur = TemperatureConverter.formatTemperature(status.currentTemperature, useFahrenheit);
          const tgt = TemperatureConverter.formatTemperature(status.targetTemperature, useFahrenheit);
          const flame = status.guardFlameOn ? "on" : "off";
          const ign = status.igniting ? " IGN" : "";
          const sd = status.shuttingDown ? " SHD" : "";
          const aux = status.auxOn ? " AUX" : "";
          console.log(
            `${ts}  ${OperationMode[status.mode].padEnd(11)}  cur=${cur}  tgt=${tgt}  pilot=${flame}${ign}${sd}${aux}`,
          );
        } catch {
          console.log(`${ts}  [unparseable status] ${payload.slice(0, 32)}...`);
        }
      } else {
        console.log(`${ts}  [non-status frame, ${payload.length} chars] ${payload.slice(0, 64)}`);
      }
    },
    intervalMs,
  );

  process.on("SIGINT", () => {
    console.log("\nStopping...");
    handle.stop();
  });

  await handle.done;
  process.exit(0);
}

/**
 * Tiny --flag=value parser. Returns flags as an object; --foo without a value
 * becomes { foo: true }. Does not mutate the input array.
 */
function parseFlags(input: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of input) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq < 0) {
      out[body] = true;
    } else {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }
  return out;
}

function printUsage() {
  const tempRange = useFahrenheit ? "41-97°F" : "5-36°C";
  const tempExample = useFahrenheit ? "72" : "21";

  console.log(`
Valor CLI - Control your Valor Fireplace from the terminal

Usage: valor-cli <command> [arguments] [ip]

Commands:
  on                          Turn on the fireplace
  off                         Turn off the fireplace
  status                      Get current fireplace status
  mode <mode>                 Set operation mode (manual, eco, temperature, off)
  temp <temperature>          Set temperature (${tempRange})

Diagnostic commands:
  probe                       Quick liveness check with RTT (exit 0 if reachable)
  raw <hex>                   Send hex command, dump response (protocol exploration)
  watch                       Tail status updates with timestamps until Ctrl+C
  discover                    Scan local subnet for fireplaces (not yet implemented)

Flags (where applicable):
  --timeout=<ms>              Override default timeout
  --bare                      raw: send literal bytes, no prefix
  --add-etx                   raw: append 0x03 (ETX) after input bytes
  --interval=<ms>             watch: poll interval (default 5000)

Configuration (.fireplace-config):
  FIREPLACE_IP                IP address of your fireplace
  TEMPERATURE_UNIT            Display unit: F or C [default: F]

Environment Variables:
  FIREPLACE_IP                IP address (overrides config file)

Examples:
  valor-cli status 192.168.1.100
  valor-cli on
  valor-cli temp ${tempExample}
  valor-cli probe                          # liveness check
  valor-cli raw 303303                     # status request via raw
  valor-cli raw ff --timeout=3000          # probe an unmapped opcode
  valor-cli watch --interval=10000         # tail status every 10s

See PROTOCOL.md for B6R-WME / Mertik GV60 protocol details.
`);
}

function isValidIP(ip: string): boolean {
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
