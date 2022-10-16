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

const errorMargin = 5;

/**
 * Active.
 */
export const getActive = (config: DucoNodeConfig, actual: number): CharacteristicValue => {
  const autoMin = config.autoMin;
  if (actual > autoMin + errorMargin) {
    return Characteristic.Active.ACTIVE;
  }
  return Characteristic.Active.INACTIVE;
};

/**
 * Current Humidifier/Dehumidifier State.
 */
export const getCurrentHumidifierDehumidifierState = (config: DucoNodeConfigVLVRH, actual: number): CharacteristicValue => {
  const autoMin = config.autoMin;
  if (actual > autoMin + errorMargin) {
    return Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING;
  }
  if (autoMin - errorMargin <= actual && actual <= autoMin + errorMargin) {
    return Characteristic.CurrentHumidifierDehumidifierState.IDLE;
  }
  return Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
};

/**
 * Current Air Purifier State.
 */
export const getCurrentAirPurifierState = (config: DucoNodeConfigVLVCO2, actual: number): CharacteristicValue => {
  const autoMin = config.autoMin;
  if (actual > autoMin + errorMargin) {
    return Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
  }
  if (autoMin - errorMargin <= actual && actual <= autoMin + errorMargin) {
    return Characteristic.CurrentAirPurifierState.IDLE;
  }
  return Characteristic.CurrentAirPurifierState.INACTIVE;
};
