# ONVIF Camera Dashboard

[![Open ONVIF Camera Dashboard in the Home Assistant Marketplace](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=nemke&repository=onvif-camera-dashboard&category=plugin)

A Home Assistant dashboard plugin that adds every **configured, enabled ONVIF camera entity** to a camera dashboard. It organizes camera tabs by Home Assistant area or floor, or by categories you create. New camera entities appear automatically after ONVIF setup succeeds.

![Illustration of the generated camera tabs](https://raw.githubusercontent.com/nemke/onvif-camera-dashboard/main/docs/preview.svg)

## Features

- Native Sections views and `picture-entity` camera cards.
- Area, floor, or custom category tabs with editable names and icons.
- Camera order, display name, image entity, and visibility controls.
- An **Unassigned** tab for cameras without a category.
- A **Manage** tab for administrators, with an importer for an existing camera dashboard.
- Multiple ONVIF profiles stay separate. A card may use a different `camera_image` entity, as in the supplied Hallway example.

The plugin reads camera entities that Home Assistant's ONVIF integration has already created. ONVIF network discovery, camera credentials, and stream troubleshooting remain in Home Assistant's ONVIF setup.

## Install locally

Requires Home Assistant **2026.11.0 or newer**.

1. Run `npm run build` in this repository. No dependencies need installing.
2. Copy **both** files from `dist/` into `/config/www/community/onvif-camera-dashboard/` on Home Assistant.
3. Add `/local/community/onvif-camera-dashboard/onvif-camera-dashboard.js` as a JavaScript module under **Settings → Dashboards → Resources**.
4. Reload Home Assistant in the browser.
5. Under **Settings → Dashboards**, add **ONVIF Camera Dashboard** from Community dashboards.

If the Community dashboards picker is unavailable, create a new storage-mode dashboard and use this raw configuration:

```yaml
strategy:
  type: custom:onvif-camera-dashboard
  group_by: area
```

Open its **Manage** tab to change the grouping and camera settings. To migrate a dashboard like the one in the project brief, choose that dashboard under **Import an existing dashboard**, select **Import into draft**, review the categories and camera rows, then select **Save dashboard**. Import reads the source dashboard and updates only the new dashboard when saved.

## Marketplace packaging

The repository includes `hacs.json`, a built `dist/` folder, and a HACS validation workflow for a Dashboard plugin. Marketplace installation registers the JavaScript resource automatically. The badge above can install it as a custom repository while catalog review is pending.

## Development

```sh
npm test
npm run build
```

The strategy and management UI are in `src/onvif-camera-dashboard.js`. Camera filtering, grouping, generation, and import are in `src/core.js`.

## Notes

- The Manage tab is generated only for Home Assistant administrators. Other users can view the camera tabs.
- Camera assignments are stored in this dashboard's strategy configuration. The management UI saves through Home Assistant's dashboard WebSocket API.
- Enabled ONVIF camera entities are included even if their current state is `unavailable`; disabled entities have no usable card until enabled in Home Assistant.
- The plugin does not change ONVIF integrations, camera credentials, existing dashboards, or Home Assistant area and floor assignments.
