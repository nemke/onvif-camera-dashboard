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

const { CameraDashboardTabSwipes, swipeDirection } = await import("../src/onvif-camera-dashboard.js");

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
  assert.equal(output.views.at(-1).type, "panel");
  assert.equal(output.views.at(-1).cards[0].type, "custom:onvif-camera-dashboard-manager");
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
  assert.match(manager.innerHTML, /Up to 2 columns/);
  manager._expandedGroupId = "area:front";
  manager.render();
  assert.match(manager.innerHTML, /Maximum columns on wide screens/);
  assert.match(manager.innerHTML, /<ha-selector data-group-id="area:front"/);
  assert.doesNotMatch(manager.innerHTML, /<label>Icon<input/);
  assert.doesNotMatch(manager.innerHTML, /<h3>Cameras/);
  assert.doesNotMatch(manager.innerHTML, /<label>Camera view/);
});

test("enabling the new-camera inbox records current ONVIF cameras", () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._hass = hass;
  manager._entries = entries;
  manager.render();
  manager._loading = true;
  manager._change({ target: {
    dataset: { field: "inbox_new_cameras" }, type: "checkbox", checked: true,
  } });
  assert.equal(manager._config.inbox_existing_camera_keys, undefined);
  manager._loading = false;
  manager._change({ target: {
    dataset: { field: "inbox_new_cameras" }, type: "checkbox", checked: true,
  } });
  assert.deepEqual(manager._config.inbox_existing_camera_keys, ["onvif:front"]);
  assert.match(manager.innerHTML, /data-field="inbox_new_cameras"\s+checked/);
  manager._change({ target: {
    dataset: { field: "inbox_new_cameras" }, type: "checkbox", checked: false,
  } });
  assert.equal(manager._config.inbox_existing_camera_keys, undefined);
});

test("manager retries dashboard settings after an initial load failure", async () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager.connectedCallback();
  let settingsLoads = 0;
  manager.hass = { ...hass, callWS: async (request) => {
    if (request.type === "lovelace/config") {
      settingsLoads += 1;
      if (settingsLoads === 1) throw new Error("Connection lost");
    }
    return hass.callWS(request);
  } };
  await manager._setupPromise;
  assert.match(manager.innerHTML, /Could not load dashboard settings: Connection lost/);
  assert.match(manager.innerHTML, /Retry loading settings/);

  await manager._click({ target: { dataset: { action: "retry-settings" } } });
  assert.equal(settingsLoads, 2);
  assert.equal(manager._ready, true);
  assert.match(manager.innerHTML, /Dashboard tabs/);
  assert.doesNotMatch(manager.innerHTML, /Retry loading settings/);
});

test("settings keeps camera tabs visible and folds away unused areas", () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._config = { type: "custom:onvif-camera-dashboard", group_by: "area" };
  manager._hass = { ...hass, areas: {
    ...hass.areas, garage: { area_id: "garage", name: "Garage" },
  } };
  manager._entries = entries;
  manager.render();
  assert.match(manager.innerHTML, /Other areas \(1\)/);
  assert.ok(manager.innerHTML.indexOf('data-group-id="area:front"')
    < manager.innerHTML.indexOf('class="other-groups"'));
  assert.ok(manager.innerHTML.indexOf('class="other-groups"')
    < manager.innerHTML.indexOf('data-group-id="area:garage"'));
});

test("settings separates the built-in Unassigned tab from custom tabs", () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._hass = hass;
  manager._config = { type: "custom:onvif-camera-dashboard", group_by: "custom",
    categories: [{ id: "custom:front", title: "Front Yard", icon: "mdi:gate" }] };
  manager.render();
  const customRow = manager.innerHTML.indexOf('data-group-id="custom:front"');
  const addTab = manager.innerHTML.indexOf('data-action="add-category"');
  const unassigned = manager.innerHTML.indexOf('class="unassigned-settings"');
  assert.ok(customRow < addTab && addTab < unassigned);
  assert.match(manager.innerHTML.slice(unassigned), /Built-in tab for cameras without a category/);
  assert.match(manager.innerHTML.slice(unassigned), /<ha-icon icon="mdi:inbox-outline"/);
  assert.match(manager.innerHTML, /class="icon-button accent" data-action="add-category"/);
  assert.doesNotMatch(manager.innerHTML.slice(unassigned), /data-action="remove-category"/);
});

test("tab rows expand one at a time and show movement limits", async () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._hass = hass;
  manager._config = { type: "custom:onvif-camera-dashboard", group_by: "custom", categories: [
    { id: "custom:front", title: "Front Yard", icon: "mdi:gate", max_columns: 4 },
    { id: "custom:back", title: "Back Yard", icon: "mdi:tree", max_columns: 2 },
  ] };
  manager.render();
  assert.doesNotMatch(manager.innerHTML, /data-field="title"/);
  await manager._click({ target: { dataset: { action: "edit-tab", groupId: "custom:front" } } });
  assert.match(manager.innerHTML, /data-field="title" data-group-id="custom:front"/);
  assert.doesNotMatch(manager.innerHTML, /data-field="title" data-group-id="custom:back"/);
  assert.match(manager.innerHTML, /data-offset="-1" disabled/);
  assert.match(manager.innerHTML, /data-offset="1" ><ha-icon icon="mdi:arrow-down"[^>]*><\/ha-icon>Move down/);
  assert.match(manager.innerHTML, /<ha-icon icon="mdi:gate"/);
  await manager._click({ target: { closest: () => ({ dataset: { action: "edit-tab", groupId: "custom:front" } }) } });
  assert.equal(manager._expandedGroupId, null);
});

test("removing a tab confirms its cameras move to Unassigned", async () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._ready = true;
  manager._hass = hass;
  manager._config = { type: "custom:onvif-camera-dashboard", group_by: "custom",
    categories: [{ id: "custom:front", title: "Front Yard" }],
    camera_options: { "onvif:front": { category: "custom:front" } } };
  manager._expandedGroupId = "custom:front";
  manager.render();
  assert.match(manager.innerHTML, /<ha-icon icon="mdi:view-dashboard-outline"/);
  await manager._click({ target: { dataset: { action: "remove-category", groupId: "custom:front" } } });
  assert.equal(manager._config.categories.length, 1);
  assert.match(manager.innerHTML, /Cameras assigned to this tab will move to Unassigned/);
  await manager._click({ target: { dataset: { action: "confirm-remove", groupId: "custom:front" } } });
  assert.equal(manager._config.categories.length, 0);
  assert.equal(manager._config.camera_options["onvif:front"].category, "__unassigned");
});

test("editing a tab name keeps the save control mounted", () => {
  const Manager = elements.get("onvif-camera-dashboard-manager");
  const manager = new Manager();
  manager._mode = "manage";
  const status = { textContent: "", className: "" };
  const save = { disabled: true };
  manager.querySelector = (selector) => selector === ".actions [role=status]" ? status
    : selector === '.actions [data-action="save"]' ? save : null;
  manager.render = () => { throw new Error("Changing a name must not replace the save button"); };
  manager._change({ target: {
    dataset: { field: "title", groupId: "area:front" }, value: "Front entrance",
  } });
  assert.equal(manager._config.group_options["area:front"].title, "Front entrance");
  assert.equal(manager._dirty, true);
  assert.equal(status.textContent, "Unsaved changes");
  assert.equal(save.disabled, false);
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
  const preview = { dataset: { iconPreview: "area:front" },
    setAttribute(name, value) { this[name] = value; } };
  manager.querySelectorAll = (selector) => selector === "[data-icon-preview]" ? [preview] : [picker];
  manager.render();
  assert.deepEqual(picker.selector, { icon: {} });
  assert.equal(picker.value, "mdi:gate");
  picker.onChange({ detail: { value: "mdi:cctv" }, stopPropagation() {} });
  assert.equal(manager._config.group_options["area:front"].icon, "mdi:cctv");
  assert.equal(preview.icon, "mdi:cctv");
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
  manager._dirty = true;
  await manager._save();
  const save = requests.find((request) => request.type === "lovelace/config/save");
  assert.equal(save.url_path, "camera-dashboard");
  assert.equal(save.config.background, "original");
  assert.equal(save.config.strategy.group_by, "floor");
  assert.equal(manager._dirty, false);
});

test("a camera tile saves only its own settings", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  const requests = [];
  const original = {
    strategy: {
      type: "custom:onvif-camera-dashboard", group_by: "area",
      camera_options: {
        "onvif:front": { name: "Front", order: 2 },
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
    image_entity: { value: "camera.front" },
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
    category: { value: "" }, name: { value: "" },
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
  }, option: {}, new_unassigned: true, image_entities: ["camera.front"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: true } };
  card._click({ target: { closest: () => ({ dataset: { action: "edit" } }) } });
  assert.equal(opened, true);
  assert.match(card.innerHTML, /<dialog class="camera-dialog"/);
  assert.match(card.innerHTML, /<details class="camera-advanced">/);
  assert.match(card.innerHTML, /<option value="__unassigned" selected>Unassigned<\/option>/);
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
  assert.match(card.innerHTML, /class="camera-shell is-hidden"/);
  assert.doesNotMatch(card.innerHTML, /class="camera-name"/);
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
  assert.match(card.innerHTML, /<span class="camera-name">Front camera<\/span>/);
  assert.match(card.innerHTML, /class="camera-expand"/);
  assert.match(card.innerHTML, /camera-view:hover \.camera-expand/);
  assert.match(card.innerHTML, /mdi:pencil/);
  assert.match(card.innerHTML, /width:44px; height:44px/);
  assert.deepEqual(card.getGridOptions(), { columns: 12, rows: "auto" });
  assert.doesNotMatch(card.innerHTML, /camera-toolbar/);
});

test("unavailable cameras have a clear tile state and failed previews can be retried", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  card.querySelector = () => null;
  card._mountPicture = () => {};
  card.setConfig({ camera_key: "onvif:hall", camera: {
    entity: "camera.hall", camera_image: "camera.hall", name: "Hallway",
  }, option: {}, image_entities: ["camera.hall"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: false }, states: { "camera.hall": { state: "unavailable" } } };
  assert.match(card.innerHTML, /Camera unavailable/);
  assert.doesNotMatch(card.innerHTML, /Retry preview/);
  card.hass = { user: { is_admin: false }, states: { "camera.hall": { state: "idle" } } };
  assert.doesNotMatch(card.innerHTML, /Camera unavailable/);
  card.hass = { user: { is_admin: false }, states: {} };
  assert.match(card.innerHTML, /Preview source missing/);
  card.hass = { user: { is_admin: false }, states: { "camera.hall": { state: "idle" } } };
  card._pictureError = "Could not create picture card";
  card.render();
  assert.match(card.innerHTML, /Preview failed/);
  assert.match(card.innerHTML, /Retry preview/);
  card._click({ target: { closest: () => ({ dataset: { action: "retry-preview" } }) } });
  assert.equal(card._pictureError, "");
  assert.doesNotMatch(card.innerHTML, /Preview failed/);
});

test("a broken Home Assistant camera image shows a retryable preview error", () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  card.querySelector = () => null;
  card._mountPicture = () => {};
  card.setConfig({ camera_key: "onvif:hall", camera: {
    entity: "camera.hall", camera_image: "camera.hall", name: "Hallway",
  }, option: {}, image_entities: ["camera.hall"], groups: [], group_by: "area" });
  card.hass = { user: { is_admin: false }, states: { "camera.hall": { state: "idle" } } };
  const oldObserver = globalThis.MutationObserver;
  const observers = [];
  let broken = false;
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  const imageRoot = { querySelector: (selector) => selector === "#brokenImage" && broken ? {} : null };
  card._picture = { shadowRoot: { querySelector: (selector) => selector === "hui-image"
    ? { shadowRoot: imageRoot } : null } };
  try {
    card._watchPicture();
    assert.equal(observers.length, 2);
    broken = true;
    observers[1].callback();
    assert.match(card.innerHTML, /Preview failed/);
    assert.match(card.innerHTML, /Retry preview/);
    broken = false;
    observers[1].callback();
    assert.doesNotMatch(card.innerHTML, /Preview failed/);
  } finally {
    card._disconnectPictureObservers();
    globalThis.MutationObserver = oldObserver;
  }
});

test("camera editor previews and saves a visual move within its tab", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  const cameraOptions = {
    "onvif:up": { name: "Up" }, "onvif:gate": { name: "Gate" },
    "onvif:wall": { name: "Wall" }, "onvif:other": { name: "Other", order: 9 },
  };
  card._config = { camera_key: "onvif:gate", option: {},
    camera: { entity: "camera.gate", name: "Gate" },
    viewer_cameras: [
      { key: "onvif:up", name: "Up" }, { key: "onvif:gate", name: "Gate" },
      { key: "onvif:wall", name: "Wall" },
    ] };
  card._open = true;
  const fields = {
    category: { value: "" }, name: { value: "Gate" },
    image_entity: { value: "camera.gate" }, camera_view: { value: "auto" },
    fit_mode: { value: "contain" }, hidden: { checked: false },
  };
  const list = { innerHTML: "" };
  const hint = { textContent: "" };
  const earlier = { disabled: false };
  const later = { disabled: false };
  const controls = { querySelector(selector) { return ({ ol: list,
    ".camera-reorder-hint": hint,
    'button[data-action="move-earlier"]': earlier,
    'button[data-action="move-later"]': later,
  })[selector]; } };
  card.querySelector = (selector) => ({
    ".camera-reorder": controls,
    "form[data-camera-editor]": { elements: { namedItem: (name) => fields[name] } },
  })[selector] || null;
  let saved;
  card._hass = { user: { is_admin: true }, callWS: async (request) => {
    if (request.type === "lovelace/config") return {
      strategy: { type: "custom:onvif-camera-dashboard", camera_options: cameraOptions },
    };
    if (request.type === "lovelace/config/save") saved = request.config;
  } };
  const oldDocument = globalThis.document;
  let toast;
  globalThis.document = { body: { append(element) { toast = element; } },
    getElementById: () => toast,
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
  };
  try {
    card._moveCamera(-1);
    assert.deepEqual(card._orderKeys(), ["onvif:gate", "onvif:up", "onvif:wall"]);
    assert.match(list.innerHTML, /class="current" aria-current="true">Gate/);
    assert.equal(hint.textContent, "Position 1 of 3");
    assert.equal(earlier.disabled, true);
    fields.category.value = "area:elsewhere";
    card._moveCamera(1);
    assert.deepEqual(card._orderKeys(), ["onvif:gate", "onvif:up", "onvif:wall"]);
    fields.category.value = "";
    await card._save();
    assert.equal(saved.strategy.camera_options["onvif:gate"].order, 1);
    assert.equal(saved.strategy.camera_options["onvif:up"].order, 2);
    assert.equal(saved.strategy.camera_options["onvif:wall"].order, 3);
    assert.deepEqual(saved.strategy.camera_options["onvif:other"], { name: "Other", order: 9 });
    assert.equal(toast.textContent, "Camera saved");
  } finally {
    globalThis.document = oldDocument;
  }
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
    assert.equal(created[0].show_name, false);
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

test("horizontal swipes change category tabs without affecting dialogs or vertical scrolling", () => {
  assert.equal(swipeDirection({ x: 250, y: 300 }, { x: 100, y: 310 }), 1);
  assert.equal(swipeDirection({ x: 250, y: 300 }, { x: 100, y: 480 }), 0);
  const listeners = {};
  const links = [];
  const browser = { location: { pathname: "/camera-dashboard/camera-front", search: "" },
    innerWidth: 390, addEventListener(type, handler) { listeners[type] = handler; } };
  const page = { body: { append() {} }, createElement() { return {
    set href(value) { this.url = value; }, click() { links.push(this.url); }, remove() {},
  }; } };
  const swipes = new CameraDashboardTabSwipes(browser, page);
  swipes.register("camera-dashboard", ["camera-front", "camera-back", "camera-house"]);
  const start = (x, y, path = []) => listeners.touchstart({
    touches: [{ identifier: 4, clientX: x, clientY: y }], composedPath: () => path,
  });
  const end = (x, y) => listeners.touchend({
    touches: [], changedTouches: [{ identifier: 4, clientX: x, clientY: y }],
    preventDefault() {},
  });
  start(250, 300); end(100, 310);
  assert.deepEqual(links, ["/camera-dashboard/camera-back"]);
  browser.location.pathname = "/camera-dashboard/camera-back";
  start(100, 300); end(250, 310);
  assert.deepEqual(links, ["/camera-dashboard/camera-back", "/camera-dashboard/camera-front"]);
  browser.location.pathname = "/camera-dashboard/camera-front";
  start(250, 300); end(100, 480);
  assert.equal(links.length, 2);
  start(250, 300, [{ tagName: "DIALOG" }]); end(100, 310);
  assert.equal(links.length, 2);
  start(10, 300); end(100, 310);
  assert.equal(links.length, 2);
  browser.location.pathname = "/camera-dashboard/manage";
  start(250, 300); end(100, 310);
  assert.equal(links.length, 2);
});

test("viewer swipe stays within its camera category and updates the live source", async () => {
  const Card = elements.get("onvif-camera-dashboard-camera-card");
  const card = new Card();
  const created = [];
  const originalLoad = window.loadCardHelpers;
  window.loadCardHelpers = async () => ({ createCardElement(config) {
    created.push(config);
    return { remove() {} };
  } });
  const title = { textContent: "" };
  const position = { textContent: "" };
  const previous = { disabled: false };
  const next = { disabled: false };
  const viewerListeners = {};
  const dialog = { addEventListener(type, handler, options) {
    viewerListeners[type] = { handler, options };
  }, showModal() {}, close() {} };
  card.querySelector = (selector) => ({
    ".camera-picture": { replaceChildren() {} },
    ".viewer-stage": { replaceChildren() {} },
    "dialog.camera-viewer": dialog,
    "#camera-viewer-title": title,
    ".viewer-position": position,
    "button[data-action=previous-camera]": previous,
    "button[data-action=next-camera]": next,
  })[selector] || null;
  try {
    card.setConfig({ camera_key: "onvif:gate", camera: {
      entity: "camera.gate", camera_image: "camera.gate", name: "Gate", camera_view: "auto",
    }, option: {}, image_entities: ["camera.gate"], groups: [], group_by: "area",
    viewer_cameras: [
      { key: "onvif:gate", name: "Gate", image_entity: "camera.gate" },
      { key: "onvif:wall", name: "Wall", image_entity: "camera.wall" },
    ] });
    card.hass = { user: { is_admin: false } };
    await card._picturePromise;
    card._click({ target: { closest: () => ({ dataset: { action: "view" } }) } });
    await card._mountViewer();
    assert.equal(created.at(-1).entity, "camera.gate");
    assert.equal(created.at(-1).aspect_ratio, undefined);
    assert.equal(created.at(-1).fit_mode, "contain");
    assert.equal(viewerListeners.touchstart.options.capture, true);
    assert.equal(viewerListeners.touchend.options.capture, true);
    assert.equal(viewerListeners.touchend.options.passive, false);
    assert.equal(viewerListeners.touchcancel.options.capture, true);
    let prevented = false;
    const start = (touches) => viewerListeners.touchstart.handler({ touches, composedPath: () => [] });
    const end = (x, y) => viewerListeners.touchend.handler({ touches: [],
      changedTouches: [{ identifier: 7, clientX: x, clientY: y }],
      preventDefault() { prevented = true; },
    });
    start([{ identifier: 7, clientX: 250, clientY: 300 }]);
    start([{ identifier: 7, clientX: 250, clientY: 300 },
      { identifier: 8, clientX: 270, clientY: 300 }]);
    end(100, 310);
    assert.equal(prevented, false);
    assert.equal(card._viewerIndex, 0);
    start([{ identifier: 7, clientX: 250, clientY: 300 }]);
    end(100, 310);
    assert.equal(prevented, true);
    await card._mountViewer();
    assert.equal(card._viewerIndex, 1);
    assert.equal(created.at(-1).entity, "camera.wall");
    assert.equal(title.textContent, "Wall");
    assert.equal(position.textContent, "2 / 2");
    assert.equal(next.disabled, true);
    assert.equal(card._selectViewer(2), false);
    card._click({ target: { closest: () => ({ dataset: { action: "previous-camera" } }) } });
    await card._mountViewer();
    assert.equal(card._viewerIndex, 0);
    assert.equal(created.at(-1).entity, "camera.gate");
    card._closeViewer(false);
  } finally {
    window.loadCardHelpers = originalLoad;
  }
});
