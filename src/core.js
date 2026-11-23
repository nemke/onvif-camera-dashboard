export const STRATEGY_TYPE = "custom:onvif-camera-dashboard";
export const UNASSIGNED = "__unassigned";

export function cameraKey(entry) {
  return entry.unique_id ? `onvif:${entry.unique_id}` : entry.entity_id;
}

export function cameraOption(config, entry) {
  return config.camera_options?.[cameraKey(entry)]
    ?? config.camera_options?.[entry.entity_id]
    ?? {};
}

export function eligibleCameras(entries) {
  return entries.filter((entry) =>
    entry.entity_id?.startsWith("camera.")
    && entry.platform === "onvif"
    && !entry.disabled_by
  );
}

export function getAreaId(entry, hass) {
  return entry.area_id || hass.devices?.[entry.device_id]?.area_id || null;
}

export function groupForCamera(entry, config, hass) {
  const option = cameraOption(config, entry);
  if (option.category !== undefined) {
    const valid = option.category === UNASSIGNED
      || (config.group_by === "custom"
        ? (config.categories || []).some((group) => group.id === option.category)
        : config.group_by === "floor"
          ? option.category.startsWith("floor:") && Boolean(hass.floors?.[option.category.slice(6)])
          : option.category.startsWith("area:") && Boolean(hass.areas?.[option.category.slice(5)]));
    if (valid) return option.category;
  }
  const areaId = getAreaId(entry, hass);
  if (config.group_by === "floor") {
    const floorId = areaId && hass.areas?.[areaId]?.floor_id;
    return floorId ? `floor:${floorId}` : UNASSIGNED;
  }
  if (config.group_by === "area") {
    return areaId ? `area:${areaId}` : UNASSIGNED;
  }
  return UNASSIGNED;
}

export function slug(value) {
  return String(value).toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group";
}

export function groupsFor(config, hass, cameras) {
  const mode = config.group_by || "area";
  let groups;
  if (mode === "custom") {
    groups = (config.categories || []).map((group) => ({ ...group }));
  } else if (mode === "floor") {
    groups = Object.values(hass.floors || {}).map((floor) => ({
      id: `floor:${floor.floor_id}`, title: floor.name, icon: floor.icon || "mdi:layers",
    }));
  } else {
    groups = Object.values(hass.areas || {}).map((area) => ({
      id: `area:${area.area_id}`, title: area.name, icon: area.icon || "mdi:map-marker",
    }));
  }
  groups = groups.map((group) => ({
    ...group,
    ...(config.group_options?.[group.id] || {}),
  }));
  if (mode !== "custom") {
    const used = new Set(cameras.map((entry) => groupForCamera(entry, config, hass)));
    groups = groups.filter((group) => used.has(group.id));
    groups.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (cameras.some((entry) => groupForCamera(entry, config, hass) === UNASSIGNED)) {
    groups.push({
      id: UNASSIGNED, title: "Unassigned", icon: "mdi:help-circle-outline",
      ...(config.group_options?.[UNASSIGNED] || {}),
    });
  }
  return groups;
}

function cameraName(entry, option, hass) {
  return option.name
    || hass.states?.[entry.entity_id]?.attributes?.friendly_name
    || entry.name
    || entry.entity_id;
}

export function generateDashboard(config, hass, entries) {
  const eligible = eligibleCameras(entries);
  const imageEntities = eligible.map(({ entity_id }) => entity_id);
  const cameras = eligible.filter((entry) => !cameraOption(config, entry).hidden);
  const hiddenCameras = hass.user?.is_admin
    ? eligible.filter((entry) => cameraOption(config, entry).hidden) : [];
  const groups = groupsFor(config, hass, cameras);
  const categoryChoices = (config.group_by === "custom" ? config.categories || []
    : config.group_by === "floor" ? Object.values(hass.floors || {}).map((floor) => ({
      id: `floor:${floor.floor_id}`, title: floor.name,
    })) : Object.values(hass.areas || {}).map((area) => ({
      id: `area:${area.area_id}`, title: area.name,
    }))).map(({ id, title }) => ({ id, title: config.group_options?.[id]?.title || title }));
  if (!groups.length && !hiddenCameras.length) {
    groups.push({ id: UNASSIGNED, title: "Cameras", icon: "mdi:cctv" });
  }

  const cameraCard = (entry) => {
    const option = cameraOption(config, entry);
    const camera = {
      type: "picture-entity",
      entity: entry.entity_id,
      camera_image: option.image_entity || entry.entity_id,
      name: cameraName(entry, option, hass),
      show_name: true,
      show_state: false,
      camera_view: option.camera_view || config.camera_view || "auto",
      fit_mode: option.fit_mode || config.fit_mode || "contain",
      tap_action: { action: "none" },
    };
    return {
      type: "custom:onvif-camera-dashboard-camera-card",
      camera,
      camera_key: cameraKey(entry),
      option,
      groups: categoryChoices,
      image_entities: imageEntities,
      group_by: config.group_by || "area",
    };
  };

  const views = groups.map((group) => {
    const groupCameras = cameras
      .filter((entry) => groupForCamera(entry, config, hass) === group.id)
      .sort((a, b) => {
        const left = cameraOption(config, a);
        const right = cameraOption(config, b);
        return (Number(left.order) || 0) - (Number(right.order) || 0)
          || cameraName(a, left, hass).localeCompare(cameraName(b, right, hass));
      });
    const sections = groupCameras.length
      ? groupCameras.map((entry) => ({ type: "grid", cards: [cameraCard(entry)] }))
      : [{ type: "grid", cards: [{
        type: "markdown", content: "No ONVIF cameras in this category yet.",
      }] }];
    return {
      type: "sections",
      path: group.id === UNASSIGNED ? "unassigned" : `camera-${slug(group.id)}`,
      title: group.title,
      icon: group.icon,
      show_icon_and_title: true,
      max_columns: Math.max(1, Math.min(4, Number(group.max_columns) || 2)),
      sections,
      cards: [],
    };
  });

  if (hass.user?.is_admin) {
    if (hiddenCameras.length) {
      views.push({
        title: "Hidden", path: "hidden-cameras", icon: "mdi:eye-off-outline",
        type: "sections", max_columns: 1,
        sections: [{ type: "grid", cards: [
          { type: "heading", heading: "Hidden cameras", heading_style: "title", icon: "mdi:eye-off-outline" },
          ...hiddenCameras.sort((a, b) => cameraName(a, cameraOption(config, a), hass)
            .localeCompare(cameraName(b, cameraOption(config, b), hass))).map(cameraCard),
        ] }],
        cards: [],
      });
    }
    views.push({
      title: "Settings", path: "manage", icon: "mdi:cog", type: "sections", max_columns: 1,
      sections: [{ type: "grid", cards: [{ type: "custom:onvif-camera-dashboard-manager" }] }],
      cards: [],
    });
  }
  return { title: "ONVIF Cameras", views };
}

export function importDashboard(source, base = {}, entries = null) {
  const next = {
    ...base, type: STRATEGY_TYPE, group_by: "custom", categories: [],
    camera_options: { ...(base.camera_options || {}) },
  };
  let count = 0;
  for (const [viewIndex, view] of (source.views || []).entries()) {
    const cards = (view.sections || []).flatMap((section) => section.cards || []);
    const cameras = cards.filter((card) =>
      card.type === "picture-entity" && card.entity?.startsWith("camera.")
      && (!entries || entries.some((entry) => entry.entity_id === card.entity)));
    if (!cameras.length) continue;
    const heading = cards.find((card) => card.type === "heading");
    const title = view.title || heading?.heading || `Category ${viewIndex + 1}`;
    const id = `custom:${slug(view.path || title)}-${viewIndex}`;
    next.categories.push({
      id, title, icon: view.icon || heading?.icon || "mdi:cctv",
      max_columns: view.max_columns || 2,
    });
    for (const [index, card] of cameras.entries()) {
      const entry = entries?.find((item) => item.entity_id === card.entity);
      const key = entry ? cameraKey(entry) : card.entity;
      next.camera_options[key] = {
        ...next.camera_options[key],
        category: id,
        name: card.name || "",
        image_entity: card.camera_image || card.entity,
        camera_view: card.camera_view || "auto",
        fit_mode: card.fit_mode || "contain",
        tap_action: card.tap_action?.action || "none",
        order: index + 1,
      };
      count++;
    }
  }
  return { config: next, importedCameras: count };
}
