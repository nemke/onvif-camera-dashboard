import {
  STRATEGY_TYPE, UNASSIGNED, cameraKey, cameraOption, eligibleCameras,
  generateDashboard, importDashboard,
} from "./core.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

const styles = `
  <style>
    :host { display:block; color:var(--primary-text-color); font:inherit; }
    .panel { padding:20px; background:var(--ha-card-background,var(--card-background-color,#fff));
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
    button.primary { background:var(--primary-color,#03a9f4); border-color:var(--primary-color,#03a9f4); color:#fff; }
    button:disabled { opacity:.5; cursor:default; }
    .item { padding:12px; margin:8px 0; border:1px solid var(--divider-color,#ddd); border-radius:8px; }
    .item-title { font-weight:600; overflow-wrap:anywhere; }
    .small { flex:0 0 90px; min-width:90px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
    .error { color:var(--error-color,#d32f2f); }
    .success { color:var(--success-color,#2e7d32); }
  </style>`;

function currentDashboardPath() {
  return decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[0] || "lovelace");
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
      return generateDashboard(config, hass, entries);
    } catch (error) {
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

  _setConfig(config) {
    this._config = config;
    this._status = "Unsaved changes";
    if (this._mode === "create") this._emit();
    this.render();
  }

  _setCamera(entry, patch) {
    const key = cameraKey(entry);
    const option = { ...cameraOption(this._config, entry), ...patch };
    this._setConfig({
      ...this._config,
      camera_options: { ...this._config.camera_options, [key]: option },
    });
  }

  _change(event) {
    const field = event.target?.dataset?.field;
    if (!field) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "group_by" || field === "camera_view" || field === "fit_mode") {
      this._setConfig({ ...this._config, [field]: value });
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
        });
      } else {
        this._setConfig({
          ...this._config,
          group_options: {
            ...this._config.group_options,
            [groupId]: { ...this._config.group_options?.[groupId], [field]: adjusted },
          },
        });
      }
      return;
    }
    const entityId = event.target.dataset.entityId;
    const entry = this._entries.find((item) => item.entity_id === entityId);
    if (entry) this._setCamera(entry, {
      [field]: field === "order" ? Number(value) : value,
    });
  }

  async _click(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "add-category") {
      const id = `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this._setConfig({
        ...this._config, categories: [...(this._config.categories || []),
          { id, title: "New category", icon: "mdi:cctv", max_columns: 4 }],
      });
    } else if (action === "remove-category") {
      const id = event.target.dataset.groupId;
      const camera_options = { ...this._config.camera_options };
      for (const [key, option] of Object.entries(camera_options)) {
        if (option.category === id) camera_options[key] = { ...option, category: UNASSIGNED };
      }
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
    const groups = [...this._groupOptions(), {
      id: UNASSIGNED, title: "Unassigned", icon: "mdi:help-circle-outline",
      ...this._config.group_options?.[UNASSIGNED],
    }];
    if (!groups.length) return `<p class="hint">No categories yet.</p>`;
    return groups.map((group) => `<div class="item">
      <div class="row">
        <label>Name<input data-field="title" data-group-id="${esc(group.id)}" value="${esc(group.title)}"></label>
        <label>Icon<input data-field="icon" data-group-id="${esc(group.id)}" value="${esc(group.icon)}" placeholder="mdi:cctv"></label>
        <label class="small">Columns<input type="number" min="1" max="4" data-field="max_columns"
          data-group-id="${esc(group.id)}" value="${esc(group.max_columns || 4)}"></label>
        ${custom && group.id !== UNASSIGNED ? `<button data-action="move-category" data-group-id="${esc(group.id)}" data-offset="-1" title="Move up">↑</button>
          <button data-action="move-category" data-group-id="${esc(group.id)}" data-offset="1" title="Move down">↓</button>
          <button data-action="remove-category" data-group-id="${esc(group.id)}">Remove</button>` : ""}
      </div>
    </div>`).join("");
  }

  _cameraRows() {
    if (!this._entries.length) return `<p class="hint">No configured ONVIF camera entities found.</p>`;
    const groups = this._groupOptions();
    return this._entries.map((entry) => {
      const option = cameraOption(this._config, entry);
      const selected = option.category === undefined ? "" : option.category;
      const name = this._hass?.states?.[entry.entity_id]?.attributes?.friendly_name || entry.name || entry.entity_id;
      const image = option.image_entity || entry.entity_id;
      const imageChoices = this._entries.some((item) => item.entity_id === image)
        ? this._entries : [...this._entries, { entity_id: image }];
      return `<div class="item">
        <div class="item-title">${esc(name)}</div><div class="hint">${esc(entry.entity_id)}</div>
        <div class="row">
          <label>Category<select data-field="category" data-entity-id="${esc(entry.entity_id)}">
            <option value="" ${selected === "" ? "selected" : ""}>${this._config.group_by === "custom" ? "Unassigned" : "Automatic"}</option>
            ${groups.map((group) => `<option value="${esc(group.id)}" ${selected === group.id ? "selected" : ""}>${esc(group.title)}</option>`).join("")}
            <option value="${UNASSIGNED}" ${selected === UNASSIGNED ? "selected" : ""}>Unassigned</option>
          </select></label>
          <label>Display name<input data-field="name" data-entity-id="${esc(entry.entity_id)}"
            value="${esc(option.name || "")}" placeholder="${esc(name)}"></label>
          <label class="small">Order<input type="number" data-field="order" data-entity-id="${esc(entry.entity_id)}"
            value="${esc(option.order || 0)}"></label>
          <label class="check"><input type="checkbox" data-field="hidden" data-entity-id="${esc(entry.entity_id)}"
            ${option.hidden ? "checked" : ""}> Hide</label>
        </div>
        <div class="row"><label>Image / stream entity<select data-field="image_entity" data-entity-id="${esc(entry.entity_id)}">
          ${imageChoices.map((item) => `<option value="${esc(item.entity_id)}" ${image === item.entity_id ? "selected" : ""}>${esc(item.entity_id)}</option>`).join("")}
        </select></label></div>
      </div>`;
    }).join("");
  }

  render() {
    if (!this.isConnected) return;
    const custom = this._config.group_by === "custom";
    this.innerHTML = `${styles}<div class="panel">
      <h2>ONVIF Camera Dashboard</h2>
      <p>Configured ONVIF cameras appear automatically. Organize their dashboard tabs below.</p>
      ${this._error ? `<p class="error">${esc(this._error)}</p>` : ""}
      <div class="row">
        <label>Group cameras by<select data-field="group_by">
          ${[["area", "Area"], ["floor", "Floor"], ["custom", "Custom categories"]]
            .map(([value, title]) => `<option value="${value}" ${this._config.group_by === value ? "selected" : ""}>${title}</option>`).join("")}
        </select></label>
        <label>Camera view<select data-field="camera_view">
          ${["auto", "live"].map((value) => `<option value="${value}" ${this._config.camera_view === value ? "selected" : ""}>${value}</option>`).join("")}
        </select></label>
        <label>Image fit<select data-field="fit_mode">
          ${["contain", "cover", "fill"].map((value) => `<option value="${value}" ${(this._config.fit_mode || "contain") === value ? "selected" : ""}>${value}</option>`).join("")}
        </select></label>
      </div>
      <h3>Categories</h3>${this._groupRows()}
      ${custom ? `<button data-action="add-category">Add category</button>` : ""}
      <h3>Cameras (${this._entries.length})</h3>${this._cameraRows()}
      ${this._mode === "manage" ? `
        <h3>Import an existing dashboard</h3>
        <div class="row"><label>Source dashboard<select id="source-dashboard">
          <option value="">Choose dashboard</option>
          ${this._dashboards.filter((item) => item.url_path && item.url_path !== this._dashboardPath)
            .map((item) => `<option value="${esc(item.url_path)}">${esc(item.title || item.url_path)}</option>`).join("")}
        </select></label><button data-action="import">Import into draft</button></div>
        <p class="hint">Imports camera cards, tab names, icons, order, and layout. Review the draft before saving.</p>
        <div class="actions"><button class="primary" data-action="save">Save dashboard</button></div>
        <p class="${this._status === "Saved" ? "success" : "hint"}">${esc(this._status)}</p>
      ` : ""}
    </div>`;
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
      this._status = `Imported ${importedCameras} camera cards into the draft. Review and save.`;
      this.render();
    } catch (error) {
      this._status = `Import failed: ${error.message || error}`;
      this.render();
    }
  }

  async _save() {
    if (!this._hass?.user?.is_admin) return;
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
      this._status = "Saved";
      this.render();
    } catch (error) {
      this._status = `Save failed: ${error.message || error}`;
      this.render();
    }
  }
}

class CameraDashboardManager extends CameraDashboardEditor {
  constructor() {
    super();
    this._mode = "manage";
    this._ready = false;
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
        <p>${this._error ? esc(this._error) : "Loading dashboard settings…"}</p></div>`;
      return;
    }
    super.render();
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
      this._ready = true;
      this.render();
      } catch (error) {
        this._error = `Could not load dashboard settings: ${error.message || error}`;
        this.render();
      }
    })();
    await this._setupPromise;
  }
}

customElements.define("ll-strategy-dashboard-onvif-camera-dashboard", CameraDashboardStrategy);
customElements.define("onvif-camera-dashboard-editor", CameraDashboardEditor);
customElements.define("onvif-camera-dashboard-manager", CameraDashboardManager);

window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((strategy) => strategy.type === "onvif-camera-dashboard")) {
  window.customStrategies.push({
    type: "onvif-camera-dashboard", strategyType: "dashboard",
    name: "ONVIF Camera Dashboard",
    description: "Automatically organize configured ONVIF cameras by area, floor, or custom tab.",
  });
}
