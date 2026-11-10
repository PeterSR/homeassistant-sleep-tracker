# Sleep Tracker for Home Assistant

Per-tracker sleep tracking with pulse-based timeline reconstruction, a sidebar panel, and REST export.

A "tracker" is either personal (one per HA user, isolated data) or shared (e.g. for a baby - visible and controllable by every authenticated user). Each tracker has its own sessions, timeline, stats, and sensors. No polling, no tick loop - state advances from events: start, stop, pause, and optional "awake" / "still awake" / "fell asleep" pulses from your phone, a button, a sleep ring, or any automation.

## Features

- **Personal + shared trackers** - each HA user has a private tracker; create additional shared trackers (kids, pets, anyone without their own HA account) that everyone in the household can act on.
- **Event-driven timeline** - asleep / awake phases are reconstructed from the event stream plus configurable fall-asleep latency and awakening grace.
- **Editable nights** - once a session ends, phases are materialized and can be adjusted on the detail view.
- **Bedtime checklist** - entity-state checks (e.g. "bedroom lights off") and plain-text reminders.
- **Custom events** - user-defined buttons (icon + label) that fire during a session and can auto-tag the night.
- **Sensors for automations** - current phase, in-session flag, last-awake, session start, sleep duration, awakening count.
- **Data export** - download all sessions as JSON from the panel, or POST each finished session to a REST endpoint.
- **Session metadata** - optional note, quality / feeling ratings, tags, environment snapshot, nightly goal.

## Installation

### HACS (custom repository)

1. HACS → Integrations → ⋯ menu → **Custom repositories**.
2. Add `https://github.com/PeterSR/homeassistant-sleep-tracker`, category **Integration**.
3. Install **Sleep Tracker** and restart Home Assistant.
4. **Settings → Devices & Services → Add Integration → Sleep Tracker**.

### Manual

1. Copy `custom_components/sleep_tracker/` into your HA `config/custom_components/`.
2. Restart Home Assistant.
3. Add the integration via **Settings → Devices & Services**.

## Configuration

The integration is a singleton - add it once. Setup happens in the sidebar panel:

- **Personal tracker** - each user opens **Sleep Tracker** and clicks *Enable for me*.
- **Shared tracker** - anyone can use *Add a shared tracker* (e.g. "Baby") from the setup screen, the toolbar switcher, or the Settings → Shared trackers card. Shared trackers have a generated UUID and are accessible to every authenticated user.

> **Trust model:** shared trackers assume a trusted household. Every authenticated HA user can view and edit a shared tracker's sessions and settings (including its REST export target). Deleting a shared tracker is restricted to its creator or an HA admin.

The toolbar dropdown switches between accessible trackers. All preferences (sleep-onset delay, awakening grace, checklist, custom events, tags, environment entities, nightly goal, REST export) are stored per tracker.

## Entities

For each tracker (`{slug}` = slugified display name):

| Entity | Type | State |
|---|---|---|
| `binary_sensor.sleep_tracker_{slug}_in_session` | binary_sensor | `on` while an active or paused session exists |
| `sensor.sleep_tracker_{slug}_phase` | sensor (enum) | `awake` / `asleep` - current sleep phase |
| `sensor.sleep_tracker_{slug}_last_awake` | sensor (timestamp) | timestamp of the last recorded awake event |
| `sensor.sleep_tracker_{slug}_session_start` | sensor (timestamp) | current or last session's start time |
| `sensor.sleep_tracker_{slug}_sleep_duration` | sensor (duration) | minutes asleep in the current session |
| `sensor.sleep_tracker_{slug}_awake_count` | sensor | awakenings in the current session |
| `sensor.sleep_tracker_{slug}_status` | sensor (enum) | `idle` / `active` / `paused` - lifecycle of the open session |

Use `sensor.sleep_tracker_{slug}_phase == 'asleep'` as a condition when you need "actually asleep" rather than "is in bed".

The `status` sensor tells a paused session apart from an active one, which the `in_session` binary sensor does not. It has the attributes `tracker_id`, `session_id` and `started_at` (both `null` while `idle`).

## Services

All services live under the `sleep_tracker` domain - open **Developer Tools → Services** for full parameter docs and selectors.

| Service | Purpose |
|---|---|
| `start_sleep` | Begin a session for a tracker (also resumes a paused session). |
| `stop_sleep` | End the active session; phases are materialized and become editable. |
| `pause_sleep` | Temporarily halt tracking; the tracker counts as awake until resumed. |
| `reopen_session` | Reopen a stopped-but-not-finalized session to append new events. |
| `event_awake` | Record an "awake" pulse (auto-demoted to `still_awake` if already awake). |
| `event_still_awake` | Extend the awake window - no state change. |
| `event_fell_asleep` | Force an immediate asleep transition, bypassing the latency model. |
| `export_session` | POST a finalized session to the configured REST endpoint. |
| `list_sessions` | Admin only, returns data. List sessions (`session_id`, `tracker_id`, `started_at`, `ended_at`, `finalized`, `exported`), oldest first. Optional filters: `tracker_id`, `finalized`, `exported`. |
| `get_session` | Admin only, returns data. The export payload of a completed session, identical to what the REST export posts (including `environment_history` when enabled). |
| `mark_exported` | Admin only. Set the `exported` flag of a session (`exported` defaults to true). |

All tracker-facing services take `tracker_id`. For a personal tracker this is the HA user id (`{{ states.person.your_name.attributes.user_id }}`); for a shared tracker, copy the id from **Settings → Tracker ID** in the panel. Most services also accept optional `source`, `automation_id`, and `automation_trigger_id` for provenance - these show up in the session's event review so you can tell which automation fired what.

### Pulling sessions with actions

`list_sessions`, `get_session` and `mark_exported` let another integration or script pull finished sessions instead of relying on the REST push. A typical loop calls `list_sessions` with `finalized: true` and `exported: false`, fetches each result with `get_session`, delivers it, then calls `mark_exported`. The first two actions only return data (`return_response`), and all three require an admin user.

### Keeping unexported sessions

Retention normally deletes sessions older than the retention period when a new session starts. Turn on **Keep sessions until exported** in a tracker's settings (`keep_unexported`) and sessions with `exported` false are never deleted by retention. The same protection always applies to a tracker with an export URL. Sessions pulled with the actions above stay protected until you call `mark_exported`.

## Automation example

```yaml
alias: Start sleep when I plug in my phone at night
trigger:
  - platform: state
    entity_id: binary_sensor.my_phone_charging
    to: "on"
    id: phone_charger
condition:
  - condition: time
    after: "22:00:00"
action:
  - service: sleep_tracker.start_sleep
    data:
      tracker_id: "{{ states.person.your_name.attributes.user_id }}"
      source: phone_charger
      automation_id: "{{ this.entity_id }}"
      automation_trigger_id: "{{ trigger.id }}"
```

## Development

Architecture notes live in [CLAUDE.md](CLAUDE.md). The frontend is Lit + TypeScript, built with Vite.

```bash
make dev               # build frontend + deploy + restart HA
make deploy-frontend   # frontend-only, hard-refresh the browser
make logs              # tail HA logs filtered to sleep_tracker
```

Tests use [uv](https://docs.astral.sh/uv/) and pytest-homeassistant-custom-component:

```bash
uv sync --group test
uv run pytest
```

## License

[MIT](LICENSE).
