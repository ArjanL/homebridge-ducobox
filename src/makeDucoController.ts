import { DucoApi } from "./DucoApi";
import { Logger } from "./Logger";

export type DucoController = ReturnType<typeof makeDucoController>;

interface DucoControllerProps {
  logger: Logger;
  host: string;
  node: number;
  getControllerCount: () => number;
  setRotationSpeed: (value: number) => void;
  setCarbonDioxideLevel: (value: number) => void;
  setCurrentRelativeHumidity: (value: number) => void;
  flagAsNotResponding: () => void;
  ducoApi: DucoApi;
}

export const makeDucoController = ({
  logger,
  node,
  getControllerCount,
  setRotationSpeed,
  setCarbonDioxideLevel,
  setCurrentRelativeHumidity,
  flagAsNotResponding,
  ducoApi,
}: DucoControllerProps) => {
  let intervalBasedOnControllerCount: number = 0;
  const computeInterval = (): number => {
    intervalBasedOnControllerCount = getControllerCount();
    return intervalBasedOnControllerCount * 4 * 1000;
  };
  let interval: NodeJS.Timeout;
  // The interval may be restarted for two reasons:
  // 1. Immediately after a write.
  // 2. The controller count has changed.
  const restartInterval = () => {
    clearInterval(interval);
    interval = setInterval(
      refreshVentilationLevel,
      computeInterval()
    );
  };

  const refreshVentilationLevel = async () => {
    try {
      const nodeInfo = await ducoApi.getNodeInfo(node);

      // Restart the interval if the controller count has changed.
      if (getControllerCount() !== intervalBasedOnControllerCount) {
        restartInterval();
      }

      // Characteristics applying to all Duco device types.
      setRotationSpeed(nodeInfo.actl);

      // Device-type specific characteristics.
      switch (nodeInfo.type) {
        case "VLVCO2":
          setCarbonDioxideLevel(nodeInfo.co2);
          break;
        case "VLVRH":
          setCurrentRelativeHumidity(nodeInfo.rh);
          break;
      }
    } catch (error) {
      logger.error(error);
      flagAsNotResponding();
    }
  };

  restartInterval();
  refreshVentilationLevel();

  return {
    cleanUp() {
      clearInterval(interval);
    },
  };
};
