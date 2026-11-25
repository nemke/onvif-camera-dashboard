import { STRATEGY_TYPE, UNASSIGNED, cameraKey, cameraOption, eligibleCameras, generateDashboard, groupsFor, importDashboard } from "./core.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

const styles = `
  <style>
    :host { display:block; color:var(--primary-text-color); font:inherit; }
    .panel { box-sizing:border-box; width:min(100%,820px); margin:0 auto; padding:20px;
      container-type:inline-size;
      background:var(--ha-card-background,var(--card-background-color,#fff));
      border:1px solid var(--divider-color,#ddd); border-radius:12px; }
    h2 { margin:0 0 12px; font-size:1.25rem; } h3 { margin:24px 0 10px; font-size:1rem; }
    p, .hint { color:var(--secondary-text-color,#666); margin:8px 0 16px; }
    .row { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin:10px 0; }
    label { display:flex; flex-direction:column; gap:4px; font-size:.87rem; min-width:130px; flex:1; }
    input, select, button { box-sizing:border-box; font:inherit; border-radius:6px; }
    input, select { min-height:38px; padding:6px 8px; color:var(--primary-text-color);
      background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#aaa); }
    input[type=checkbox] { min-height:auto; width:18px; height:18px; }
    label.check { flex:none; min-width:auto; flex-direction:row; align-items:center; }
    button { min-height:38px; padding:7px 12px; border:1px solid var(--divider-color,#aaa);
      background:var(--secondary-background-color,#eee); color:var(--primary-text-color); cursor:pointer; }
    button.primary { background:#005b83;
      background:color-mix(in srgb,var(--primary-color,#03a9f4) 45%,black);
      border-color:transparent; color:#fff; }
    button:disabled { opacity:.5; cursor:default; }
    .tab-entry { margin:8px 0; border:1px solid var(--divider-color,#ddd); border-radius:8px; overflow:hidden; }
    .tab-summary { display:flex; align-items:center; gap:12px; padding:10px 12px; min-height:42px; }
    .tab-summary ha-icon { flex:none; color:var(--secondary-text-color,#666); }
    .tab-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
    .tab-meta { color:var(--secondary-text-color,#666); font-size:.85rem; white-space:nowrap; }
    .tab-summary button { flex:none; }
    .tab-editor { border-top:1px solid var(--divider-color,#ddd); padding:14px 12px; }
    .tab-fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) 145px;
      gap:12px; align-items:end; }
    .tab-fields label, .tab-fields .icon-field { min-width:0; width:100%; }
    .tab-fields label input { width:100%; }
    .icon-field { display:flex; flex-direction:column; gap:4px; font-size:.87rem; }
    .icon-field ha-selector { display:block; width:100%; }
    .icon-field .hint { margin:4px 0; }
    .tab-help { font-size:.82rem; margin:8px 0 0; }
    .tab-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
    .tab-actions .remove-tab { margin-left:auto; }
    .remove-confirm { margin-top:12px; padding:12px; border:1px solid var(--divider-color,#ddd);
      border-radius:8px; }
    .remove-confirm p { margin:0 0 10px; }
    .remove-confirm button { margin-right:8px; }
    .actions { display:flex; gap:12px; flex-wrap:wrap; align-items:center;
      margin-top:18px; padding:12px 0;
      background:var(--ha-card-background,var(--card-background-color,#fff));
      border-top:1px solid var(--divider-color,#ddd); }
    .actions p { margin:0; }
    .other-groups { margin-top:12px; }
    .other-groups summary { cursor:pointer; padding:10px 0; }
    .unassigned-settings { margin-top:24px; padding-top:16px;
      border-top:1px solid var(--divider-color,#ddd); }
    .unassigned-settings h3 { margin:0 0 6px; }
    .unassigned-settings p { margin:0 0 12px; }
    .import { margin-top:20px; } .import summary { cursor:pointer; }
    .error { color:var(--error-color,#d32f2f); }
    .success { color:var(--success-color,#2e7d32); }
    @container (max-width:640px) {
      .tab-fields { grid-template-columns:minmax(0,1fr); }
      .tab-summary { flex-wrap:wrap; gap:8px; }
      .tab-summary button { margin-left:auto; }
      .tab-actions .remove-tab { margin-left:0; }
    }
    @media (max-width:600px) {
      .panel { padding:14px; }
    }
  </style>`;

function currentDashboardPath() {
  return decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[0] || "lovelace");
}

let cameraToastTimer;
function showCameraToast(message) {
  if (!globalThis.document?.body) return;
  let toast = document.getElementById("onvif-camera-dashboard-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "onvif-camera-dashboard-toast";
    toast.setAttribute("role", "status");
    toast.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));" +
      "transform:translateX(-50%);z-index:10000;padding:12px 18px;border-radius:10px;" +
      "background:#323232;color:#fff;box-shadow:0 4px 16px #0006;pointer-events:none;";
    document.body.append(toast);
  }
  toast.textContent = message;
  clearTimeout(cameraToastTimer);
  cameraToastTimer = setTimeout(() => toast.remove(), 3500);
  cameraToastTimer.unref?.();
}

export function swipeDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.4
    ? (dx < 0 ? 1 : -1) : 0;
}

export class CameraDashboardTabSwipes {
  constructor(browser = window, page = globalThis.document) {
    this.browser = browser;
    this.page = page;
    this.pathsByDashboard = new Map();
    browser.addEventListener?.("touchstart", (event) => this._start(event), { passive: true, capture: true });
    browser.addEventListener?.("touchend", (event) => this._end(event), { passive: false, capture: true });
    browser.addEventListener?.("touchcancel", () => { this.gesture = null; }, { capture: true });
  }

  register(dashboard, paths) {
    this.pathsByDashboard.set(dashboard, paths);
  }

  _route() {
    const parts = (this.browser.location?.pathname || "").split("/").filter(Boolean).map(decodeURIComponent);
    return { dashboard: parts[0] || "lovelace", path: parts[1] || "" };
  }

  _blocked(event) {
    return (event.composedPath?.() || []).some((node) => {
      const tag = node.tagName?.toLowerCase?.() || "";
      return tag.includes("dialog") || tag === "ha-tab-group-tab"
        || ["input", "textarea", "select", "a", "ha-selector"].includes(tag)
        || (tag === "button" && !node.classList?.contains("camera-view"))
        || node.isContentEditable || node.getAttribute?.("role") === "dialog";
    });
  }

  _start(event) {
    this.gesture = null;
    if (event.touches?.length !== 1 || this._blocked(event)
      || CameraDashboardCameraCard.activeViewer?._viewerOpen
      || CameraDashboardCameraCard.activeEditor?._open
      || new URLSearchParams(this.browser.location?.search || "").get("edit") === "1") return;
    const route = this._route();
    const paths = this.pathsByDashboard.get(route.dashboard);
    if (!paths?.length || (route.path && !paths.includes(route.path))) return;
    const touch = event.touches[0];
    if (touch.clientX < 24 || touch.clientX > (this.browser.innerWidth || Infinity) - 24) return;
    this.gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, ...route };
  }

  _end(event) {
    const start = this.gesture;
    this.gesture = null;
    if (!start || event.touches?.length) return;
    const touch = Array.from(event.changedTouches || []).find((item) => item.identifier === start.id);
    if (!touch || CameraDashboardCameraCard.activeViewer?._viewerOpen) return;
    const route = this._route();
    if (route.dashboard !== start.dashboard || route.path !== start.path) return;
    const paths = this.pathsByDashboard.get(route.dashboard) || [];
    const current = route.path ? paths.indexOf(route.path) : 0;
    const next = current + swipeDirection(start, { x: touch.clientX, y: touch.clientY });
    if (current < 0 || next < 0 || next >= paths.length || next === current) return;
    event.preventDefault?.();
    const link = this.page.createElement("a");
    link.href = `/${encodeURIComponent(route.dashboard)}/${encodeURIComponent(paths[next])}`;
    this.page.body.append(link);
    link.click();
    link.remove();
  }
}

let tabSwipes;
function registerTabSwipes(paths) {
  tabSwipes ||= new CameraDashboardTabSwipes();
  tabSwipes.register(currentDashboardPath(), paths);
}

let iconSelectorLoad;
function loadIconSelector() {
  if (customElements.get("ha-selector")) return Promise.resolve();
  if (!iconSelectorLoad) {
    iconSelectorLoad = (async () => {
      const helpers = await window.loadCardHelpers();
      const heading = helpers.createCardElement({ type: "heading", heading: "Icon picker" });
      await customElements.whenDefined(heading.localName);
      await customElements.get(heading.localName).getConfigElement();
      await customElements.whenDefined("ha-selector");
    })().catch((error) => {
      iconSelectorLoad = undefined;
      throw error;
    });
  }
  return iconSelectorLoad;
}

class CameraDashboardStrategy extends HTMLElement {
  static registryDependencies = ["entities", "devices", "areas", "floors"];
  static configRequired = false;

  static getCreateSuggestions() {
    return { title: "ONVIF Cameras", icon: "mdi:cctv" };
  }

  static getConfigElement() {
    return document.createElement("onvif-camera-dashboard-editor");
  }

  static async generate(config, hass) {
    try {
      const entries = await hass.callWS({ type: "config/entity_registry/list" });
      const dashboard = generateDashboard(config, hass, entries);
      registerTabSwipes(dashboard.views.filter((view) =>
        view.path !== "manage" && view.path !== "hidden-cameras").map((view) => view.path));
      return dashboard;
    } catch (error) {
      registerTabSwipes([]);
      return {
        title: "ONVIF Cameras",
        views: [{
          title: "Cameras", path: "cameras", type: "sections", max_columns: 1,
          sections: [{ type: "grid", cards: [{
            type: "markdown",
            content: `**Could not load the ONVIF camera registry.** ${String(error.message || error)}`,
          }] }],
        }],
      };
    }
  }
}

class CameraDashboardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = { type: STRATEGY_TYPE, group_by: "area", camera_options: {} };
    this._entries = [];
    this._dashboards = [];
    this._loading = false;
    this._mode = "create";
    this._status = "";
    this._dirty = false;
    this._expandedGroupId = null;
    this._pendingRemoveId = null;
    this._iconPickerReady = false;
    this.addEventListener("change", (event) => this._change(event));
    this.addEventListener("click", (event) => this._click(event));
  }

  setConfig(config) {
    this._config = { ...this._config, ...config, type: STRATEGY_TYPE };
    this.render();
  }

  set hass(hass) {
    const changed = this._hass?.entities !== hass.entities;
    this._hass = hass;
    if (changed) this._loadEntries();
  }

  get hass() { return this._hass; }

  connectedCallback() {
    this.render();
    this._loadIconPicker();
  }

  _loadIconPicker() {
    if (this._iconPickerReady) return Promise.resolve();
    if (!this._iconPickerPromise) {
      this._iconPickerPromise = loadIconSelector().then(() => {
        this._iconPickerReady = true;
        this._iconPickerError = "";
      }).catch((error) => {
        this._iconPickerError = `Could not load Home Assistant's icon picker: ${error.message || error}`;
      }).finally(() => {
        this._iconPickerPromise = null;
        this.render();
      });
    }
    return this._iconPickerPromise;
  }

  async _loadEntries() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this._entries = eligibleCameras(await this._hass.callWS({
        type: "config/entity_registry/list",
      }));
      this._error = "";
    } catch (error) {
      this._error = `Could not load cameras: ${error.message || error}`;
    } finally {
      this._loading = false;
      this.render();
    }
  }

  _emit() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config }, bubbles: true, composed: true,
    }));
  }

  _setConfig(config, rerender = true) {
    this._config = config;
    this._dirty = true;
    this._status = "Unsaved changes";
    if (this._mode === "create") this._emit();
    if (rerender) this.render();
    else {
      const status = this.querySelector(".actions [role=status]");
      if (status) { status.textContent = this._status; status.className = "hint"; }
      const save = this.querySelector('.actions [data-action="save"]');
      if (save) save.disabled = false;
    }
  }

  _change(event) {
    const field = event.target?.dataset?.field;
    if (!field) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "group_by") {
      this._setConfig({ ...this._config, [field]: value });
      return;
    }
    if (field === "inbox_new_cameras") {
      if (value && (!this._hass || this._loading || this._error)) return;
      const config = { ...this._config };
      if (value) config.inbox_existing_camera_keys = [...new Set(this._entries.map(cameraKey))];
      else delete config.inbox_existing_camera_keys;
      this._setConfig(config);
      return;
    }
    const groupId = event.target.dataset.groupId;
    if (groupId) {
      const adjusted = field === "max_columns" ? Number(value) : value;
      if (this._config.group_by === "custom" && groupId !== UNASSIGNED) {
        this._setConfig({
          ...this._config,
          categories: (this._config.categories || []).map((group) =>
            group.id === groupId ? { ...group, [field]: adjusted } : group),
        }, false);
      } else {
        this._setConfig({
          ...this._config,
          group_options: {
            ...this._config.group_options,
            [groupId]: { ...this._config.group_options?.[groupId], [field]: adjusted },
          },
        }, false);
      }
      if (field === "icon") {
        for (const preview of this.querySelectorAll("[data-icon-preview]")) {
          if (preview.dataset.iconPreview === groupId) {
            preview.setAttribute("icon", adjusted || "mdi:help-circle-outline");
          }
        }
      }
    }
  }

  async _click(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "add-category") {
      const id = `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this._expandedGroupId = id;
      this._setConfig({
        ...this._config, categories: [...(this._config.categories || []),
          { id, title: "New tab", icon: "mdi:cctv", max_columns: 2 }],
      });
    } else if (action === "edit-tab") {
      const id = event.target.dataset.groupId;
      this._expandedGroupId = this._expandedGroupId === id ? null : id;
      this._pendingRemoveId = null;
      this.render();
    } else if (action === "remove-category") {
      this._pendingRemoveId = event.target.dataset.groupId;
      this.render();
    } else if (action === "cancel-remove") {
      this._pendingRemoveId = null;
      this.render();
    } else if (action === "confirm-remove") {
      const id = event.target.dataset.groupId;
      if (id !== this._pendingRemoveId) return;
      const camera_options = { ...this._config.camera_options };
      for (const [key, option] of Object.entries(camera_options)) {
        if (option.category === id) camera_options[key] = { ...option, category: UNASSIGNED };
      }
      this._pendingRemoveId = null;
      this._expandedGroupId = null;
      this._setConfig({
        ...this._config, camera_options,
        categories: (this._config.categories || []).filter((group) => group.id !== id),
      });
    } else if (action === "move-category") {
      const id = event.target.dataset.groupId;
      const offset = Number(event.target.dataset.offset);
      const categories = [...(this._config.categories || [])];
      const from = categories.findIndex((group) => group.id === id);
      const to = from + offset;
      if (from >= 0 && to >= 0 && to < categories.length) {
        [categories[from], categories[to]] = [categories[to], categories[from]];
        this._setConfig({ ...this._config, categories });
      }
    } else if (action === "retry-icons") {
      this._iconPickerError = "";
      this.render();
      await this._loadIconPicker();
    } else if (action === "import") {
      await this._importSource();
    } else if (action === "save") {
      await this._save();
    }
  }

  _groupOptions() {
    const mode = this._config.group_by || "area";
    if (mode === "custom") return this._config.categories || [];
    const base = mode === "floor"
      ? Object.values(this._hass?.floors || {}).map((floor) => ({
        id: `floor:${floor.floor_id}`, title: floor.name, icon: floor.icon || "mdi:layers",
      }))
      : Object.values(this._hass?.areas || {}).map((area) => ({
        id: `area:${area.area_id}`, title: area.name, icon: area.icon || "mdi:map-marker",
      }));
    return base.map((group) => ({ ...group, ...this._config.group_options?.[group.id] }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  _groupRows() {
    const custom = this._config.group_by === "custom";
    const groups = this._groupOptions();
    const unassigned = {
      id: UNASSIGNED, title: "Unassigned", icon: "mdi:help-circle-outline",
      ...this._config.group_options?.[UNASSIGNED],
    };
    const row = (group, index = -1) => {
      const expanded = this._expandedGroupId === group.id;
      const editable = custom && group.id !== UNASSIGNED;
      const columns = group.max_columns || 2;
      return `<div class="tab-entry">
        <div class="tab-summary">
          <ha-icon icon="${esc(group.icon || "mdi:help-circle-outline")}" data-icon-preview="${esc(group.id)}" aria-hidden="true"></ha-icon>
          <span class="tab-title">${esc(group.title)}</span>
          <span class="tab-meta">${group.id === UNASSIGNED ? "Built-in · " : ""}Up to ${esc(columns)} columns</span>
          <button type="button" data-action="edit-tab" data-group-id="${esc(group.id)}"
            aria-expanded="${expanded}" aria-label="${expanded ? "Close settings for" : "Edit"} ${esc(group.title)}">${expanded ? "Done" : "Edit"}</button>
        </div>
        ${expanded ? `<div class="tab-editor">
          <div class="tab-fields">
            <label>Name<input data-field="title" data-group-id="${esc(group.id)}" value="${esc(group.title)}"></label>
            <div class="icon-field"><span>Icon <ha-icon icon="${esc(group.icon || "mdi:help-circle-outline")}" data-icon-preview="${esc(group.id)}" aria-hidden="true"></ha-icon></span>
              ${this._iconPickerReady && this._hass
                ? `<ha-selector data-group-id="${esc(group.id)}" data-icon="${esc(group.icon)}"></ha-selector>`
                : `<span class="hint">${this._iconPickerError ? "Icon picker unavailable" : "Loading icons…"}</span>`}</div>
            <label>Maximum columns on wide screens<input type="number" min="1" max="4" data-field="max_columns"
              data-group-id="${esc(group.id)}" value="${esc(columns)}"></label>
          </div>
          <p class="hint tab-help">Narrow screens use fewer columns automatically.</p>
          ${editable ? `<div class="tab-actions">
            <button type="button" data-action="move-category" data-group-id="${esc(group.id)}" data-offset="-1" ${index === 0 ? "disabled" : ""}>Move up</button>
            <button type="button" data-action="move-category" data-group-id="${esc(group.id)}" data-offset="1" ${index === groups.length - 1 ? "disabled" : ""}>Move down</button>
            <button type="button" class="remove-tab" data-action="remove-category" data-group-id="${esc(group.id)}">Remove tab…</button>
          </div>${this._pendingRemoveId === group.id ? `<div class="remove-confirm" role="alert">
            <p>Remove ${esc(group.title)}? Cameras assigned to this tab will move to Unassigned.</p>
            <button type="button" data-action="confirm-remove" data-group-id="${esc(group.id)}">Remove tab</button>
            <button type="button" data-action="cancel-remove">Cancel</button>
          </div>` : ""}` : ""}
        </div>` : ""}
      </div>`;
    };
    let tabs;
    if (this._loading && !custom) tabs = `<p class="hint">Loading camera tabs…</p>`;
    else if (custom || !this._hass || this._error) tabs = groups.map(row).join("");
    else {
      const visible = this._entries.filter((entry) => !cameraOption(this._config, entry).hidden);
      const activeIds = new Set(groupsFor(this._config, this._hass, visible).map((group) => group.id));
      const active = groups.filter((group) => activeIds.has(group.id));
      const unused = groups.filter((group) => !activeIds.has(group.id));
      const kind = this._config.group_by === "floor" ? "floors" : "areas";
      tabs = `${active.map(row).join("")}${unused.length ? `<details class="other-groups" ${this._otherGroupsOpen ? "open" : ""}>
        <summary>Other ${kind} (${unused.length})</summary>${unused.map(row).join("")}</details>` : ""}`;
    }
    return `${tabs || (custom ? '<p class="hint">No custom tabs yet.</p>' : "")}
      ${custom ? `<button data-action="add-category">Add tab</button>` : ""}
      <section class="unassigned-settings" aria-labelledby="unassigned-settings-title">
        <h3 id="unassigned-settings-title">Unassigned tab</h3>
        <p class="hint">Built-in tab for cameras without a category. You can change its name, icon, and columns.</p>
        ${row(unassigned)}
      </section>`;
  }

  render() {
    if (!this.isConnected) return;
    this._otherGroupsOpen = this.querySelector("details.other-groups")?.open ?? this._otherGroupsOpen;
    const custom = this._config.group_by === "custom";
    this.innerHTML = `${styles}<div class="panel">
      <h2>Dashboard tabs</h2>
      <p>Choose how tabs are organized. Use Edit camera on a feed to change that camera.</p>
      ${this._error ? `<p class="error">${esc(this._error)}</p>` : ""}
      ${this._iconPickerError ? `<p class="error">${esc(this._iconPickerError)} <button data-action="retry-icons">Retry</button></p>` : ""}
      <div class="row">
        <label>Organize tabs by<select data-field="group_by">
          ${[["area", "Area"], ["floor", "Floor"], ["custom", "Custom categories"]]
            .map(([value, title]) => `<option value="${value}" ${this._config.group_by === value ? "selected" : ""}>${title}</option>`).join("")}
        </select></label>
      </div>
      ${custom ? "" : `<label class="check"><input type="checkbox" data-field="inbox_new_cameras"
        ${Array.isArray(this._config.inbox_existing_camera_keys) ? "checked" : ""}
        ${!this._hass || this._loading || this._error ? "disabled" : ""}>
        Put newly added ONVIF cameras in Unassigned</label>
        <p class="hint">Cameras already on this dashboard keep their tabs. Later cameras wait in Unassigned until you choose a category.</p>`}
      <h3>${custom ? "Your tabs" : "Tabs"}</h3>${this._groupRows()}
      ${this._mode === "manage" ? `
        <details class="import"><summary>Import tabs from an existing dashboard</summary>
        <div class="row"><label>Source dashboard<select id="source-dashboard">
          <option value="">Choose dashboard</option>
          ${this._dashboards.filter((item) => item.url_path && item.url_path !== this._dashboardPath)
            .map((item) => `<option value="${esc(item.url_path)}">${esc(item.title || item.url_path)}</option>`).join("")}
        </select></label><button data-action="import">Import into draft</button></div>
        <p class="hint">Imports tab names, icons, layout, and camera placement. Review the tabs before saving.</p></details>
        <div class="actions"><button class="primary" data-action="save" ${this._saving || !this._dirty ? "disabled" : ""}>${this._saving ? "Saving…" : "Save changes"}</button>
          <p role="status" class="${this._status === "Saved" ? "success" : this._status.startsWith("Save failed") ? "error" : "hint"}">${esc(this._status)}</p></div>
      ` : ""}
    </div>`;
    for (const picker of this.querySelectorAll("ha-selector[data-group-id]")) {
      picker.hass = this._hass;
      picker.selector = { icon: {} };
      picker.value = picker.dataset.icon;
      picker.label = "Choose icon";
      picker.required = false;
      picker.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        this._change({ target: {
          dataset: { field: "icon", groupId: picker.dataset.groupId },
          value: event.detail?.value || "",
        } });
      });
    }
  }

  async _importSource() {
    const path = this.querySelector("#source-dashboard")?.value;
    if (!path) { this._status = "Choose a source dashboard first."; this.render(); return; }
    try {
      const source = await this._hass.callWS({ type: "lovelace/config", url_path: path, force: false });
      const { config, importedCameras } = importDashboard(source, this._config, this._entries);
      if (!importedCameras) {
        this._status = "No picture-entity camera cards found in that dashboard.";
        this.render();
        return;
      }
      this._setConfig(config);
      this._status = `Imported ${importedCameras} cameras into the tab layout. Review tabs and save.`;
      this.render();
    } catch (error) {
      this._status = `Import failed: ${error.message || error}`;
      this.render();
    }
  }

  async _save() {
    if (!this._hass?.user?.is_admin || this._saving) return;
    this._saving = true;
    this.render();
    try {
      const raw = await this._hass.callWS({
        type: "lovelace/config", url_path: this._dashboardPath, force: false,
      });
      if (raw.strategy?.type !== STRATEGY_TYPE) {
        throw new Error("This dashboard does not use the ONVIF Camera Dashboard strategy.");
      }
      await this._hass.callWS({
        type: "lovelace/config/save", url_path: this._dashboardPath,
        config: { ...raw, strategy: { ...raw.strategy, ...this._config } },
      });
      this._dirty = false;
      this._status = "Saved";
    } catch (error) {
      this._status = `Save failed: ${error.message || error}`;
    } finally {
      this._saving = false;
      this.render();
    }
  }
}

class CameraDashboardCameraCard extends HTMLElement {
  constructor() {
    super();
    this._open = false;
    this._viewerOpen = false;
    this._viewerGeneration = 0;
    this._viewerIndex = 0;
    this._saving = false;
    this._reorderKeys = null;
    this._previewLoadError = false;
    this.addEventListener("click", (event) => this._click(event));
  }

  setConfig(config) {
    if (!config?.camera?.entity || !config.camera_key) throw new Error("Camera card configuration is incomplete.");
    this._closeViewer(false);
    this._disconnectPictureObservers();
    this._config = config;
    this._picture = null;
    this._picturePromise = null;
    this._pictureError = "";
    this._previewLoadError = false;
    this._open = false;
    this._draft = null;
    this._reorderKeys = null;
    this.render();
  }

  set hass(hass) {
    const wasAdmin = this._hass?.user?.is_admin;
    const oldStatus = this._previewStatus()?.message;
    this._hass = hass;
    if (this._picture) this._picture.hass = hass;
    if (this._picture) this._watchPicture();
    if (this._viewerCard) this._viewerCard.hass = hass;
    if (wasAdmin !== hass.user?.is_admin
      || (!this._open && !this._viewerOpen && oldStatus !== this._previewStatus()?.message)) this.render();
  }

  get hass() { return this._hass; }

  connectedCallback() { this.render(); }

  disconnectedCallback() {
    if (CameraDashboardCameraCard.activeEditor === this) CameraDashboardCameraCard.activeEditor = null;
    this._disconnectPictureObservers();
    this._closeViewer(false);
  }

  getCardSize() { return 3; }

  getGridOptions() { return { columns: 12, rows: "auto" }; }

  _previewStatus() {
    if (this._pictureError || this._previewLoadError) return { message: "Preview failed", retry: true };
    const source = this._config?.camera?.camera_image || this._config?.camera?.entity;
    if (this._hass?.states && source && !this._hass.states[source]) {
      return { message: "Preview source missing" };
    }
    const state = this._hass?.states?.[source]?.state;
    if (state === "unavailable") return { message: "Camera unavailable" };
    if (state === "unknown") return { message: "Camera state unknown" };
    if (state === "off") return { message: "Camera is off" };
    return null;
  }

  _orderKeys() {
    return this._reorderKeys || (this._config.viewer_cameras || []).map((camera) => camera.key);
  }

  _orderListMarkup() {
    const names = new Map((this._config.viewer_cameras || []).map((camera) => [camera.key, camera.name]));
    return this._orderKeys().map((key) => `<li ${key === this._config.camera_key ? 'class="current" aria-current="true"' : ""}>${esc(names.get(key) || key)}</li>`).join("");
  }

  _updateReorderControls() {
    const controls = this.querySelector(".camera-reorder");
    if (!controls) return;
    const category = this.querySelector("form[data-camera-editor]")?.elements?.namedItem("category")?.value;
    const changedCategory = category !== (this._config.option?.category || "");
    const keys = this._orderKeys();
    const index = keys.indexOf(this._config.camera_key);
    const list = controls.querySelector("ol");
    if (list) list.innerHTML = this._orderListMarkup();
    const hint = controls.querySelector(".camera-reorder-hint");
    if (hint) hint.textContent = changedCategory
      ? "Save the new tab first, then reopen this camera to change its position."
      : `Position ${index + 1} of ${keys.length}`;
    const earlier = controls.querySelector('button[data-action="move-earlier"]');
    const later = controls.querySelector('button[data-action="move-later"]');
    if (earlier) earlier.disabled = changedCategory || index <= 0;
    if (later) later.disabled = changedCategory || index < 0 || index >= keys.length - 1;
  }

  _moveCamera(offset) {
    if (!this._open || this._saving) return;
    const category = this.querySelector("form[data-camera-editor]")?.elements?.namedItem("category")?.value;
    if (category !== (this._config.option?.category || "")) return;
    const keys = [...this._orderKeys()];
    const from = keys.indexOf(this._config.camera_key);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= keys.length) return;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    this._reorderKeys = keys;
    this._updateReorderControls();
  }

  _disconnectPictureObservers() {
    this._pictureObserver?.disconnect();
    this._imageObserver?.disconnect();
    this._pictureObserver = null;
    this._imageObserver = null;
    this._observedPicture = null;
    this._observedImageRoot = null;
  }

  _syncPreviewLoadState() {
    const failed = Boolean(this._observedImageRoot?.querySelector("#brokenImage"));
    if (failed === this._previewLoadError) return;
    this._previewLoadError = failed;
    if (!this._open && !this._viewerOpen) this.render();
  }

  _watchPicture() {
    const picture = this._picture;
    if (!globalThis.MutationObserver || !picture?.shadowRoot) return;
    if (this._observedPicture === picture) return;
    this._disconnectPictureObservers();
    this._observedPicture = picture;
    const attachImage = () => {
      const imageRoot = picture.shadowRoot.querySelector("hui-image")?.shadowRoot;
      if (!imageRoot || imageRoot === this._observedImageRoot) return;
      this._imageObserver?.disconnect();
      this._observedImageRoot = imageRoot;
      this._imageObserver = new MutationObserver(() => this._syncPreviewLoadState());
      this._imageObserver.observe(imageRoot, { childList: true, subtree: true });
      this._syncPreviewLoadState();
    };
    this._pictureObserver = new MutationObserver(attachImage);
    this._pictureObserver.observe(picture.shadowRoot, { childList: true, subtree: true });
    attachImage();
  }

  async _mountPicture() {
    if (this._config?.option?.hidden) return;
    if (this._picture) {
      this.querySelector(".camera-picture")?.replaceChildren(this._picture);
      this._watchPicture();
      return;
    }
    if (this._picturePromise || this._pictureError || !this._config) return;
    this._picturePromise = (async () => {
      try {
        const helpers = await window.loadCardHelpers();
        this._picture = helpers.createCardElement({ ...this._config.camera, show_name: false });
        if (this._hass) this._picture.hass = this._hass;
        this.querySelector(".camera-picture")?.replaceChildren(this._picture);
        await this._picture.updateComplete;
        this._watchPicture();
      } catch (error) {
        this._pictureError = `Could not load camera card: ${error.message || error}`;
        this.render();
      }
    })();
    await this._picturePromise;
  }

  _viewerCameras() {
    return this._config.viewer_cameras?.length ? this._config.viewer_cameras : [{
      key: this._config.camera_key,
      name: this._config.camera.name,
      image_entity: this._config.camera.camera_image || this._config.camera.entity,
    }];
  }

  _currentViewerCamera() {
    return this._viewerCameras()[this._viewerIndex];
  }

  async _mountViewer() {
    if (!this._viewerOpen || !this._config || this._config.option?.hidden) return;
    if (this._viewerCard) {
      this.querySelector(".viewer-stage")?.replaceChildren(this._viewerCard);
      return;
    }
    if (this._viewerPromise) return this._viewerPromise;
    const generation = this._viewerGeneration;
    this._viewerPromise = (async () => {
      try {
        const helpers = await window.loadCardHelpers();
        if (!this._viewerOpen || generation !== this._viewerGeneration) return;
        const selected = this._currentViewerCamera();
        const source = selected.image_entity;
        const card = helpers.createCardElement({
          ...this._config.camera,
          entity: source,
          camera_image: source,
          name: selected.name,
          camera_view: "live",
          fit_mode: "contain",
          show_name: false,
          show_state: false,
          tap_action: { action: "none" },
        });
        if (this._hass) card.hass = this._hass;
        if (!this._viewerOpen || generation !== this._viewerGeneration) return;
        this._viewerCard = card;
        this.querySelector(".viewer-stage")?.replaceChildren(card);
      } catch (error) {
        if (!this._viewerOpen || generation !== this._viewerGeneration) return;
        const message = this.querySelector(".viewer-error");
        if (message) message.textContent = `Could not load camera viewer: ${error.message || error}`;
      } finally {
        if (generation === this._viewerGeneration) this._viewerPromise = null;
      }
    })();
    await this._viewerPromise;
  }

  _updateViewerControls() {
    const cameras = this._viewerCameras();
    const title = this.querySelector("#camera-viewer-title");
    if (title) title.textContent = this._currentViewerCamera().name;
    const position = this.querySelector(".viewer-position");
    if (position) position.textContent = `${this._viewerIndex + 1} / ${cameras.length}`;
    const previous = this.querySelector("button[data-action=previous-camera]");
    if (previous) previous.disabled = this._viewerIndex === 0;
    const next = this.querySelector("button[data-action=next-camera]");
    if (next) next.disabled = this._viewerIndex === cameras.length - 1;
  }

  _selectViewer(index) {
    if (!this._viewerOpen || index < 0 || index >= this._viewerCameras().length
      || index === this._viewerIndex) return false;
    this._viewerGeneration++;
    this._viewerCard?.remove?.();
    this._viewerCard = null;
    this._viewerPromise = null;
    this._viewerIndex = index;
    const error = this.querySelector(".viewer-error");
    if (error) error.textContent = "";
    this._updateViewerControls();
    this._mountViewer();
    return true;
  }

  _startViewerSwipe(event) {
    this._viewerGesture = null;
    if (event.touches?.length !== 1 || (event.composedPath?.() || []).some((node) =>
      node.tagName?.toLowerCase?.() === "button")) return;
    const touch = event.touches[0];
    this._viewerGesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  }

  _endViewerSwipe(event) {
    const start = this._viewerGesture;
    this._viewerGesture = null;
    if (!start || event.touches?.length) return;
    const touch = Array.from(event.changedTouches || []).find((item) => item.identifier === start.id);
    if (!touch) return;
    const direction = swipeDirection(start, { x: touch.clientX, y: touch.clientY });
    if (!direction) return;
    event.preventDefault?.();
    this._selectViewer(this._viewerIndex + direction);
  }

  render() {
    if (!this.isConnected || !this._config) return;
    const option = this._draft || this._config.option || {};
    const selectedCategory = option.category ?? (this._config.new_unassigned ? UNASSIGNED : "");
    const image = option.image_entity || this._config.camera.camera_image;
    const imageChoices = [...new Set([...this._config.image_entities, image])];
    const previewStatus = this._config.option?.hidden ? null : this._previewStatus();
    this.innerHTML = `<style>
      onvif-camera-dashboard-camera-card .camera-shell { position:relative; }
      onvif-camera-dashboard-camera-card .camera-picture { display:block; }
      onvif-camera-dashboard-camera-card .camera-view { position:absolute; inset:0; z-index:1;
        width:100%; padding:0; border:0; border-radius:var(--ha-card-border-radius,12px);
        background:transparent; cursor:zoom-in; }
      onvif-camera-dashboard-camera-card .camera-view:focus-visible { outline:3px solid var(--primary-color,#03a9f4); outline-offset:-3px; }
      onvif-camera-dashboard-camera-card .camera-expand { position:absolute; top:8px; left:8px;
        display:grid; place-items:center; width:36px; height:36px; border-radius:50%;
        background:rgba(0,0,0,.62); color:#fff; opacity:0; transition:opacity .15s ease; }
      onvif-camera-dashboard-camera-card .camera-view:hover .camera-expand,
      onvif-camera-dashboard-camera-card .camera-view:focus-visible .camera-expand { opacity:1; }
      @media (hover:none) { onvif-camera-dashboard-camera-card .camera-expand { opacity:.85; } }
      onvif-camera-dashboard-camera-card .camera-expand ha-icon { --mdc-icon-size:20px; }
      onvif-camera-dashboard-camera-card .camera-status { position:absolute; z-index:2;
        top:50%; left:50%; transform:translate(-50%,-50%); display:flex; flex-direction:column;
        align-items:center; gap:8px; min-width:160px; max-width:calc(100% - 32px);
        box-sizing:border-box; padding:12px 16px; border-radius:10px;
        background:rgba(0,0,0,.78); color:#fff; text-align:center; pointer-events:none; }
      onvif-camera-dashboard-camera-card .camera-status button { min-height:36px;
        border:1px solid #fff8; border-radius:8px; padding:4px 12px;
        background:#333; color:#fff; pointer-events:auto; cursor:pointer; }
      onvif-camera-dashboard-camera-card .camera-name { position:absolute; bottom:8px; left:8px; z-index:2;
        box-sizing:border-box; max-width:calc(100% - 16px); padding:4px 8px;
        overflow:hidden; white-space:nowrap; text-overflow:ellipsis; pointer-events:none;
        border-radius:6px; background:rgba(0,0,0,.62); color:#fff;
        font-size:.85rem; font-weight:500; line-height:1.3; }
      onvif-camera-dashboard-camera-card .hidden-camera { display:flex; flex-direction:column;
        justify-content:center; min-height:80px; padding:12px 58px 12px 16px; box-sizing:border-box;
        color:var(--secondary-text-color,#666);
        background:var(--ha-card-background,var(--card-background-color,#fff));
        border-radius:var(--ha-card-border-radius,12px); }
      onvif-camera-dashboard-camera-card .hidden-camera strong { color:var(--primary-text-color); }
      onvif-camera-dashboard-camera-card .camera-edit { position:absolute; top:8px; right:8px; z-index:3;
        display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0;
        border:0; border-radius:50%; background:rgba(0,0,0,.62); color:#fff; opacity:.85;
        cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.25); transition:opacity .15s ease; }
      onvif-camera-dashboard-camera-card .camera-edit:hover,
      onvif-camera-dashboard-camera-card .camera-edit:focus-visible { opacity:1; background:rgba(0,0,0,.85); }
      onvif-camera-dashboard-camera-card .camera-edit ha-icon { --mdc-icon-size:20px; }
      @media (hover:hover) and (pointer:fine) {
        onvif-camera-dashboard-camera-card .camera-shell:not(.is-hidden) .camera-edit { opacity:0; }
        onvif-camera-dashboard-camera-card .camera-shell:not(.is-hidden):hover .camera-edit,
        onvif-camera-dashboard-camera-card .camera-shell:not(.is-hidden):focus-within .camera-edit { opacity:1; }
      }
      @media (any-pointer:coarse) {
        onvif-camera-dashboard-camera-card .camera-shell:not(.is-hidden) .camera-edit { opacity:.85; }
      }
      onvif-camera-dashboard-camera-card .camera-viewer { box-sizing:border-box;
        width:calc(100vw - 24px); height:calc(100vh - 24px); height:calc(100dvh - 24px);
        max-width:none; max-height:none; margin:auto; padding:16px; border:1px solid var(--divider-color,#555);
        border-radius:12px; color:#fff; background:#111; }
      onvif-camera-dashboard-camera-card .camera-viewer[open] { display:flex; flex-direction:column; }
      onvif-camera-dashboard-camera-card .camera-viewer::backdrop { background:rgba(0,0,0,.85); }
      onvif-camera-dashboard-camera-card .viewer-header { display:flex; align-items:center; justify-content:space-between;
        gap:16px; flex:none; min-height:48px; padding:0 0 12px; }
      onvif-camera-dashboard-camera-card .viewer-header h3 { margin:0; min-width:0; overflow:hidden;
        white-space:nowrap; text-overflow:ellipsis; font-size:1.1rem; }
      onvif-camera-dashboard-camera-card .viewer-navigation { display:flex; align-items:center; gap:4px; flex:none; }
      onvif-camera-dashboard-camera-card .viewer-navigation button { width:44px; height:44px; padding:0;
        border:0; border-radius:50%; color:#fff; background:#333; font-size:28px; cursor:pointer; }
      onvif-camera-dashboard-camera-card .viewer-navigation button:disabled { opacity:.35; cursor:default; }
      onvif-camera-dashboard-camera-card .viewer-position { min-width:40px; text-align:center; font-size:.85rem; }
      onvif-camera-dashboard-camera-card .viewer-close { flex:none; width:44px; height:44px;
        border:0; border-radius:50%; color:#fff; background:#333; font-size:24px; line-height:1; cursor:pointer; }
      onvif-camera-dashboard-camera-card .viewer-close:hover,
      onvif-camera-dashboard-camera-card .viewer-close:focus-visible { background:#555; }
      onvif-camera-dashboard-camera-card .viewer-stage { flex:1; min-height:0; display:grid; place-items:center; }
      onvif-camera-dashboard-camera-card .viewer-stage > * { width:100%; height:100%; max-width:100%; max-height:100%; }
      onvif-camera-dashboard-camera-card .viewer-error { color:#fff; text-align:center; }
      onvif-camera-dashboard-camera-card .viewer-error:empty { display:none; }
      @media (max-width:600px) {
        onvif-camera-dashboard-camera-card .camera-viewer { width:100vw; height:100vh; height:100dvh;
          margin:0; border:0; border-radius:0; }
      }
      onvif-camera-dashboard-camera-card .camera-dialog button { font:inherit; cursor:pointer; border:0;
        border-radius:8px; min-height:44px; padding:8px 12px;
        color:var(--primary-text-color); background:var(--secondary-background-color,#eee); }
      onvif-camera-dashboard-camera-card button:disabled { opacity:.5; cursor:default; }
      onvif-camera-dashboard-camera-card button.primary { color:#fff; background:#005b83;
        background:color-mix(in srgb,var(--primary-color,#03a9f4) 45%,black); }
      onvif-camera-dashboard-camera-card .camera-dialog { box-sizing:border-box; width:min(560px,calc(100vw - 32px));
        max-height:min(80vh,720px); overflow:auto; padding:20px; border:1px solid var(--divider-color,#555);
        border-radius:16px; box-shadow:0 16px 48px rgba(0,0,0,.4);
        color:var(--primary-text-color); background:var(--ha-card-background,var(--card-background-color,#222)); }
      onvif-camera-dashboard-camera-card .camera-dialog::backdrop { background:rgba(0,0,0,.65); }
      onvif-camera-dashboard-camera-card .camera-dialog header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
      onvif-camera-dashboard-camera-card .camera-dialog h3 { margin:0; font-size:1.15rem; }
      onvif-camera-dashboard-camera-card .camera-dialog .close { min-width:44px; padding:0; font-size:1.5rem; }
      onvif-camera-dashboard-camera-card .camera-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:10px; }
      onvif-camera-dashboard-camera-card .camera-fields label { display:flex; flex-direction:column; gap:4px; font-size:.87rem; }
      onvif-camera-dashboard-camera-card .camera-fields label.check { grid-column:1/-1; flex-direction:row; align-items:center; }
      onvif-camera-dashboard-camera-card .camera-reorder { margin-top:16px; }
      onvif-camera-dashboard-camera-card .camera-reorder h4 { margin:0 0 8px; font-size:1rem; }
      onvif-camera-dashboard-camera-card .camera-reorder ol { margin:8px 0; padding-left:28px; }
      onvif-camera-dashboard-camera-card .camera-reorder li { padding:5px 8px; border-radius:6px; }
      onvif-camera-dashboard-camera-card .camera-reorder li.current {
        background:var(--secondary-background-color,#444); font-weight:600; }
      onvif-camera-dashboard-camera-card .camera-reorder-actions { display:flex; flex-wrap:wrap;
        align-items:center; gap:8px; }
      onvif-camera-dashboard-camera-card .camera-reorder-hint { color:var(--secondary-text-color,#aaa); }
      onvif-camera-dashboard-camera-card .camera-fields input:not([type=checkbox]),
      onvif-camera-dashboard-camera-card .camera-fields select { box-sizing:border-box; width:100%;
        min-height:44px; padding:6px 8px; font:inherit; border-radius:6px;
        color:var(--primary-text-color); background:var(--card-background-color,#fff);
        border:1px solid var(--divider-color,#aaa); }
      onvif-camera-dashboard-camera-card .camera-advanced { margin-top:16px; }
      onvif-camera-dashboard-camera-card .camera-advanced summary { cursor:pointer; padding:8px 0; }
      onvif-camera-dashboard-camera-card .camera-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }
      onvif-camera-dashboard-camera-card .camera-error { color:var(--error-color,#d32f2f); margin:8px 0; }
    </style>
    <div class="camera-shell${this._config.option?.hidden ? " is-hidden" : ""}">
      ${this._config.option?.hidden
        ? `<div class="hidden-camera"><strong>${esc(this._config.camera.name)}</strong><span>Hidden from dashboard</span></div>`
        : `<div class="camera-picture"></div><button class="camera-view" type="button" data-action="view"
            aria-haspopup="dialog" aria-label="View ${esc(this._config.camera.name)} full screen" title="Open camera viewer">
            <span class="camera-expand" aria-hidden="true"><ha-icon icon="mdi:arrow-expand"></ha-icon></span></button>
          ${previewStatus ? `<div class="camera-status" role="status"><span>${esc(previewStatus.message)}</span>
            ${previewStatus.retry ? `<button type="button" data-action="retry-preview">Retry preview</button>` : ""}</div>` : ""}
          <span class="camera-name">${esc(this._config.camera.name)}</span>`}
      ${this._hass?.user?.is_admin ? `<button class="camera-edit" type="button" data-action="edit"
        aria-haspopup="dialog" aria-label="Edit ${esc(this._config.camera.name)}"
        title="Edit camera" ${this._saving ? "disabled" : ""}>
        <ha-icon icon="mdi:pencil" aria-hidden="true"></ha-icon></button>` : ""}
    </div>
    ${this._viewerOpen && !this._config.option?.hidden ? `<dialog class="camera-viewer" aria-labelledby="camera-viewer-title">
      <header class="viewer-header"><h3 id="camera-viewer-title" tabindex="-1" aria-live="polite">${esc(this._currentViewerCamera().name)}</h3>
        <div class="viewer-navigation">${this._viewerCameras().length > 1 ? `
          <button type="button" data-action="previous-camera" aria-label="Previous camera" ${this._viewerIndex === 0 ? "disabled" : ""}>‹</button>
          <span class="viewer-position">${this._viewerIndex + 1} / ${this._viewerCameras().length}</span>
          <button type="button" data-action="next-camera" aria-label="Next camera" ${this._viewerIndex === this._viewerCameras().length - 1 ? "disabled" : ""}>›</button>` : ""}
          <button class="viewer-close" type="button" data-action="close-viewer" aria-label="Close camera viewer">×</button></div></header>
      <div class="viewer-stage"><p class="viewer-error" role="alert"></p></div>
    </dialog>` : ""}
    ${this._open && this._hass?.user?.is_admin ? `<dialog class="camera-dialog" aria-labelledby="camera-dialog-title">
      <header><h3 id="camera-dialog-title">Edit ${esc(this._config.camera.name)}</h3>
        <button type="button" class="close" data-action="cancel" aria-label="Close camera editor">×</button></header>
      <form data-camera-editor>
        <div class="camera-fields">
          <label>Category<select name="category">
            <option value="" ${selectedCategory === "" ? "selected" : ""}>${this._config.group_by === "custom" ? "Unassigned" : "Automatic"}</option>
            ${this._config.groups.map((group) => `<option value="${esc(group.id)}" ${selectedCategory === group.id ? "selected" : ""}>${esc(group.title)}</option>`).join("")}
            <option value="${UNASSIGNED}" ${selectedCategory === UNASSIGNED ? "selected" : ""}>Unassigned</option>
          </select></label>
          <label>Display name<input name="name" value="${esc(option.name || "")}" placeholder="${esc(this._config.camera.name)}"></label>
          <label class="check"><input name="hidden" type="checkbox" ${option.hidden ? "checked" : ""}> Hide camera</label>
        </div>
        ${!this._config.option?.hidden && (this._config.viewer_cameras || []).length > 1 ? `
          <div class="camera-reorder"><h4>Position in this tab</h4>
            <ol>${this._orderListMarkup()}</ol>
            <div class="camera-reorder-actions">
              <button type="button" data-action="move-earlier">Move earlier</button>
              <button type="button" data-action="move-later">Move later</button>
              <span class="camera-reorder-hint"></span>
            </div>
          </div>` : ""}
        <details class="camera-advanced"><summary>Advanced settings</summary><div class="camera-fields">
          <label>Image / stream entity<select name="image_entity">
            ${imageChoices.map((entity) => `<option value="${esc(entity)}" ${image === entity ? "selected" : ""}>${esc(entity)}</option>`).join("")}
          </select></label>
          <label>Camera view<select name="camera_view">
            ${["auto", "live"].map((value) => `<option value="${value}" ${(option.camera_view || this._config.camera.camera_view) === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
          <label>Image fit<select name="fit_mode">
            ${["contain", "cover", "fill"].map((value) => `<option value="${value}" ${(option.fit_mode || this._config.camera.fit_mode) === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
        </div></details>
        <p class="camera-error" role="alert" ${this._error ? "" : "hidden"}>${esc(this._error || "")}</p>
        <div class="camera-actions"><button type="submit" class="primary" ${this._saving ? "disabled" : ""}>${this._saving ? "Saving…" : "Save camera"}</button>
          <button type="button" data-action="cancel" ${this._saving ? "disabled" : ""}>Cancel</button></div>
      </form>
    </dialog>` : ""}`;
    const form = this.querySelector("form[data-camera-editor]");
    form?.addEventListener("submit", (event) => { event.preventDefault(); this._save(); });
    form?.elements?.namedItem("category")?.addEventListener?.("change", () => this._updateReorderControls());
    this._updateReorderControls();
    const dialog = this.querySelector("dialog.camera-dialog");
    dialog?.addEventListener("cancel", (event) => {
      if (this._saving) { event.preventDefault(); return; }
      this._closeEditor(false);
    });
    dialog?.showModal?.();
    const viewer = this.querySelector("dialog.camera-viewer");
    viewer?.addEventListener("cancel", (event) => {
      event.preventDefault();
      this._closeViewer();
    });
    viewer?.addEventListener("touchstart", (event) => this._startViewerSwipe(event), { passive: true, capture: true });
    viewer?.addEventListener("touchend", (event) => this._endViewerSwipe(event), { passive: false, capture: true });
    viewer?.addEventListener("touchcancel", () => { this._viewerGesture = null; }, { capture: true });
    viewer?.showModal?.();
    if (viewer) this.querySelector("#camera-viewer-title")?.focus?.();
    if (viewer) this._mountViewer();
    if (!this._config.option?.hidden) this._mountPicture();
  }

  _click(event) {
    const action = event.target?.closest?.("button[data-action]")?.dataset.action;
    if (action === "previous-camera") { this._selectViewer(this._viewerIndex - 1); return; }
    if (action === "next-camera") { this._selectViewer(this._viewerIndex + 1); return; }
    if (action === "close-viewer") { this._closeViewer(); return; }
    if (action === "retry-preview") {
      this._disconnectPictureObservers();
      this._picture?.remove?.();
      this._pictureError = "";
      this._previewLoadError = false;
      this._picture = null;
      this._picturePromise = null;
      this.render();
      return;
    }
    if (action === "move-earlier" || action === "move-later") {
      this._moveCamera(action === "move-earlier" ? -1 : 1);
      return;
    }
    if (action === "view") {
      if (this._config?.option?.hidden) return;
      if (this._open) this._closeEditor(false);
      if (CameraDashboardCameraCard.activeViewer && CameraDashboardCameraCard.activeViewer !== this) {
        CameraDashboardCameraCard.activeViewer._closeViewer(false);
      }
      this._viewerIndex = Math.max(0, this._viewerCameras().findIndex((camera) =>
        camera.key === this._config.camera_key));
      this._viewerOpen = true;
      this._viewerGeneration++;
      CameraDashboardCameraCard.activeViewer = this;
      this.render();
      return;
    }
    if (action !== "edit" && action !== "cancel") return;
    if (action === "edit" && !this._hass?.user?.is_admin) return;
    if (this._saving) return;
    if (action === "cancel") { this._closeEditor(); return; }
    if (this._viewerOpen) this._closeViewer(false);
    if (CameraDashboardCameraCard.activeEditor && CameraDashboardCameraCard.activeEditor !== this) {
      CameraDashboardCameraCard.activeEditor._closeEditor();
    }
    this._open = true;
    CameraDashboardCameraCard.activeEditor = this;
    this._error = "";
    this._draft = null;
    this._reorderKeys = null;
    this.render();
  }

  _closeViewer(restoreFocus = true) {
    this._viewerGeneration++;
    this._viewerOpen = false;
    this.querySelector("dialog.camera-viewer")?.close?.();
    this.querySelector(".viewer-stage")?.replaceChildren?.();
    this._viewerCard?.remove?.();
    this._viewerCard = null;
    this._viewerPromise = null;
    this._viewerGesture = null;
    if (CameraDashboardCameraCard.activeViewer === this) CameraDashboardCameraCard.activeViewer = null;
    if (restoreFocus) this.querySelector(".camera-view")?.focus?.();
  }

  _closeEditor(restoreFocus = true) {
    this.querySelector("dialog.camera-dialog")?.close?.();
    this._open = false;
    this._draft = null;
    this._error = "";
    this._reorderKeys = null;
    if (CameraDashboardCameraCard.activeEditor === this) CameraDashboardCameraCard.activeEditor = null;
    if (restoreFocus) this.querySelector(".camera-edit")?.focus?.();
  }

  async _save() {
    if (this._saving || !this._hass?.user?.is_admin) return;
    const fields = this.querySelector("form[data-camera-editor]")?.elements;
    if (!fields) return;
    const value = (name) => fields.namedItem(name).value;
    const patch = {
      category: value("category"), name: value("name").trim(),
      image_entity: value("image_entity"),
      camera_view: value("camera_view"), fit_mode: value("fit_mode"),
      hidden: fields.namedItem("hidden").checked,
    };
    this._draft = { ...this._config.option, ...patch };
    this._saving = true;
    const submit = this.querySelector(".camera-actions button[type=submit]");
    if (submit) { submit.disabled = true; submit.textContent = "Saving…"; }
    for (const button of this.querySelectorAll?.(".camera-dialog button[data-action]") || []) {
      button.disabled = true;
    }
    try {
      const url_path = currentDashboardPath();
      const raw = await this._hass.callWS({ type: "lovelace/config", url_path, force: false });
      if (raw.strategy?.type !== STRATEGY_TYPE) throw new Error("Dashboard strategy mismatch.");
      const camera_options = { ...raw.strategy.camera_options,
        [this._config.camera_key]: { ...raw.strategy.camera_options?.[this._config.camera_key], ...patch } };
      if (this._reorderKeys && patch.category === (this._config.option?.category || "") && !patch.hidden) {
        this._reorderKeys.forEach((key, index) => {
          camera_options[key] = { ...camera_options[key], order: index + 1 };
        });
      }
      await this._hass.callWS({ type: "lovelace/config/save", url_path,
        config: { ...raw, strategy: { ...raw.strategy, camera_options } } });
      this._config.option = camera_options[this._config.camera_key];
      this._saving = false;
      this._closeEditor();
      showCameraToast("Camera saved");
      this.dispatchEvent(new Event("config-refresh", { bubbles: true, composed: true }));
    } catch (error) {
      this._error = `Save failed: ${error.message || error}`;
      this._saving = false;
      const message = this.querySelector(".camera-dialog .camera-error");
      if (message) { message.textContent = this._error; message.hidden = false; }
      if (submit) { submit.disabled = false; submit.textContent = "Save camera"; }
      for (const button of this.querySelectorAll?.(".camera-dialog button[data-action]") || []) {
        button.disabled = false;
      }
    }
  }
}

class CameraDashboardManager extends CameraDashboardEditor {
  constructor() {
    super();
    this._mode = "manage";
    this._ready = false;
    this._setupError = "";
  }

  setConfig() {}

  set hass(hass) {
    super.hass = hass;
    this._ensureSetup();
  }

  get hass() { return super.hass; }

  connectedCallback() {
    super.connectedCallback();
    this._ensureSetup();
  }

  render() {
    if (!this.isConnected) return;
    if (!this._ready) {
      this.innerHTML = `${styles}<div class="panel"><h2>ONVIF Camera Dashboard</h2>
        ${this._setupError ? `<p class="error" role="alert">${esc(this._setupError)}</p>
          <button type="button" data-action="retry-settings">Retry loading settings</button>`
          : "<p>Loading dashboard settings…</p>"}</div>`;
      return;
    }
    super.render();
  }

  async _click(event) {
    if (event.target?.dataset?.action === "retry-settings") {
      if (!this._setupError) return;
      this._setupError = "";
      this._setupPromise = null;
      this.render();
      await this._ensureSetup();
      return;
    }
    await super._click(event);
  }

  async _ensureSetup() {
    if (!this.isConnected || !this._hass || this._setupPromise) return;
    this._dashboardPath = currentDashboardPath();
    this._setupPromise = (async () => {
      try {
        const [raw, dashboards] = await Promise.all([
          this._hass.callWS({ type: "lovelace/config", url_path: this._dashboardPath, force: false }),
          this._hass.callWS({ type: "lovelace/dashboards/list" }),
        ]);
        if (raw.strategy?.type !== STRATEGY_TYPE) throw new Error("Dashboard strategy mismatch.");
        this._config = { ...raw.strategy };
        this._dashboards = Array.isArray(dashboards) ? dashboards : [];
        this._setupError = "";
        this._ready = true;
        this.render();
      } catch (error) {
        this._setupError = `Could not load dashboard settings: ${error.message || error}`;
        this.render();
      }
    })();
    await this._setupPromise;
  }
}

customElements.define("ll-strategy-dashboard-onvif-camera-dashboard", CameraDashboardStrategy);
customElements.define("onvif-camera-dashboard-editor", CameraDashboardEditor);
customElements.define("onvif-camera-dashboard-manager", CameraDashboardManager);
customElements.define("onvif-camera-dashboard-camera-card", CameraDashboardCameraCard);

window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((strategy) => strategy.type === "onvif-camera-dashboard")) {
  window.customStrategies.push({
    type: "onvif-camera-dashboard", strategyType: "dashboard",
    name: "ONVIF Camera Dashboard",
    description: "Automatically organize configured ONVIF cameras by area, floor, or custom tab.",
  });
}
