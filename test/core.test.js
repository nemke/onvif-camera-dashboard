import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraKey, eligibleCameras, generateDashboard, groupForCamera, importDashboard,
} from "../src/core.js";

const hass = {
  areas: {
    front: { area_id: "front", name: "Front Yard", floor_id: "outside", icon: "mdi:gate" },
    hall: { area_id: "hall", name: "Hall", floor_id: "ground" },
  },
  floors: {
    outside: { floor_id: "outside", name: "Outside" },
    ground: { floor_id: "ground", name: "Ground Floor" },
  },
  devices: { d1: { area_id: "front" }, d2: { area_id: "hall" } },
  states: {
    "camera.gate_profile001": { attributes: { friendly_name: "Gate" } },
    "camera.gate_profile101": { attributes: { friendly_name: "Gate secondary" } },
    "camera.hall_profile001": { attributes: { friendly_name: "Hallway" } },
  },
  user: { is_admin: true },
};
const entries = [
  { entity_id: "camera.gate_profile001", unique_id: "gate-001", platform: "onvif", device_id: "d1" },
  { entity_id: "camera.gate_profile101", unique_id: "gate-101", platform: "onvif", device_id: "d1" },
  { entity_id: "camera.hall_profile001", unique_id: "hall-001", platform: "onvif", device_id: "d2" },
  { entity_id: "camera.other", unique_id: "other", platform: "generic", device_id: "d1" },
  { entity_id: "camera.disabled", unique_id: "disabled", platform: "onvif", disabled_by: "user" },
];

test("only enabled ONVIF camera entities are included, with profiles kept separate", () => {
  assert.deepEqual(eligibleCameras(entries).map((entry) => entry.entity_id), [
    "camera.gate_profile001", "camera.gate_profile101", "camera.hall_profile001",
  ]);
  const dashboard = generateDashboard({ group_by: "area" }, hass, entries);
  assert.deepEqual(dashboard.views.map((view) => view.title), ["Front Yard", "Hall", "Settings"]);
  assert.equal(dashboard.views[0].max_columns, 2);
  assert.equal(dashboard.views[0].sections.length, 2);
  assert.equal(dashboard.views[0].sections[0].cards[0].type, "custom:onvif-camera-dashboard-camera-card");
  assert.equal(dashboard.views[0].sections[0].cards[0].camera.fit_mode, "contain");
  assert.equal(dashboard.views[0].sections[0].cards[0].camera_key, "onvif:gate-001");
  assert.deepEqual(dashboard.views[0].sections[0].cards[0].viewer_cameras.map((camera) => camera.key),
    ["onvif:gate-001", "onvif:gate-101"]);
  const viewer = generateDashboard({ group_by: "area" }, { ...hass, user: { is_admin: false } }, entries);
  assert.equal(viewer.views[0].sections[0].cards[0].type, "custom:onvif-camera-dashboard-camera-card");
  assert.equal(viewer.views[0].sections[0].cards[0].camera.tap_action.action, "none");
});

test("a newly registered ONVIF camera appears without editing the dashboard config", () => {
  const config = { group_by: "area" };
  const before = generateDashboard(config, hass, entries.slice(0, 1));
  const after = generateDashboard(config, hass, entries.slice(0, 2));
  assert.equal(before.views[0].sections.length, 1);
  assert.equal(after.views[0].sections.length, 2);
});

test("camera columns control the maximum number of responsive sections", () => {
  const config = { group_by: "area", group_options: { "area:front": { max_columns: 1 } } };
  const one = generateDashboard(config, hass, entries.slice(0, 2));
  assert.equal(one.views[0].max_columns, 1);
  assert.equal(one.views[0].sections.length, 2);
  config.group_options["area:front"].max_columns = 4;
  assert.equal(generateDashboard(config, hass, entries.slice(0, 2)).views[0].max_columns, 4);
});

test("hidden cameras move to an admin-only recovery tab", () => {
  const config = { group_by: "area", camera_options: {
    [cameraKey(entries[0])]: { hidden: true },
  } };
  const admin = generateDashboard(config, hass, entries.slice(0, 2));
  const viewer = generateDashboard(config, { ...hass, user: { is_admin: false } }, entries.slice(0, 2));
  assert.deepEqual(admin.views.map((view) => view.title), ["Front Yard", "Hidden", "Settings"]);
  assert.equal(admin.views[1].show_icon_and_title, true);
  assert.equal(admin.views[2].show_icon_and_title, true);
  assert.deepEqual(viewer.views.map((view) => view.title), ["Front Yard"]);
  assert.equal(admin.views[0].sections.length, 1);
  assert.equal(admin.views[0].sections[0].cards[0].camera.entity, entries[1].entity_id);
  assert.equal(admin.views[1].sections[0].cards[1].option.hidden, true);
  assert.equal(admin.views[1].sections[0].cards[1].camera.entity, entries[0].entity_id);
  assert.equal(viewer.views[0].sections[0].cards.length, 1);
  const allHidden = generateDashboard(config, hass, entries.slice(0, 1));
  assert.deepEqual(allHidden.views.map((view) => view.title), ["Hidden", "Settings"]);
});

test("area and floor assignment follow Home Assistant registries, with an override", () => {
  assert.equal(groupForCamera(entries[0], { group_by: "floor" }, hass), "floor:outside");
  assert.equal(groupForCamera(entries[2], { group_by: "area" }, hass), "area:hall");
  const config = { group_by: "area", camera_options: { [cameraKey(entries[0])]: { category: "area:hall" } } };
  assert.equal(groupForCamera(entries[0], config, hass), "area:hall");
});

test("import preserves tabs, order, and a different image entity", () => {
  const source = { views: [
    { title: "Front Yard", path: "front-yard", max_columns: 2, sections: [{ cards: [
      { type: "heading", heading: "Front Yard", icon: "mdi:fridge" },
      { type: "picture-entity", entity: "camera.gate_profile101", name: "Wall", camera_view: "auto" },
      { type: "picture-entity", entity: "camera.gate_profile001", name: "Gate" },
    ] }] },
    { title: "House", sections: [{ cards: [
      { type: "picture-entity", entity: "camera.hall_profile001", name: "Hallway",
        camera_image: "camera.hall_profile000", fit_mode: "contain" },
    ] }] },
  ] };
  const { config, importedCameras } = importDashboard(source);
  assert.equal(importedCameras, 3);
  assert.equal(config.categories[0].icon, "mdi:fridge");
  assert.equal(config.categories[0].max_columns, 2);
  assert.equal(config.camera_options["camera.hall_profile001"].image_entity, "camera.hall_profile000");
  const dashboard = generateDashboard(config, hass, entries);
  assert.equal(dashboard.views[0].title, "Front Yard");
  assert.equal(dashboard.views[0].sections[0].cards[0].camera.name, "Wall");
  assert.equal(dashboard.views[1].sections[0].cards[0].camera.camera_image, "camera.hall_profile000");
  const matched = importDashboard(source, {}, entries);
  assert.equal(matched.config.camera_options["onvif:hall-001"].image_entity, "camera.hall_profile000");
});
