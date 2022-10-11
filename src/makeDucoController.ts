import { DucoApi } from "./DucoApi";
import { Logger } from "./Logger";

export enum DucoVentilationLevel {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  AUTO = "AUTO",
}

const ventilationLevels: { [key: string]: DucoVentilationLevel | undefined } = {
  100: DucoVentilationLevel.HIGH,
  50: DucoVentilationLevel.MEDIUM,
  0: DucoVentilationLevel.LOW,
  255: DucoVentilationLevel.AUTO,
};

export type DucoController = ReturnType<typeof makeDucoController>;

interface DucoControllerProps {
  logger: Logger;
  host: string;
  node: number;
  getControllerCount: () => number;
  // This is called when the controller notices the ventilation level changed.
  setOn: (value: boolean) => void;
  setRotationSpeed: (value: number) => void;
  setCarbonDioxideLevel: (value: number) => void;
  setCurrentRelativeHumidity: (value: number) => void;
  flagAsNotResponding: () => void;
  ducoApi: DucoApi;
  isInitiallyOn: boolean;
}

export const getVentilationLevel = (overrule: number) =>
  ventilationLevels[overrule];

export const makeDucoController = ({
  logger,
  node,
  getControllerCount,
  setOn,
  setRotationSpeed,
  setCarbonDioxideLevel,
  setCurrentRelativeHumidity,
  flagAsNotResponding,
  ducoApi,
  isInitiallyOn,
}: DucoControllerProps) => {
  let ventilationLevel: DucoVentilationLevel | undefined = undefined;

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

      const level = getVentilationLevel(nodeInfo.overrule);

      if (level === ventilationLevel) {
        logger.info(`Ventilation level is still ${ventilationLevel}`);
      } else {
        if (!ventilationLevel) {
          logger.info(`Ventilation level after startup = ${level}`);
        } else {
          logger.info(`New ventilation level = ${level}`);

          // Update the service proactively so this value is always up-to-date (and not just when
          // browsing through the accessories).
          setOn(level === DucoVentilationLevel.HIGH);
        }

        ventilationLevel = level;
      }
    } catch (error) {
      if (!ventilationLevel) {
        logger.error(
          `Could not receive ventilation level and also no fallback available`,
          error
        );
      } else {
        logger.info(
          `Could not receive new ventilation level. Falling back to old ventilation level which may be out of date.`,
          error
        );
      }

      flagAsNotResponding();
    }
  };

  restartInterval();

  const onSet = async (val: boolean) => {
    const newVentilationLevel = val
      ? DucoVentilationLevel.HIGH
      : DucoVentilationLevel.AUTO;

    logger.info(`Setting ventilation level to '${newVentilationLevel}'`);

    try {
      const valueString = Object.keys(ventilationLevels).find(
        (key) => ventilationLevels[parseInt(key, 10)] === newVentilationLevel
      );
      if (!valueString) {
        throw new Error(
          `Failed to set ventilation level to '${newVentilationLevel}', because value could not be determined.`
        );
      }

      const value = parseInt(valueString, 10);
      await ducoApi.updateOverrule(node, value);

      ventilationLevel = newVentilationLevel;

      logger.info(
        `Ventilation level set to '${newVentilationLevel}' (${value})`
      );

      // We re-start the interval just to avoid checking the ventilation level
      // again a second after we just updated it.
      restartInterval();
    } catch (e) {
      logger.error(
        `Could not set ventilation level to '${ventilationLevel}' because of an error`,
        e
      );

      throw e;
    }
  };

  const onGet = async () => {
    // When we have not been able to fetch the ventilation level, we cannot return any default value or previous value, and we're not
    // allowed to await a promise here.
    if (ventilationLevel === undefined) {
      if (isInitiallyOn !== undefined) {
        return isInitiallyOn
          ? DucoVentilationLevel.HIGH
          : DucoVentilationLevel.AUTO;
      }

      // TODO: should we add the Reachable characteristic to configure whether the accessory works or
      // not? Initially I assumed throwing a service communication failuture error would result in
      // flagging the accessory as not reachable, but now I found the reachable characteristic and
      // I'm not sure anymore.
      throw new Error(`No ventilation level available yet`);
    }

    return ventilationLevel === DucoVentilationLevel.HIGH;
  };

  refreshVentilationLevel();

  return {
    cleanUp() {
      clearInterval(interval);
    },
    onGet,
    onSet,
  };
};
