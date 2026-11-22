import test from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
globalThis.HTMLElement = class {
  constructor() { this.isConnected = true; this.innerHTML = ""; }
  addEventListener() {}
  dispatchEvent() {}
};
globalThis.customElements = {
  define(name, element) { elements.set(name, element); },
  get(name) { return elements.get(name); },
};
globalThis.window = { customStrategies: [], location: { pathname: "/camera-dashboard/manage" } };

await import("../src/onvif-camera-dashboard.js");

const entries = [{
  entity_id: "camera.front", unique_id: "front", platform: "onvif", device_id: "device-front",
}];
const hass = {
  entities: {},
  areas: { front: { area_id: "front", name: "Front Yard" } },
  floors: {},
  devices: { "device-front": { area_id: "front" } },
  states: {},
  user: { is_admin: true },
  callWS: async (request) => {
    if (request.type === "config/entity_registry/list") return entries;
    if (request.type === "lovelace/config") return {
      strategy: { type: "custom:onvif-camera-dashboard", group_by: "area" },
    };
    if (request.type === "lovelace/dashboards/list") return [];
    throw new Error(`Unexpected request ${request.type}`);
  },
};

test("plugin registers a community dashboard strategy and generates an admin manager", async () => {
  assert.equal(window.customStrategies[0].strategyType, "dashboard");
  const Strategy = elements.get("ll-strategy-dashboard-onvif-camera-dashboard");
  const output = await Strategy.generate({ group_by: "area" }, hass);
  assert.deepEqual(output.views.map((view) => view.title), ["Front Yard", "Manage"]);
});

test("manager loads dashboard settings when hass arrives after connection", async () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager.connectedCallback();
  assert.match(manager.innerHTML, /Loading dashboard settings/);
  manager.hass = hass;
  await manager._setupPromise;
  assert.equal(manager._config.group_by, "area");
  assert.match(manager.innerHTML, /Front Yard/);
});

test("manager saves only the current strategy dashboard", async () => {
  const requests = [];
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager.connectedCallback();
  manager.hass = {
    ...hass,
    callWS: async (request) => {
      requests.push(request);
      if (request.type === "config/entity_registry/list") return entries;
      if (request.type === "lovelace/dashboards/list") return [];
      if (request.type === "lovelace/config") return {
        strategy: { type: "custom:onvif-camera-dashboard", group_by: "area" },
        background: "original",
      };
      if (request.type === "lovelace/config/save") return;
      throw new Error(`Unexpected request ${request.type}`);
    },
  };
  await manager._setupPromise;
  manager._config = { ...manager._config, group_by: "floor" };
  await manager._save();
  const save = requests.find((request) => request.type === "lovelace/config/save");
  assert.equal(save.url_path, "camera-dashboard");
  assert.equal(save.config.background, "original");
  assert.equal(save.config.strategy.group_by, "floor");
});
