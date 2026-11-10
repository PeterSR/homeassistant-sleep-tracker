Don't try to make backwards compatible.
When making breaking changes, simply tell me what I need to update or delete to start fresh.

# Sleep Tracker - Custom Home Assistant Integration

Per-user sleep tracking with pulse-based timeline reconstruction, sidebar panel, and REST export.

## Project Structure

```
custom_components/sleep_tracker/   # HA custom component (Python)
  __init__.py                      # Entry point, panel registration, platform forwarding
  coordinator.py                   # Session management, entity notification, state queries
  models.py                        # Data models (UserConfig, SleepSession, SleepPulse, TimelineInterval)
  store.py                         # Persistent storage (.storage/sleep_tracker)
  timeline.py                      # Pure-function timeline reconstruction algorithm
  sensor.py                        # Per-user sensor entities (last_awake, session_start, sleep_duration, awake_count)
  binary_sensor.py                 # Per-user binary sensor (sleeping)
  websocket_api.py                 # WS commands (frontend <-> backend)
  services.py                      # HA service definitions for automations
  services.yaml                    # Service UI schemas
  export.py                        # REST POST of finalized sessions
  config_flow.py                   # Singleton integration setup
  const.py                         # Constants

tests/                             # pytest suite (pytest-homeassistant-custom-component, run with uv run pytest)

frontend/                          # Lit + TypeScript panel
  src/
    sleep-tracker-panel.ts         # Main panel with router
    api.ts                         # WebSocket API wrapper
    types.ts                       # TypeScript interfaces
    styles.ts                      # Design tokens + shared CSS
    utils.ts                       # Time formatting utilities
    views/
      main-view.ts                 # Start/stop sleep + active session
      night-detail-view.ts         # Single night timeline + stats
      history-view.ts              # Past nights list
      settings-view.ts             # User settings
    components/
      timeline-bar.ts              # SVG timeline visualization
      pulse-button.ts              # Awake/still-awake button pair
      session-card.ts              # Night summary card
      night-stats.ts               # Stats block
      setup-prompt.ts              # First-time onboarding
```

## Build and Deploy

```bash
make dev              # Build frontend + deploy all + restart HA
make deploy-frontend  # Frontend-only deploy (no restart needed, hard-refresh browser)
make deploy           # Full deploy without restart
make restart          # Restart HA only
make logs             # Tail HA logs filtered to sleep_tracker
```

- `manifest.json` is the single source of truth for version
- Dev mode (`.dev` file) enables cache-busting redirects for frontend
- Vite builds to `custom_components/sleep_tracker/frontend/dist/`
- `base: "/sleep_tracker/frontend/"` in vite.config.ts required for chunk resolution

## Key Architecture

- **Event-driven** - no tick loop. All state changes via start/stop/pulse calls
- **Per-user isolation** - WebSocket API derives user_id from connection.user; services take explicit user_id
- **Timeline reconstruction** - pure functions in timeline.py compute awake/asleep intervals from pulses + configurable fall-asleep latency
- **Dynamic entity creation** - entities created when user opts in via panel, using stored async_add_entities callbacks
- **Sensor entity IDs** - set via `self.entity_id` for predictable IDs. Entity IDs are permanent once HA registers them

## Deploy Target

- Host: `homeassistant` (SSH alias)
- Path: `/config/custom_components/sleep_tracker/`

## Conventions

- Frontend uses HA design tokens (`--ha-space-*`, `--ha-font-size-*`, etc.)
- Dialogs use `ha-card` overlays (not `ha-dialog`)
- Selects use `ha-select` + `mwc-list-item` (not native `<select>`)
- `_attr_suggested_object_id` does NOT exist in HA - use `self.entity_id` directly
