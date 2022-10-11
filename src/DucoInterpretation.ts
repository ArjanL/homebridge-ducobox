import {
  Characteristic,
  CharacteristicValue,
} from "hap-nodejs";

/**
 * Supported device types.
 */
export enum DucoDeviceType {
  // A Ducobox.
  BOX = "BOX",
  // A valve reacting to relative humidity.
  VLVRH = "VLVRH",
  // A valve reacting to CO2.
  VLVCO2 = "VLVCO2",
}

const deviceTypeLabels: { [key in DucoDeviceType]: string } = {
  BOX: "DucoBox",
  VLVRH: "Humidity Control Valve",
  VLVCO2: "CO2 Control Valve",
};
export const getDeviceTypeLabel = (deviceType: DucoDeviceType): string =>
  deviceTypeLabels[deviceType];

/**
 * Supported device modes.
 */
export enum DucoDeviceMode {
  // AUTOmatic.
  AUTO = "AUTO",
  // EXTerNal override (?).
  EXTN = "EXTN",
}
const deviceModeToTargetFanState: { [key in DucoDeviceMode]: CharacteristicValue } = {
  AUTO: Characteristic.TargetFanState.AUTO,
  EXTN: Characteristic.TargetFanState.MANUAL,
};
export const getTargetFanState = (mode: DucoDeviceMode): CharacteristicValue => deviceModeToTargetFanState[mode]
