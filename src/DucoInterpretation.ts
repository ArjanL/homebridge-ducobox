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
export const getDeviceTypeLabel = (deviceType: DucoDeviceType) =>
  deviceTypeLabels[deviceType];
