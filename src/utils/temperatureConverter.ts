/**
 * Temperature conversion utilities
 */
export class TemperatureConverter {
  /**
   * Convert Celsius to Fahrenheit
   */
  public static celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9/5) + 32;
  }

  /**
   * Convert Fahrenheit to Celsius
   */
  public static fahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5/9;
  }

  /**
   * Format temperature for display with proper unit
   */
  public static formatTemperature(celsius: number, useFahrenheit: boolean = true): string {
    if (useFahrenheit) {
      return `${Math.round(this.celsiusToFahrenheit(celsius))}°F`;
    }
    return `${celsius.toFixed(1)}°C`;
  }

  /**
   * Get valid temperature range message
   */
  public static getValidRangeMessage(useFahrenheit: boolean = true): string {
    if (useFahrenheit) {
      return `Valid range: ${this.celsiusToFahrenheit(5).toFixed(0)}-${this.celsiusToFahrenheit(36).toFixed(0)}°F (41-97°F)`;
    }
    return 'Valid range: 5-36°C';
  }

  /**
   * Validate and convert input temperature to Celsius
   */
  public static validateAndConvert(temp: number, useFahrenheit: boolean = true): number | null {
    if (useFahrenheit) {
      // Convert F to C for validation
      const celsius = this.fahrenheitToCelsius(temp);
      if (celsius < 5 || celsius > 36) {
        return null;
      }
      return celsius;
    } else {
      if (temp < 5 || temp > 36) {
        return null;
      }
      return temp;
    }
  }
}
