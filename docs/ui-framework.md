# UI Framework

The dashboard uses a local Tremor Raw-compatible server-rendered layer in `src/tremor-dashboard.js`.

Tremor's current framework target is React 18.2+ with Tailwind CSS 4.0+. This control plane is a vanilla Node server-rendered app, so the migration keeps the existing Node runtime and moves dashboard rendering through Tremor-style primitives instead of adding a separate React build pipeline.

Current contracts:

- `data-ui-framework="tremor-raw-dashboard"` marks the rendered dashboard shell.
- `data-tremor-component` marks Tremor primitives used by tests and future frontend migration.
- `src/tremor-dashboard.js` owns card, tab navigation, badge, metric, and framework metadata rendering.
- Dark and light themes are tokenized in the dashboard CSS and toggled through `data-theme`.

If the app later moves to a React frontend, this layer is the replacement boundary for Tremor React or Tremor Raw components.
