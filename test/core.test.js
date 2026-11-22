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
  assert.deepEqual(dashboard.views.map((view) => view.title), ["Front Yard", "Hall", "Manage"]);
  assert.equal(dashboard.views[0].sections[0].cards.length, 3);
  assert.equal(dashboard.views[0].sections[0].cards[1].type, "custom:onvif-camera-dashboard-camera-card");
  assert.equal(dashboard.views[0].sections[0].cards[1].camera.fit_mode, "contain");
  assert.equal(dashboard.views[0].sections[0].cards[1].camera_key, "onvif:gate-001");
  const viewer = generateDashboard({ group_by: "area" }, { ...hass, user: { is_admin: false } }, entries);
  assert.equal(viewer.views[0].sections[0].cards[1].type, "picture-entity");
});

test("a newly registered ONVIF camera appears without editing the dashboard config", () => {
  const config = { group_by: "area" };
  const before = generateDashboard(config, hass, entries.slice(0, 1));
  const after = generateDashboard(config, hass, entries.slice(0, 2));
  assert.equal(before.views[0].sections[0].cards.length, 2);
  assert.equal(after.views[0].sections[0].cards.length, 3);
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
  assert.equal(dashboard.views[0].sections[0].cards[1].camera.name, "Wall");
  assert.equal(dashboard.views[1].sections[0].cards[1].camera.camera_image, "camera.hall_profile000");
  const matched = importDashboard(source, {}, entries);
  assert.equal(matched.config.camera_options["onvif:hall-001"].image_entity, "camera.hall_profile000");
});
