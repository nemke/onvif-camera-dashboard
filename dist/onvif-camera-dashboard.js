import { STRATEGY_TYPE, UNASSIGNED, eligibleCameras, generateDashboard, importDashboard } from "./core.js";

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
    .icon-select { flex:1; min-width:180px; }
    .icon-select ha-selector { display:block; width:100%; }
    .small { flex:0 0 90px; min-width:90px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }
    .import { margin-top:20px; } .import summary { cursor:pointer; }
    .error { color:var(--error-color,#d32f2f); }
    .success { color:var(--success-color,#2e7d32); }
  </style>`;

function currentDashboardPath() {
  return decodeURIComponent(window.location.pathname.split("/").filter(Boolean)[0] || "lovelace");
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

  _setConfig(config) {
    this._config = config;
    this._status = "Unsaved changes";
    if (this._mode === "create") this._emit();
    this.render();
  }

  _change(event) {
    const field = event.target?.dataset?.field;
    if (!field) return;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (field === "group_by") {
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
    }
  }

  async _click(event) {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "add-category") {
      const id = `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this._setConfig({
        ...this._config, categories: [...(this._config.categories || []),
          { id, title: "New tab", icon: "mdi:cctv", max_columns: 4 }],
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
    const groups = [...this._groupOptions(), {
      id: UNASSIGNED, title: "Unassigned", icon: "mdi:help-circle-outline",
      ...this._config.group_options?.[UNASSIGNED],
    }];
    if (!groups.length) return `<p class="hint">No categories yet.</p>`;
    return groups.map((group) => `<div class="item">
      <div class="row">
        <label>Name<input data-field="title" data-group-id="${esc(group.id)}" value="${esc(group.title)}"></label>
        <div class="icon-select">${this._iconPickerReady && this._hass
          ? `<ha-selector data-group-id="${esc(group.id)}" data-icon="${esc(group.icon)}"></ha-selector>`
          : `<span class="hint">${this._iconPickerError ? "Icon picker unavailable" : "Loading icons…"}</span>`}</div>
        <label class="small">Columns<input type="number" min="1" max="4" data-field="max_columns"
          data-group-id="${esc(group.id)}" value="${esc(group.max_columns || 4)}"></label>
        ${custom && group.id !== UNASSIGNED ? `<button data-action="move-category" data-group-id="${esc(group.id)}" data-offset="-1" title="Move up">↑</button>
          <button data-action="move-category" data-group-id="${esc(group.id)}" data-offset="1" title="Move down">↓</button>
          <button data-action="remove-category" data-group-id="${esc(group.id)}">Remove</button>` : ""}
      </div>
    </div>`).join("");
  }

  render() {
    if (!this.isConnected) return;
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
      <h3>Tabs</h3>${this._groupRows()}
      ${custom ? `<button data-action="add-category">Add tab</button>` : ""}
      ${this._mode === "manage" ? `
        <details class="import"><summary>Import tabs from an existing dashboard</summary>
        <div class="row"><label>Source dashboard<select id="source-dashboard">
          <option value="">Choose dashboard</option>
          ${this._dashboards.filter((item) => item.url_path && item.url_path !== this._dashboardPath)
            .map((item) => `<option value="${esc(item.url_path)}">${esc(item.title || item.url_path)}</option>`).join("")}
        </select></label><button data-action="import">Import into draft</button></div>
        <p class="hint">Imports tab names, icons, layout, and camera placement. Review the tabs before saving.</p></details>
        <div class="actions"><button class="primary" data-action="save">Save dashboard</button></div>
        <p class="${this._status === "Saved" ? "success" : "hint"}">${esc(this._status)}</p>
      ` : ""}
    </div>`;
    for (const picker of this.querySelectorAll("ha-selector[data-group-id]")) {
      picker.hass = this._hass;
      picker.selector = { icon: {} };
      picker.value = picker.dataset.icon;
      picker.label = "Icon";
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

class CameraDashboardCameraCard extends HTMLElement {
  constructor() {
    super();
    this._open = false;
    this._saving = false;
    this.addEventListener("click", (event) => this._click(event));
  }

  setConfig(config) {
    if (!config?.camera?.entity || !config.camera_key) throw new Error("Camera card configuration is incomplete.");
    this._config = config;
    this._picture = null;
    this._picturePromise = null;
    this._pictureError = "";
    this._open = false;
    this._draft = null;
    this.render();
  }

  set hass(hass) {
    const wasAdmin = this._hass?.user?.is_admin;
    this._hass = hass;
    if (this._picture) this._picture.hass = hass;
    if (wasAdmin !== hass.user?.is_admin) this.render();
  }

  get hass() { return this._hass; }

  connectedCallback() { this.render(); }

  disconnectedCallback() {
    if (CameraDashboardCameraCard.activeEditor === this) CameraDashboardCameraCard.activeEditor = null;
  }

  getCardSize() { return this._open ? 5 : 3; }

  async _mountPicture() {
    if (this._config?.option?.hidden) return;
    if (this._picture) {
      this.querySelector(".camera-picture")?.replaceChildren(this._picture);
      return;
    }
    if (this._picturePromise || this._pictureError || !this._config) return;
    this._picturePromise = (async () => {
      try {
        const helpers = await window.loadCardHelpers();
        this._picture = helpers.createCardElement(this._config.camera);
        if (this._hass) this._picture.hass = this._hass;
        this.querySelector(".camera-picture")?.replaceChildren(this._picture);
      } catch (error) {
        this._pictureError = `Could not load camera card: ${error.message || error}`;
        this.render();
      }
    })();
    await this._picturePromise;
  }

  render() {
    if (!this.isConnected || !this._config) return;
    const option = this._draft || this._config.option || {};
    const image = option.image_entity || this._config.camera.camera_image;
    const imageChoices = [...new Set([...this._config.image_entities, image])];
    this.innerHTML = `<style>
      onvif-camera-dashboard-camera-card .camera-shell { position:relative; }
      onvif-camera-dashboard-camera-card .camera-picture { display:block; }
      onvif-camera-dashboard-camera-card .hidden-camera { display:flex; flex-direction:column;
        justify-content:center; min-height:80px; padding:12px 16px 12px 58px; box-sizing:border-box;
        color:var(--secondary-text-color,#666);
        background:var(--ha-card-background,var(--card-background-color,#fff));
        border-radius:var(--ha-card-border-radius,12px); }
      onvif-camera-dashboard-camera-card .hidden-camera strong { color:var(--primary-text-color); }
      onvif-camera-dashboard-camera-card .camera-edit { position:absolute; bottom:8px; left:8px; z-index:1;
        display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0;
        border:0; border-radius:50%; background:rgba(0,0,0,.62); color:#fff; opacity:.85;
        cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.25); }
      onvif-camera-dashboard-camera-card .camera-edit:hover,
      onvif-camera-dashboard-camera-card .camera-edit:focus-visible { opacity:1; background:rgba(0,0,0,.85); }
      onvif-camera-dashboard-camera-card .camera-edit ha-icon { --mdc-icon-size:20px; }
      onvif-camera-dashboard-camera-card .camera-editor button { font:inherit; cursor:pointer; border:0;
        border-radius:8px; padding:8px 12px;
        color:var(--primary-text-color); background:var(--secondary-background-color,#eee); }
      onvif-camera-dashboard-camera-card button:disabled { opacity:.5; cursor:default; }
      onvif-camera-dashboard-camera-card button.primary { color:#fff; background:var(--primary-color,#03a9f4); }
      onvif-camera-dashboard-camera-card .camera-editor { padding:12px; margin-top:8px; border-radius:12px;
        color:var(--primary-text-color); background:var(--ha-card-background,var(--card-background-color,#fff)); }
      onvif-camera-dashboard-camera-card .camera-editor h3 { margin:0 0 12px; font-size:1rem; }
      onvif-camera-dashboard-camera-card .camera-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
      onvif-camera-dashboard-camera-card .camera-fields label { display:flex; flex-direction:column; gap:4px; font-size:.87rem; }
      onvif-camera-dashboard-camera-card .camera-fields label.check { flex-direction:row; align-items:center; }
      onvif-camera-dashboard-camera-card .camera-fields input:not([type=checkbox]),
      onvif-camera-dashboard-camera-card .camera-fields select { box-sizing:border-box; width:100%;
        min-height:38px; padding:6px 8px; font:inherit; border-radius:6px;
        color:var(--primary-text-color); background:var(--card-background-color,#fff);
        border:1px solid var(--divider-color,#aaa); }
      onvif-camera-dashboard-camera-card .camera-actions { display:flex; gap:8px; margin-top:12px; }
      onvif-camera-dashboard-camera-card .camera-error { color:var(--error-color,#d32f2f); margin:8px 0; }
    </style>
    <div class="camera-shell">
      ${this._config.option?.hidden
        ? `<div class="hidden-camera"><strong>${esc(this._config.camera.name)}</strong><span>Hidden from dashboard</span></div>`
        : `<div class="camera-picture"></div>`}
      ${this._pictureError ? `<div class="camera-error" role="alert">${esc(this._pictureError)}</div>` : ""}
      ${this._hass?.user?.is_admin ? `<button class="camera-edit" type="button" data-action="edit"
        aria-expanded="${this._open}" aria-label="${this._open ? "Close editor for" : "Edit"} ${esc(this._config.camera.name)}"
        title="${this._open ? "Close editor" : "Edit camera"}" ${this._saving ? "disabled" : ""}>
        <ha-icon icon="mdi:${this._open ? "close" : "pencil"}" aria-hidden="true"></ha-icon></button>` : ""}
    </div>
    ${this._open && this._hass?.user?.is_admin ? `<div class="camera-editor">
      <h3>Edit ${esc(this._config.camera.name)}</h3>
      <form data-camera-editor>
        <div class="camera-fields">
          <label>Category<select name="category">
            <option value="" ${!option.category ? "selected" : ""}>${this._config.group_by === "custom" ? "Unassigned" : "Automatic"}</option>
            ${this._config.groups.map((group) => `<option value="${esc(group.id)}" ${option.category === group.id ? "selected" : ""}>${esc(group.title)}</option>`).join("")}
            <option value="${UNASSIGNED}" ${option.category === UNASSIGNED ? "selected" : ""}>Unassigned</option>
          </select></label>
          <label>Display name<input name="name" value="${esc(option.name || "")}" placeholder="${esc(this._config.camera.name)}"></label>
          <label>Order<input name="order" type="number" value="${esc(option.order || 0)}"></label>
          <label>Image / stream entity<select name="image_entity">
            ${imageChoices.map((entity) => `<option value="${esc(entity)}" ${image === entity ? "selected" : ""}>${esc(entity)}</option>`).join("")}
          </select></label>
          <label>Camera view<select name="camera_view">
            ${["auto", "live"].map((value) => `<option value="${value}" ${(option.camera_view || this._config.camera.camera_view) === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
          <label>Image fit<select name="fit_mode">
            ${["contain", "cover", "fill"].map((value) => `<option value="${value}" ${(option.fit_mode || this._config.camera.fit_mode) === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
          <label class="check"><input name="hidden" type="checkbox" ${option.hidden ? "checked" : ""}> Hide camera</label>
        </div>
        ${this._error ? `<p class="camera-error" role="alert">${esc(this._error)}</p>` : ""}
        <div class="camera-actions"><button type="submit" class="primary" ${this._saving ? "disabled" : ""}>${this._saving ? "Saving…" : "Save camera"}</button>
          <button type="button" data-action="cancel" ${this._saving ? "disabled" : ""}>Cancel</button></div>
      </form>
    </div>` : ""}`;
    const form = this.querySelector("form[data-camera-editor]");
    form?.addEventListener("submit", (event) => { event.preventDefault(); this._save(); });
    if (!this._config.option?.hidden) this._mountPicture();
  }

  _click(event) {
    const action = event.target?.closest?.("button[data-action]")?.dataset.action;
    if (action !== "edit" && action !== "cancel") return;
    if (this._saving) return;
    const opening = action === "edit" && !this._open;
    if (opening && CameraDashboardCameraCard.activeEditor && CameraDashboardCameraCard.activeEditor !== this) {
      CameraDashboardCameraCard.activeEditor._open = false;
      CameraDashboardCameraCard.activeEditor._draft = null;
      CameraDashboardCameraCard.activeEditor.render();
    }
    this._open = opening;
    CameraDashboardCameraCard.activeEditor = opening ? this : null;
    this._error = "";
    this._draft = null;
    this.render();
  }

  async _save() {
    if (this._saving || !this._hass?.user?.is_admin) return;
    const fields = this.querySelector("form[data-camera-editor]")?.elements;
    if (!fields) return;
    const value = (name) => fields.namedItem(name).value;
    const patch = {
      category: value("category"), name: value("name").trim(),
      order: Number(value("order")) || 0, image_entity: value("image_entity"),
      camera_view: value("camera_view"), fit_mode: value("fit_mode"),
      hidden: fields.namedItem("hidden").checked,
    };
    this._draft = { ...this._config.option, ...patch };
    this._saving = true;
    this.render();
    try {
      const url_path = currentDashboardPath();
      const raw = await this._hass.callWS({ type: "lovelace/config", url_path, force: false });
      if (raw.strategy?.type !== STRATEGY_TYPE) throw new Error("Dashboard strategy mismatch.");
      const camera_options = { ...raw.strategy.camera_options,
        [this._config.camera_key]: { ...raw.strategy.camera_options?.[this._config.camera_key], ...patch } };
      await this._hass.callWS({ type: "lovelace/config/save", url_path,
        config: { ...raw, strategy: { ...raw.strategy, camera_options } } });
      if (patch.hidden !== Boolean(this._config.option?.hidden)) {
        window.location.assign(`/${encodeURIComponent(url_path)}`);
      } else {
        window.location.reload();
      }
    } catch (error) {
      this._error = `Save failed: ${error.message || error}`;
      this._saving = false;
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
customElements.define("onvif-camera-dashboard-camera-card", CameraDashboardCameraCard);

window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((strategy) => strategy.type === "onvif-camera-dashboard")) {
  window.customStrategies.push({
    type: "onvif-camera-dashboard", strategyType: "dashboard",
    name: "ONVIF Camera Dashboard",
    description: "Automatically organize configured ONVIF cameras by area, floor, or custom tab.",
  });
}
