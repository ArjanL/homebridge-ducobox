import http from 'node:http';
import fetch from "node-fetch";
import AbortController from "abort-controller";
import {
  DucoDeviceType,
  DucoDeviceMode,
  DucoNodeConfig,
  DucoNodeConfigBOX,
  DucoNodeConfigVLVRH,
  DucoNodeConfigVLVCO2,
} from "./DucoInterpretation"

export type DucoApi = ReturnType<typeof makeDucoApi>;

const ducoCommunicationPrintHttpAgent = new http.Agent({
  // Empirically, it seems the DucoBox Communication Print cannot handle >2
  // concurrent requests.
  maxSockets: 2,
});

/*
function getRequestQueueLength(): number {
  const a = ducoCommunicationPrintHttpAgent.requests;
  const keys = Object.keys(a);
  if (keys.length === 0) {
    return 0;
  }

  const ducoQueue = a[keys[0]];
  return typeof ducoQueue !== 'undefined' ? ducoQueue.length : -1;
};
*/

export const makeDucoApi = (host: string) => {
  const request = async (url: string, isWrite: boolean = false) => {
    // if (!isWrite) { console.log('request queue size', Object.keys(ducoCommunicationPrintHttpAgent.requests), getRequestQueueLength()); }
    const response = await fetch(`http://${host}${url}`, {
      timeout: 1000 * 10,
      // Use the agent to queue read requests; write requests should happen instantly.
      agent: isWrite ? undefined : ducoCommunicationPrintHttpAgent,
    });
    if (!response.ok) {
      throw new Error(
        `Receive invalid HTTP response ${response.status} when calling ${host}${url}`
      );
    }
    return response;
  };

  return {
    async findNodes(): Promise<{ nodes: number[] }> {
      const response = await request(`/nodelist?t=${new Date().getTime()}`);
      const json = await response.json();
      return {
        nodes: json.nodelist,
      };
    },

    async getBoardInfo(): Promise<{
      serial: string;
      uptime: number;
      softwareVersion: string;
      mac: string;
      ip: string;
    }> {
      const response = await request(`/board_info?t=${new Date().getTime()}`);

      const json = await response.json();
      return {
        serial: json.serial,
        uptime: json.uptime,
        softwareVersion: json.swversion,
        mac: json.mac,
        ip: json.ip,
      };
    },

    async updateOverrule(node: number, value: number): Promise<void> {
      const response = await request(
        `/nodesetoverrule?node=${node}&value=${value}`,
        true
      );
      const result = await response.text();
      const isSuccess = result === `SUCCESS`;
      if (!isSuccess) {
        throw new Error(
          `Could not set overrule to value '${value}' on '${host}#${node}' because response was '${result}'`
        );
      }
    },

    async getNodeInfo(node: number): Promise<{
      // Robustness: new device types may be added, so a arbitrary strings.
      type: DucoDeviceType | string;
      overrule: number;
      serialNumber: string;
      softwareVersion: string;
      node: number;
      location: string;
      co2: number;
      rh: number;
      mode: DucoDeviceMode;
      actl: number;
    }> {
      const response = await request(`/nodeinfoget?node=${node}`);
      const json = await response.json();

      /*
      {
        "node": 1,
        "devtype": "BOX",
        "subtype": 1,
        "netw": "VIRT",
        "addr": 1,
        "sub": 1,
        "prnt": 0,
        "asso": 0,
        "location": "",
        "state": "AUTO",
        "cntdwn": 0,
        "endtime": 0,
        "mode": "AUTO",
        "trgt": 10,
        "actl": 10,
        "ovrl": 255,
        "snsr": 0,
        "cerr": 0,
        "swversion": "16056.10.4.0",
        "serialnb": "PS2113001384",
        "temp": 0,
        "co2": 0,
        "rh": 0,
        "error": "W.00.00.00",
        "show": 0,
        "link": 0
      }
      */
      return {
        type: json.devtype,
        overrule: json.ovrl,
        serialNumber: json.serialnb,
        softwareVersion: json.swversion,
        node: json.node,
        location: json.location,
        // Sensor: CO2 or RH.
        co2: json.co2,
        rh: json.rh,
        mode: json.mode as DucoDeviceMode,
        // Actual fan speed.
        actl: json.actl,
      };
    },

    async getNodeConfig(node: number): Promise<Readonly<DucoNodeConfig>> {
      const response = await request(`/nodeconfigget?node=${node}`);
      const json = await response.json();
      var config = {
        node: json.node,
        autoMin: json.AutoMin.Val,
        autoMax: json.AutoMax.Val,
        capacity: json.Capacity.Val,
        manual1: json.Manual1.Val,
        manual2: json.Manual2.Val,
        manual3: json.Manual3.Val,
        manualTimeout: json.ManualTimeout.Val,
        location: json.Location,
      };
      if (json.RHSetpoint) {
        return {
          type: DucoDeviceType.VLVRH,
          ...config,
          setpoint: json.RHSetpoint.Val,
          delta: json.RHDelta.Val,
        } as DucoNodeConfigVLVRH;
      }
      else if (json.CO2Setpoint) {
        return {
          type: DucoDeviceType.VLVCO2,
          ...config,
          setpoint: json.CO2Setpoint.Val,
          tempDependent: json.TempDependent.Val,
        } as DucoNodeConfigVLVCO2;
      }
      else {
        return {
          type: DucoDeviceType.BOX,
          ...config,
        } as DucoNodeConfigBOX;
      }
    },
  };
};
