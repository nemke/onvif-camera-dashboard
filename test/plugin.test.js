import test from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
globalThis.HTMLElement = class {
  constructor() { this.isConnected = true; this.innerHTML = ""; }
  addEventListener() {}
  dispatchEvent() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
};
globalThis.customElements = {
  define(name, element) { elements.set(name, element); },
  get(name) { return elements.get(name); },
  async whenDefined(name) { assert.ok(elements.has(name)); },
};
elements.set("hui-heading-card", class {
  static async getConfigElement() { elements.set("ha-selector", class {}); }
});
globalThis.window = {
  customStrategies: [], location: { pathname: "/camera-dashboard/manage" },
  loadCardHelpers: async () => ({ createCardElement: () => ({ localName: "hui-heading-card" }) }),
};

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
  assert.deepEqual(output.views.map((view) => view.title), ["Front Yard", "Settings"]);
});

test("manager loads dashboard settings when hass arrives after connection", async () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager.connectedCallback();
  assert.match(manager.innerHTML, /Loading dashboard settings/);
  manager.hass = hass;
  await manager._setupPromise;
  await manager._loadIconPicker();
  assert.equal(manager._config.group_by, "area");
  assert.match(manager.innerHTML, /Front Yard/);
  assert.match(manager.innerHTML, /Dashboard tabs/);
  assert.match(manager.innerHTML, /Camera columns/);
  assert.match(manager.innerHTML, /<ha-selector data-group-id="area:front"/);
  assert.doesNotMatch(manager.innerHTML, /<label>Icon<input/);
  assert.doesNotMatch(manager.innerHTML, /<h3>Cameras/);
  assert.doesNotMatch(manager.innerHTML, /<label>Camera view/);
});

test("tab icon choice updates the selected tab", () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._iconPickerReady = true;
  manager._hass = hass;
  manager._dashboardPath = "camera-dashboard";
  const picker = {
    dataset: { groupId: "area:front", icon: "mdi:gate" },
    addEventListener(type, handler) { if (type === "value-changed") this.onChange = handler; },
  };
  manager.querySelectorAll = () => [picker];
  manager.render();
  assert.deepEqual(picker.selector, { icon: {} });
  assert.equal(picker.value, "mdi:gate");
  picker.onChange({ detail: { value: "mdi:cctv" }, stopPropagation() {} });
  assert.equal(manager._config.group_options["area:front"].icon, "mdi:cctv");
  assert.equal(manager._status, "Unsaved changes");
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

test("a camera tile saves only its own settings", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  const requests = [];
  const original = {
    strategy: {
      type: "custom:onvif-camera-dashboard", group_by: "area",
      camera_options: {
        "onvif:front": { name: "Front" },
        "onvif:other": { name: "Other", hidden: true },
      },
    },
    background: "original",
  };
  card._config = {
    camera_key: "onvif:front", option: { name: "Front" },
    camera: { entity: "camera.front", name: "Front" },
  };
  card._hass = { user: { is_admin: true }, callWS: async (request) => {
    requests.push(request);
    if (request.type === "lovelace/config") return original;
    if (request.type === "lovelace/config/save") return;
    throw new Error(`Unexpected request ${request.type}`);
  } };
  const fields = {
    category: { value: "area:front" }, name: { value: " Front gate " },
    order: { value: "2" }, image_entity: { value: "camera.front" },
    camera_view: { value: "auto" }, fit_mode: { value: "contain" },
    hidden: { checked: false },
  };
  card.querySelector = () => ({ elements: { namedItem: (name) => fields[name] } });
  card.render = () => {};
  let refreshed = false;
  card.dispatchEvent = (event) => { refreshed = event.type === "config-refresh"; };
  await card._save();
  const saved = requests.find((request) => request.type === "lovelace/config/save").config;
  assert.equal(saved.background, "original");
  assert.deepEqual(saved.strategy.camera_options["onvif:other"], { name: "Other", hidden: true });
  assert.equal(saved.strategy.camera_options["onvif:front"].name, "Front gate");
  assert.equal(saved.strategy.camera_options["onvif:front"].order, 2);
  assert.equal(refreshed, true);
  assert.equal(card._open, false);
});

test("hiding a camera leaves its former tab", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  card._config = { camera_key: "onvif:front", camera: { entity: "camera.front" }, option: {} };
  card._hass = { user: { is_admin: true }, callWS: async (request) => {
    if (request.type === "lovelace/config") return {
      strategy: { type: "custom:onvif-camera-dashboard", camera_options: {} },
    };
  } };
  const fields = {
    category: { value: "" }, name: { value: "" }, order: { value: "0" },
    image_entity: { value: "camera.front" }, camera_view: { value: "auto" },
    fit_mode: { value: "contain" }, hidden: { checked: true },
  };
  card.querySelector = () => ({ elements: { namedItem: (name) => fields[name] } });
  card.render = () => {};
  let refreshed = false;
  card.dispatchEvent = (event) => { refreshed = event.type === "config-refresh"; };
  await card._save();
  assert.equal(refreshed, true);
});

test("opening a camera editor closes the previous one", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const first = new Card();
  const second = new Card();
  first._hass = { user: { is_admin: true } };
  second._hass = { user: { is_admin: true } };
  first.render = () => {};
  second.render = () => {};
  const edit = { target: { closest: () => ({ dataset: { action: "edit" } }) } };
  first._click(edit);
  assert.equal(first._open, true);
  second._click(edit);
  assert.equal(first._open, false);
  assert.equal(second._open, true);
  second.disconnectedCallback();
});

test("camera editor uses a modal with common and advanced settings", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  let opened = false;
  const dialog = { addEventListener() {}, showModal() { opened = true; }, close() {} };
  card.querySelector = (selector) => selector === "dialog.camera-dialog" ? dialog : null;
  card._mountPicture = () => {};
  card.setConfig({ camera_key: "onvif:front", camera: {
    entity: "camera.front", name: "Front camera", camera_image: "camera.front",
  }, option: {}, image_entities: ["camera.front"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: true } };
  card._click({ target: { closest: () => ({ dataset: { action: "edit" } }) } });
  assert.equal(opened, true);
  assert.match(card.innerHTML, /<dialog class="camera-dialog"/);
  assert.match(card.innerHTML, /<details class="camera-advanced">/);
  assert.ok(card.innerHTML.indexOf("Display name") < card.innerHTML.indexOf("Advanced settings"));
  card._closeEditor();
  assert.equal(card._open, false);
});

test("camera tile shows admin controls when hass arrives after configuration", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  let renders = 0;
  card.render = () => { renders++; };
  card.hass = { user: { is_admin: true } };
  assert.equal(renders, 1);
});

test("a hidden camera renders an admin placeholder with an edit button", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  card.querySelector = () => null;
  card.setConfig({ camera_key: "onvif:front", camera: {
    entity: "camera.front", name: "Front camera", camera_image: "camera.front",
  }, option: { hidden: true }, image_entities: ["camera.front"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: true } };
  assert.match(card.innerHTML, /Hidden from dashboard/);
  assert.match(card.innerHTML, /Edit camera/);
  assert.doesNotMatch(card.innerHTML, /camera-toolbar/);
  assert.doesNotMatch(card.innerHTML, /class="camera-picture"/);
  assert.doesNotMatch(card.innerHTML, /class="camera-view"/);
});

test("a visible camera has a compact edit control over its picture", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  card.querySelector = () => null;
  card._mountPicture = () => {};
  card.setConfig({ camera_key: "onvif:front", camera: {
    entity: "camera.front", name: "Front camera", camera_image: "camera.front",
  }, option: {}, image_entities: ["camera.front"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: true } };
  assert.match(card.innerHTML, /class="camera-edit"/);
  assert.match(card.innerHTML, /mdi:pencil/);
  assert.match(card.innerHTML, /width:44px; height:44px/);
  assert.deepEqual(card.getGridOptions(), { columns: 12, rows: "auto" });
  assert.doesNotMatch(card.innerHTML, /camera-toolbar/);
});

test("camera viewer loads the selected stream only while open, including for viewers", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  const created = [];
  const originalLoad = window.loadCardHelpers;
  let removed = false;
  let focused = false;
  let onCancel;
  const stage = { replaceChildren() {} };
  const picture = { replaceChildren() {} };
  const dialog = { addEventListener(type, handler) { if (type === "cancel") onCancel = handler; },
    showModal() {}, close() {} };
  card.querySelector = (selector) => ({
    ".camera-picture": picture,
    ".viewer-stage": stage,
    "dialog.camera-viewer": dialog,
    ".camera-view": { focus() { focused = true; } },
  })[selector] || null;
  window.loadCardHelpers = async () => ({ createCardElement(config) {
    created.push(config);
    return { remove() { removed = true; } };
  } });
  try {
    card.setConfig({ camera_key: "onvif:front", camera: {
      entity: "camera.front_profile001", camera_image: "camera.front_profile000",
      name: "Front camera", camera_view: "auto", fit_mode: "contain",
    }, option: {}, image_entities: ["camera.front_profile000"], groups: [], group_by: "area" });
    card.hass = { user: { is_admin: false } };
    await card._picturePromise;
    assert.equal(created.length, 1);
    assert.doesNotMatch(card.innerHTML, /class="camera-edit"/);
    assert.match(card.innerHTML, /class="camera-view"/);
    card._click({ target: { closest: () => ({ dataset: { action: "view" } }) } });
    await card._mountViewer();
    assert.equal(created.length, 2);
    assert.equal(created[1].camera_view, "live");
    assert.equal(created[1].entity, "camera.front_profile000");
    assert.equal(created[1].fit_mode, "contain");
    assert.match(card.innerHTML, /class="camera-viewer"/);
    card._click({ target: { closest: () => ({ dataset: { action: "close-viewer" } }) } });
    assert.equal(removed, true);
    assert.equal(focused, true);
    assert.equal(card._viewerOpen, false);
    card._click({ target: { closest: () => ({ dataset: { action: "view" } }) } });
    await card._mountViewer();
    let prevented = false;
    onCancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(card._viewerOpen, false);
  } finally {
    window.loadCardHelpers = originalLoad;
  }
});
