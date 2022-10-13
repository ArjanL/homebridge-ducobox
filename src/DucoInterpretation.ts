import {
  Characteristic,
  CharacteristicValue,
} from "hap-nodejs";

/**
 * Per-device type node configuration.
 */
export type DucoNodeConfig = DucoNodeConfigBOX | DucoNodeConfigVLVRH | DucoNodeConfigVLVCO2;
export type DucoNodeConfigCommon = {
  type: DucoDeviceType;
  node: number;
  autoMin: number;
  autoMax: number;
  capacity: number;
  manual1: number;
  manual2: number;
  manual3: number;
  manualTimeout: number;
  location: string;
}
export type DucoNodeConfigBOX = DucoNodeConfigCommon & {
  type: DucoDeviceType.BOX;
}
export type DucoNodeConfigVLVRH = DucoNodeConfigCommon & {
  type: DucoDeviceType.VLVRH;
  setpoint: number;
  delta: number;
}
export type DucoNodeConfigVLVCO2 = DucoNodeConfigCommon & {
  type: DucoDeviceType.VLVCO2;
  setpoint: number;
  tempDependent: number;
}

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
 * Supported device modes, for the TargetFanState characteristic.
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

/**
 * Current Fan State.
 */
export const getCurrentFanState = (autoMin: number, actual: number): CharacteristicValue => {
  const errorMargin = 2;
  if (actual > autoMin + errorMargin) {
    return Characteristic.CurrentFanState.BLOWING_AIR;
  }
  if (autoMin - errorMargin <= actual && actual <= autoMin + errorMargin) {
    return Characteristic.CurrentFanState.IDLE;
  }
  return Characteristic.CurrentFanState.INACTIVE;
};