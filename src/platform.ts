import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
  CharacteristicValue,
  Perms,
} from "homebridge";
import { makeBonjour } from "./Bonjour";
import { makeDucoApi } from "./DucoApi";

import { PLATFORM_NAME, PLUGIN_NAME } from "./settings";
import {
  DucoNodeConfig,
  DucoNodeConfigVLVRH,
  DucoNodeConfigVLVCO2,
  DucoDeviceType,
  getDeviceTypePrimaryServiceType,
  getDeviceTypeLabel,
  DucoDeviceMode,
  getTargetFanState,
  getActive,
  getCurrentHumidifierDehumidifierState,
  getCurrentAirPurifierState,
} from "./DucoInterpretation"
import {
  DucoController,
  DucoVentilationLevel,
  getVentilationLevel,
  makeDucoController,
} from "./makeDucoController";
import { makeLogger } from "./Logger";

interface DucoAccessoryContext {
  host: string;
  serialNumber: string;
  softwareVersion: string;
  type: DucoDeviceType; // Necessary for device type-specific services & characteristics.
  node: number;
  config: DucoNodeConfig;
  // State.
  isOn: boolean;
  rotationSpeed: number;
}

type DucoAccessory = PlatformAccessory<DucoAccessoryContext>;

interface AccessoryBundle {
  accessory: DucoAccessory;
  controller: DucoController;
}

export class DucoHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly bundles = new Map<string, AccessoryBundle>();
  private discoverRetryTimeout: NodeJS.Timeout | undefined = undefined;

  private controllerCount: number = 0;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.log.info(`Starting DUCO plugin`);

    this.api.on("didFinishLaunching", () => {
      this.discoverDevices();
    });

    this.api.on(`shutdown`, () => {
      if (this.discoverRetryTimeout) {
        clearTimeout(this.discoverRetryTimeout);
        this.discoverRetryTimeout = undefined;
      }

      this.bundles.forEach(({ controller, accessory }) => {
        controller.cleanUp();

        accessory
          .getService(getDeviceTypePrimaryServiceType(accessory.context.type))
          ?.getCharacteristic(this.api.hap.Characteristic.Active)
          .removeOnGet()
          .removeOnSet();
      });
    });
  }

  getControllerCount(): number {
    return this.controllerCount;
  }

  configureAccessory(accessory: DucoAccessory) {
    // For backwards compatibility with one of the first versions, we ignore any accessories without a context (and those will be re-added
    // anyway when searching for all the nodes).
    if (
      !accessory.context ||
      !accessory.context.host ||
      !accessory.context.type ||
      !accessory.context.node ||
      !accessory.context.config ||
      !accessory.context.rotationSpeed
    ) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);

      this.log.info(
        `Unregistering accessory '${accessory.displayName}' (${accessory.UUID}) because context is invalid. It's probably from an older version. Going to re-add the same accessory once discovery is finished.`
      );
      return;
    }

    const controller = this.createController(accessory);
    this.bundles.set(accessory.UUID, {
      accessory,
      controller,
    });
  }

  private makeReadonly(c: Characteristic, v?: CharacteristicValue) {
    const readonlyPerms = [
      Perms.PAIRED_READ,
      Perms.NOTIFY,
    ];
    c.setProps({perms: c.props.perms.filter(function (p) {
      return readonlyPerms.includes(p);
    })});
    if (v !== undefined) {
      c.updateValue(v);
    }
  }

  private createController(accessory: DucoAccessory) {
    this.log.info(
      `Loading accessory '${accessory.displayName}' (${accessory.context.host}#${accessory.context.node} ${accessory.context.isOn}) from cache`
    );

    // Track the number of controllers: this impacts the update frequency.
    this.controllerCount++;

    const api = this.api;
    const primaryServiceType = getDeviceTypePrimaryServiceType(accessory.context.type);
    const service =
      accessory.getService(primaryServiceType) ||
      accessory.addService(primaryServiceType);
    service.setPrimaryService();
    service.setCharacteristic(this.api.hap.Characteristic.Name, accessory.displayName);
    if (!service.getCharacteristic(this.api.hap.Characteristic.RotationSpeed)) {
      service.addCharacteristic(this.api.hap.Characteristic.RotationSpeed);
    }
    this.makeReadonly(service.getCharacteristic(this.api.hap.Characteristic.RotationSpeed));
    this.makeReadonly(service.getCharacteristic(this.api.hap.Characteristic.Active));
    switch (accessory.context.type) {
      case DucoDeviceType.BOX:
        // Static values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.TargetAirPurifierState),
          this.api.hap.Characteristic.TargetAirPurifierState.AUTO
        );
        // Dynamic values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.CurrentAirPurifierState),
        );
        break;
      case DucoDeviceType.VLVCO2:
        // Static values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.TargetAirPurifierState),
          this.api.hap.Characteristic.TargetAirPurifierState.AUTO
        );
        const co2Config = <DucoNodeConfigVLVCO2>accessory.context.config;
        if (!service.getCharacteristic(this.api.hap.Characteristic.CarbonDioxideLevel)) {
          service.addCharacteristic(this.api.hap.Characteristic.CarbonDioxideLevel);
        }
        // Dynamic values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.CurrentAirPurifierState),
        );
        break;
      case DucoDeviceType.VLVRH:
        // Static values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.TargetHumidifierDehumidifierState),
          this.api.hap.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER
        );
        const rhConfig = <DucoNodeConfigVLVRH>accessory.context.config;
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.RelativeHumidityDehumidifierThreshold),
          rhConfig.setpoint
        );
        // Dynamic values.
        this.makeReadonly(
          service.getCharacteristic(this.api.hap.Characteristic.CurrentHumidifierDehumidifierState),
        );
        break;
    }

    accessory
      .getService(this.api.hap.Service.AccessoryInformation)
      ?.setCharacteristic(this.api.hap.Characteristic.Manufacturer, "DUCO")
      ?.setCharacteristic(this.api.hap.Characteristic.Model, getDeviceTypeLabel(accessory.context.type))
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, accessory.context.serialNumber)
      .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, accessory.context.softwareVersion);

    const logger = makeLogger(
      this.log,
      `[${accessory.context.host}#${accessory.context.node}]`
    );
    const ducoApi = makeDucoApi(accessory.context.host);
    const ducoPlatform = this;
    const controller = makeDucoController({
      ducoApi,
      host: accessory.context.host,
      node: accessory.context.node,
      isInitiallyOn: accessory.context.isOn,
      logger,
      getControllerCount() {
        return ducoPlatform.getControllerCount();
      },
      setRotationSpeed(value) {
        switch (accessory.context.type) {
          case DucoDeviceType.VLVRH:
            service.updateCharacteristic(api.hap.Characteristic.CurrentHumidifierDehumidifierState, getCurrentHumidifierDehumidifierState(<DucoNodeConfigVLVRH>accessory.context.config, value));
            break;
          case DucoDeviceType.BOX:
          case DucoDeviceType.VLVCO2:
            service.updateCharacteristic(api.hap.Characteristic.CurrentAirPurifierState, getCurrentAirPurifierState(<DucoNodeConfigVLVCO2>accessory.context.config, value));
            break;
        }
        service.updateCharacteristic(api.hap.Characteristic.RotationSpeed, value);
        service.updateCharacteristic(api.hap.Characteristic.Active, getActive(accessory.context.config, value));
        accessory.context.rotationSpeed = value;
      },
      setTargetFanState(value) {
        if (accessory.context.type === DucoDeviceType.VLVRH) {
        }
        else {
          service.updateCharacteristic(api.hap.Characteristic.TargetFanState, getTargetFanState(value as DucoDeviceMode));
        }
      },
      setCarbonDioxideLevel(value) {
        service.updateCharacteristic(api.hap.Characteristic.CarbonDioxideLevel, value);
      },
      setCurrentRelativeHumidity(value) {
        service.updateCharacteristic(api.hap.Characteristic.CurrentRelativeHumidity, value);
      },
      setOn(value) {
        service.updateCharacteristic(api.hap.Characteristic.On, value);
        accessory.context.isOn = value;
      },
      flagAsNotResponding() {
        service.updateCharacteristic(
          api.hap.Characteristic.On,
          new Error(`not responding`) as any
        );
      },
    });

    service
      .getCharacteristic(this.api.hap.Characteristic.On)
      // The Characteristic.On should have a set handler of (val: boolean) instead of (val: CharacteristicValue)
      .onSet(async (anyValue) => {
        const value = anyValue as boolean;
        await controller.onSet(value);
        accessory.context.isOn = value;
      })
      .onGet(controller.onGet);
    return controller;
  }

  createAccessoryIdentifier(serialNumber: string) {
    return this.api.hap.uuid.generate(serialNumber);
  }

  private createAccessory(
    UUID: string,
    serialNumber: string,
    softwareVersion: string,
    name: string,
    type: DucoDeviceType,
    ducoHost: string,
    node: number,
    config: DucoNodeConfig,
    // State.
    isOn: boolean,
    rotationSpeed: number,
  ) {
    const accessory = new this.api.platformAccessory<DucoAccessoryContext>(
      name,
      UUID
    );
    accessory.context = {
      host: ducoHost,
      serialNumber,
      softwareVersion,
      node,
      type,
      config,
      // State.
      isOn,
      rotationSpeed,
    };
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      accessory,
    ]);
    return accessory;
  }

  async discoverDevices() {
    // Just in case, we'll clear any pending retry timeout in case we ever call this
    // multiple times from different places.
    if (this.discoverRetryTimeout) {
      clearTimeout(this.discoverRetryTimeout);
      this.discoverRetryTimeout = undefined;
    }

    this.log.info(`Searching for DUCO instance`);

    const bonjour = makeBonjour({});

    // TODO: at some point it makes sense to first find all matching hosts, and then query
    // the board info API to check whether we found an actual DUCO instance (or someone
    // pretending to be a DUCO instance). But for now we just find the first http service
    // starting with the name DUCO.
    const ducoHost = await bonjour.findFirst(`http`, `DUCO `);

    if (!ducoHost) {
      this.log.warn(
        "Could not find any DUCO instance on your local network. Going to retry in 30 seconds."
      );

      this.discoverRetryTimeout = setTimeout(
        this.discoverDevices.bind(this),
        1000 * 30
      );
      return;
    }

    const ducoApi = makeDucoApi(ducoHost);

    // TODO: maybe there is something we can use to verify whether this is a real
    // DUCO instance or a weird http service? We still call the board info API just
    // to verify whether the host works.
    await ducoApi.getBoardInfo();

    const nodesInfo = await ducoApi.findNodes();

    for (const node of nodesInfo.nodes) {
      try {
        const nodeInfo = await ducoApi.getNodeInfo(node);
        if (!Object.values(DucoDeviceType).includes(nodeInfo.type as DucoDeviceType)) {
          this.log.debug("Ignoring unsupported device type:", nodeInfo);
          continue;
        }
        const type = nodeInfo.type as DucoDeviceType;
        const serialNumber : string = nodeInfo.serialNumber;
        const softwareVersion : string = nodeInfo.softwareVersion;

        // Ignore nodes without a location, because they lead to a horrible UX.
        if (nodeInfo.location === "") {
          this.log.info(
            `Ignoring node ${nodeInfo.node} because it does not have a location set. Configure a location first using the Duco Communication Print UI, then it will appear here after restarting Homebridge. Make sure the location matches one of your room names.`
          );
          continue;
        }

        const config = await ducoApi.getNodeConfig(node);

        const initialVentilationLevel = getVentilationLevel(nodeInfo.overrule);
        const isOn = initialVentilationLevel === DucoVentilationLevel.HIGH;
        const rotationSpeed = nodeInfo.actl;

        const UUID = this.createAccessoryIdentifier(nodeInfo.serialNumber);
        const bundle = this.bundles.get(UUID);
        if (bundle) {
          const { controller: existingController, accessory } = bundle;
          if (
            accessory.context.host === ducoHost &&
            accessory.context.node === node
          ) {
            // The bundles was already registered and the host and node are correct, so we don't have to do anything.
            continue;
          }

          // The host or node of the accessory was changed. We set the new
          // host and node and need to remove the old controller and create
          // a new controller.
          accessory.context = {
            serialNumber,
            softwareVersion,
            host: ducoHost,
            node,
            type,
            config,
            // State.
            isOn,
            rotationSpeed,
          };

          existingController.cleanUp();

          const controller = this.createController(accessory);
          this.bundles.set(UUID, {
            accessory,
            controller,
          });
        } else {
          const type = nodeInfo.type as DucoDeviceType;
          const name = `${nodeInfo.location} ${getDeviceTypeLabel(type)}`;

          // We use the serial number as identifier data to avoid accessories changing
          // when new nodes join or the duco host changes.
          const accessory = this.createAccessory(
            UUID,
            serialNumber,
            softwareVersion,
            name,
            type,
            ducoHost,
            node,
            config,
            // State.
            isOn,
            rotationSpeed
          );

          const controller = this.createController(accessory);
          this.bundles.set(UUID, {
            controller,
            accessory,
          });
        }
      } catch (e) {
        // TODO: there is probably a plethora of nodes, such as sensors, or errors, we should ignore or recover from.

        this.log.error(
          `Not adding DUCO node #${node} because of a failure when adding. This node will be skipped even though the error may be recoverable. You must restart the plugin if you wish to retry. Please report a bug on GitHub if you encounter this error with all the node info and the error details.`,
          e
        );
      }
    }
  }
}
