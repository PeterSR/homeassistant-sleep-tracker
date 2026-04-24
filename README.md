# Sleep Tracker for Home Assistant

Per-user sleep tracking with pulse-based timeline reconstruction, a sidebar panel, and REST export.

Each Home Assistant user opts in from a sidebar panel and gets their own sessions, timeline, stats, and sensors. No polling, no tick loop — state advances from events: start, stop, pause, and optional "awake" / "still awake" / "fell asleep" pulses from your phone, a button, a sleep ring, or any automation.

## Features

- **Per-user sessions** — each HA user has isolated data, sensors, and settings.
- **Event-driven timeline** — asleep / awake phases are reconstructed from the event stream plus configurable fall-asleep latency and awakening grace.
- **Editable nights** — once a session ends, phases are materialized and can be adjusted on the detail view.
- **Bedtime checklist** — entity-state checks (e.g. "bedroom lights off") and plain-text reminders.
- **Custom events** — user-defined buttons (icon + label) that fire during a session and can auto-tag the night.
- **Sensors for automations** — current phase, in-session flag, last-awake, session start, sleep duration, awakening count.
- **Data export** — download all sessions as JSON from the panel, or POST each finished session to a REST endpoint.
- **Session metadata** — optional note, quality / feeling ratings, tags, environment snapshot, nightly goal.

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

The integration is a singleton — add it once. Per-user setup happens in the sidebar panel: each user opens **Sleep Tracker** and enables tracking for themselves. All preferences (sleep-onset delay, awakening grace, checklist, custom events, tags, environment entities, nightly goal, REST export) are stored per user.

## Entities

For each enabled user (`{slug}` = slugified display name):

| Entity | Type | State |
|---|---|---|
| `binary_sensor.sleep_tracker_{slug}_in_session` | binary_sensor | `on` while an active or paused session exists |
| `sensor.sleep_tracker_{slug}_phase` | sensor (enum) | `awake` / `asleep` — current sleep phase |
| `sensor.sleep_tracker_{slug}_last_awake` | sensor (timestamp) | timestamp of the last recorded awake event |
| `sensor.sleep_tracker_{slug}_session_start` | sensor (timestamp) | current or last session's start time |
| `sensor.sleep_tracker_{slug}_sleep_duration` | sensor (duration) | minutes asleep in the current session |
| `sensor.sleep_tracker_{slug}_awake_count` | sensor | awakenings in the current session |

Use `sensor.sleep_tracker_{slug}_phase == 'asleep'` as a condition when you need "actually asleep" rather than "is in bed".

## Services

All services live under the `sleep_tracker` domain — open **Developer Tools → Services** for full parameter docs and selectors.

| Service | Purpose |
|---|---|
| `start_sleep` | Begin a session for a user (also resumes a paused session). |
| `stop_sleep` | End the active session; phases are materialized and become editable. |
| `pause_sleep` | Temporarily halt tracking; user counts as awake until resumed. |
| `reopen_session` | Reopen a stopped-but-not-finalized session to append new events. |
| `event_awake` | Record an "awake" pulse (auto-demoted to `still_awake` if already awake). |
| `event_still_awake` | Extend the awake window — no state change. |
| `event_fell_asleep` | Force an immediate asleep transition, bypassing the latency model. |
| `export_session` | POST a finalized session to the configured REST endpoint. |

All user-facing services take `user_id`. Most accept optional `source`, `automation_id`, and `automation_trigger_id` for provenance — these show up in the session's event review so you can tell which automation fired what.

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
      user_id: "{{ states.person.peter.attributes.user_id }}"
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

## License

[MIT](LICENSE).
