export enum OperationMode {
    Off = 1,
    Manual = 2,
    Temperature = 3,
    Eco = 4
}

export class OperationModeUtils {
  public static needsIgnite(mode: OperationMode) : boolean {
    switch(mode) {
      case OperationMode.Eco:
      case OperationMode.Manual:
      case OperationMode.Temperature:
        return true;
      default:
        return false;
    }
  }
}
