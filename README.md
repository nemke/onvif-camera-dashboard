# ONVIF Camera Dashboard

![ONVIF Camera Dashboard icon](https://raw.githubusercontent.com/nemke/onvif-camera-dashboard/main/docs/icon.png)

[![Open ONVIF Camera Dashboard in the Home Assistant Marketplace](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=nemke&repository=onvif-camera-dashboard&category=plugin)

A Home Assistant dashboard plugin that adds every **configured, enabled ONVIF camera entity** to a camera dashboard. It organizes camera tabs by Home Assistant area or floor, or by categories you create. New camera entities appear automatically after ONVIF setup succeeds.

![Illustration of the generated camera tabs](https://raw.githubusercontent.com/nemke/onvif-camera-dashboard/main/docs/preview.svg)

## Features

- Responsive camera columns using native Sections views and `picture-entity` camera cards. Each tab defaults to two columns on wide screens and one on narrow screens.
- Tap a visible feed to open a nearly full-screen live viewer on desktop or a full-screen viewer on mobile. The viewer preserves the stream's aspect ratio, including 4:3 feeds. It loads the selected stream on opening and removes its live card on closing. Use the close button or Escape to return to the same tab.
- Camera tiles keep a compact name label visible. They show an unavailable or missing-source message when Home Assistant reports a problem, and detect broken previews even when the camera entity remains available. Preview failures offer Retry. A subtle expand icon appears on hover, keyboard focus, and touch screens.
- Swipe left or right on a camera tab to switch between camera categories. In the full-screen viewer, swipe between cameras in the current category, or use the previous/next buttons. Two-finger zoom remains available in the viewer. Swipes stop at the first and last camera or category.
- Area, floor, or custom category tabs with editable names and a searchable Home Assistant icon picker.
- A visual camera order list with Move earlier/later controls, plus display name, image entity, and visibility controls. Successful camera edits show a short confirmation.
- An admin-only 44 px edit button at the top right of each feed. It appears on hover or keyboard focus on desktops and stays visible on touch screens. Camera settings open in a dialog, with common choices first and advanced choices tucked away. Saving refreshes the dashboard without reloading the browser page.
- An admin-only **Hidden** tab for restoring hidden cameras without showing them among live feeds. Hidden and Settings show text labels alongside their icons.
- An **Unassigned** tab for cameras without a category.
- An optional inbox setting that puts ONVIF cameras added later into Unassigned until you place them, while keeping existing cameras in their current tabs.
- An administrator **Settings** tab for managing tabs, with unused areas or floors folded away, a sticky Save control, a retry button after settings load failures, and an optional importer for an existing dashboard.
- Multiple ONVIF profiles stay separate. A card can use a different camera entity as its image or stream source.

The plugin reads camera entities that Home Assistant's ONVIF integration has already created. ONVIF network discovery, camera credentials, and stream troubleshooting remain in Home Assistant's ONVIF setup.

## Install from Marketplace

Requires Home Assistant **2026.11.0 or newer**.

1. Select the Marketplace badge above to open this repository in Home Assistant, or search for **ONVIF Camera Dashboard** under **Settings → Marketplace**.
2. Open **ONVIF Camera Dashboard** in Marketplace and select **Install**.
3. Reload Home Assistant in your browser. If an older version still appears, do a hard refresh.
4. Under **Settings → Dashboards**, add **ONVIF Camera Dashboard** from Community dashboards.

If the Community dashboards picker is unavailable, create a new storage-mode dashboard and use this raw configuration:

```yaml
strategy:
  type: custom:onvif-camera-dashboard
  group_by: area
```

Open its **Settings** tab to set up the tabs and their maximum **Camera columns**. Home Assistant reduces the number of columns on narrower screens. To route future ONVIF cameras to Unassigned first, select **Put newly added ONVIF cameras in Unassigned** and save. Swipe between camera tabs, or tap a feed to see it larger and swipe among the cameras in that tab. The Settings and Hidden tabs stay outside the swipe sequence. Use the pencil icon to change a camera's name, tab, image entity, order, view, or visibility. Hidden cameras appear only in the administrator **Hidden** tab, where you can edit them to show them again. To migrate an existing dashboard, expand **Import tabs from an existing dashboard**, choose the source, select **Import into draft**, review the tabs, then select **Save dashboard**. Import reads the source dashboard and updates only the new dashboard when saved.

## Manual installation

If you cannot use Marketplace, build and install the plugin directly:

1. Run `npm run build` in this repository. No dependencies need installing.
2. Copy **both** files from `dist/` into `/config/www/community/onvif-camera-dashboard/` on Home Assistant.
3. Add `/local/community/onvif-camera-dashboard/onvif-camera-dashboard.js?v=0.1.15` as a JavaScript module under **Settings → Dashboards → Resources**.
4. Reload Home Assistant in the browser. Change the URL version when installing a newer build.

Marketplace installs register the resource automatically; keep only one resource entry for this plugin.

## Development

```sh
npm test
npm run build
```

The strategy and management UI are in `src/onvif-camera-dashboard.js`. Camera filtering, grouping, generation, and import are in `src/core.js`.

## Notes

- The Settings tab is generated only for Home Assistant administrators. Other users can view the camera tabs.
- Camera assignments are stored in this dashboard's strategy configuration. The management UI saves through Home Assistant's dashboard WebSocket API.
- Enabled ONVIF camera entities are included even if their current state is `unavailable`; disabled entities have no usable card until enabled in Home Assistant.
- The plugin does not change ONVIF integrations, camera credentials, existing dashboards, or Home Assistant area and floor assignments.
