import * as fs from "fs";
import * as path from "path";

export interface FireplaceConfig {
  ip?: string;
  temperatureUnit: "C" | "F";
}

export class ConfigReader {
  private static CONFIG_FILE = ".fireplace-config";

  /**
   * Read configuration from .fireplace-config file
   * Looks in current directory and parent directories
   */
  public static readConfig(): FireplaceConfig {
    const config: FireplaceConfig = {
      temperatureUnit: "F", // Default to Fahrenheit
    };

    const configPath = this.findConfigFile();
    if (!configPath) {
      return config;
    }

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (trimmed.startsWith("#") || trimmed === "") {
          continue;
        }

        // Parse KEY=VALUE format
        const [key, ...valueParts] = trimmed.split("=");
        const value = valueParts.join("=").trim();

        if (key.trim() === "FIREPLACE_IP" && value) {
          config.ip = value;
        } else if (key.trim() === "TEMPERATURE_UNIT" && value) {
          const unit = value.toUpperCase();
          if (unit === "C" || unit === "F") {
            config.temperatureUnit = unit as "C" | "F";
          }
        }
      }
    } catch (error) {
      // If config file cannot be read, return defaults
      console.error(
        `Warning: Could not read config file: ${(error as Error).message}`
      );
    }

    return config;
  }

  /**
   * Find .fireplace-config file in current directory or parent directories
   */
  private static findConfigFile(): string | null {
    let currentDir = process.cwd();
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      const configPath = path.join(currentDir, this.CONFIG_FILE);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
      currentDir = path.dirname(currentDir);
    }

    // Check root directory
    const rootConfigPath = path.join(root, this.CONFIG_FILE);
    if (fs.existsSync(rootConfigPath)) {
      return rootConfigPath;
    }

    return null;
  }
}
