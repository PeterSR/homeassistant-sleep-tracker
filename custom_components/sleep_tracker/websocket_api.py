"""WebSocket API for Sleep Tracker frontend."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, EVENT_AWAKE, EVENT_FELL_ASLEEP, EVENT_STILL_AWAKE
from .models import CHECKLIST_TYPE_ENTITY, CHECKLIST_TYPE_TEXT

CHECKLIST_ITEM_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.In([CHECKLIST_TYPE_ENTITY, CHECKLIST_TYPE_TEXT]),
        vol.Optional("entity_id"): str,
        vol.Optional("desired_state"): str,
        vol.Optional("text"): str,
    }
)

CUSTOM_EVENT_SCHEMA = vol.Schema(
    {
        vol.Optional("id"): str,
        vol.Optional("label"): str,
        vol.Optional("icon"): vol.Any(str, None),
        vol.Optional("tag"): vol.Any(str, None),
    }
)

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_get_state)
    websocket_api.async_register_command(hass, ws_get_history)
    websocket_api.async_register_command(hass, ws_get_session)
    websocket_api.async_register_command(hass, ws_get_stats)
    websocket_api.async_register_command(hass, ws_start_sleep)
    websocket_api.async_register_command(hass, ws_stop_sleep)
    websocket_api.async_register_command(hass, ws_pause_sleep)
    websocket_api.async_register_command(hass, ws_reopen_session)
    websocket_api.async_register_command(hass, ws_event)
    websocket_api.async_register_command(hass, ws_custom_event)
    websocket_api.async_register_command(hass, ws_export_data)
    websocket_api.async_register_command(hass, ws_complete_session)
    websocket_api.async_register_command(hass, ws_edit_event)
    websocket_api.async_register_command(hass, ws_delete_event)
    websocket_api.async_register_command(hass, ws_setup_user)
    websocket_api.async_register_command(hass, ws_update_settings)
    websocket_api.async_register_command(hass, ws_delete_phase)
    websocket_api.async_register_command(hass, ws_split_phase)
    websocket_api.async_register_command(hass, ws_adjust_phase_boundary)
    websocket_api.async_register_command(hass, ws_append_phase)
    websocket_api.async_register_command(hass, ws_undo_edit)
    websocket_api.async_register_command(hass, ws_delete_session)
    websocket_api.async_register_command(hass, ws_update_session_meta)
    websocket_api.async_register_command(hass, ws_get_tag_usage)
    websocket_api.async_register_command(hass, ws_finalize_session)
    websocket_api.async_register_command(hass, ws_unfinalize_session)
    websocket_api.async_register_command(hass, ws_export_session)
    websocket_api.async_register_command(hass, ws_subscribe)


def _get_data(hass: HomeAssistant) -> dict[str, Any]:
    return hass.data[DOMAIN]


# --- Get State ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/get_state"}
)
@websocket_api.async_response
async def ws_get_state(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get current user's state."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    state = coordinator.get_user_state(user_id)
    connection.send_result(msg["id"], state)


# --- Get History ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_history",
        vol.Optional("limit", default=20): int,
        vol.Optional("offset", default=0): int,
    }
)
@websocket_api.async_response
async def ws_get_history(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get past sessions for current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    sessions = coordinator.get_user_history(user_id, msg["limit"], msg["offset"])
    connection.send_result(msg["id"], {"sessions": sessions})


# --- Get Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get detailed session data."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    session = coordinator.get_session_detail(msg["session_id"])

    if session is None or session.get("user_id") != user_id:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    connection.send_result(msg["id"], session)


# --- Get Stats ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_stats",
        vol.Optional("days", default=30): vol.All(int, vol.Range(min=7, max=365)),
    }
)
@websocket_api.async_response
async def ws_get_stats(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get aggregated sleep statistics for the current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    stats = coordinator.get_user_stats(user_id, msg["days"])
    connection.send_result(msg["id"], stats)


# --- Start Sleep ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/start_sleep"}
)
@websocket_api.async_response
async def ws_start_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Start a sleep session for the current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_start_sleep(user_id, source="panel")
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "start_failed", str(err))


# --- Stop Sleep ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/stop_sleep"}
)
@websocket_api.async_response
async def ws_stop_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Stop the active sleep session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_stop_sleep(user_id, source="panel")
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "stop_failed", str(err))


# --- Pause Sleep ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/pause_sleep"}
)
@websocket_api.async_response
async def ws_pause_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Pause the active sleep session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_pause_sleep(user_id, source="panel")
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "pause_failed", str(err))


# --- Reopen Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/reopen_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_reopen_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Reopen a stopped session, allowing events to be appended again."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_reopen_session(user_id, msg["session_id"])
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "reopen_failed", str(err))


# --- Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/event",
        vol.Required("event_type"): vol.In(
            [EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP]
        ),
    }
)
@websocket_api.async_response
async def ws_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Record an event in the active session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_event(
            user_id, msg["event_type"], source="panel"
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "event_failed", str(err))


# --- Custom Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/custom_event",
        vol.Required("custom_event_id"): str,
    }
)
@websocket_api.async_response
async def ws_custom_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Record a user-defined custom event in the active session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_custom_event(
            user_id, msg["custom_event_id"], source="panel"
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "event_failed", str(err))


# --- Export Data ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/export_data",
        vol.Optional("start_date"): vol.Any(str, None),
        vol.Optional("end_date"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def ws_export_data(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Export all sessions for the current user in an optional date range."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    data = coordinator.export_user_data(
        user_id, msg.get("start_date"), msg.get("end_date")
    )
    connection.send_result(msg["id"], data)


# --- Complete Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/complete_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_complete_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Complete event review: materialize phases from events."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_complete_session(user_id, msg["session_id"])
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "complete_failed", str(err))


# --- Edit Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/edit_event",
        vol.Required("session_id"): str,
        vol.Required("event_index"): int,
        vol.Required("event_type"): vol.In(
            [EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP]
        ),
    }
)
@websocket_api.async_response
async def ws_edit_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Change the type of an event during event review."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_edit_event(
            user_id, msg["session_id"], msg["event_index"], msg["event_type"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "edit_failed", str(err))


# --- Delete Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_event",
        vol.Required("session_id"): str,
        vol.Required("event_index"): int,
    }
)
@websocket_api.async_response
async def ws_delete_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete an event during event review."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_delete_event(
            user_id, msg["session_id"], msg["event_index"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Setup User ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/setup_user",
        vol.Optional("display_name"): str,
    }
)
@websocket_api.async_response
async def ws_setup_user(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Set up sleep tracking for the current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    display_name = msg.get("display_name") or connection.user.name or user_id[:8]

    try:
        config = await coordinator.async_setup_user(user_id, display_name)
        connection.send_result(msg["id"], config)
    except ValueError as err:
        connection.send_error(msg["id"], "setup_failed", str(err))


# --- Update Settings ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/update_settings",
        vol.Optional("sleep_onset_minutes"): vol.All(
            int, vol.Range(min=0, max=120)
        ),
        vol.Optional("fall_asleep_latency_minutes"): vol.All(
            int, vol.Range(min=0, max=120)
        ),
        vol.Optional("skip_event_review"): bool,
        vol.Optional("skip_phase_review"): bool,
        vol.Optional("export_url"): vol.Any(str, None),
        vol.Optional("export_headers"): dict,
        vol.Optional("retention_days"): vol.All(
            int, vol.Range(min=7, max=365)
        ),
        vol.Optional("checklist"): [CHECKLIST_ITEM_SCHEMA],
        vol.Optional("show_note"): bool,
        vol.Optional("show_rating_quality"): bool,
        vol.Optional("show_rating_feeling"): bool,
        vol.Optional("show_tags"): bool,
        vol.Optional("available_tags"): [str],
        vol.Optional("show_environment"): bool,
        vol.Optional("environment_entities"): [str],
        vol.Optional("sleep_goal_minutes"): vol.All(
            int, vol.Range(min=0, max=1440)
        ),
        vol.Optional("custom_events"): [CUSTOM_EVENT_SCHEMA],
    }
)
@websocket_api.async_response
async def ws_update_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Update user settings."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    updates = {
        k: v
        for k, v in msg.items()
        if k not in ("id", "type")
    }

    try:
        config = await coordinator.async_update_user_config(user_id, **updates)
        connection.send_result(msg["id"], config)
    except ValueError as err:
        connection.send_error(msg["id"], "update_failed", str(err))


# --- Delete Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_phase",
        vol.Required("session_id"): str,
        vol.Required("phase_index"): int,
    }
)
@websocket_api.async_response
async def ws_delete_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a phase from a session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_delete_phase(
            user_id, msg["session_id"], msg["phase_index"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Split Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/split_phase",
        vol.Required("session_id"): str,
        vol.Required("phase_index"): int,
        vol.Required("at_timestamp"): str,
        vol.Optional("wedge_minutes", default=1.0): vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_split_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Split a phase by inserting an opposite-state wedge."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_split_phase(
            user_id,
            msg["session_id"],
            msg["phase_index"],
            msg["at_timestamp"],
            msg["wedge_minutes"],
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "split_failed", str(err))


# --- Adjust Phase Boundary ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/adjust_phase_boundary",
        vol.Required("session_id"): str,
        vol.Required("after_index"): int,
        vol.Required("new_time"): str,
    }
)
@websocket_api.async_response
async def ws_adjust_phase_boundary(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Move a phase boundary."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_adjust_phase_boundary(
            user_id, msg["session_id"], msg["after_index"], msg["new_time"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "adjust_failed", str(err))


# --- Append Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/append_phase",
        vol.Required("session_id"): str,
        vol.Required("state"): vol.In(["awake", "asleep"]),
        vol.Required("end_timestamp"): str,
    }
)
@websocket_api.async_response
async def ws_append_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Append a new phase at the end of the session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_append_phase(
            user_id, msg["session_id"], msg["state"], msg["end_timestamp"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "append_failed", str(err))


# --- Undo Edit ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/undo_edit",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_undo_edit(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Undo the most recent phase edit on a session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    s = coordinator.store.get_session(msg["session_id"])
    if s is None or s.user_id != user_id:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    try:
        session = await coordinator.async_undo_edit(user_id, msg["session_id"])
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "undo_failed", str(err))


# --- Delete Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a session permanently."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        await coordinator.async_delete_session(user_id, msg["session_id"])
        connection.send_result(msg["id"], {"success": True})
    except ValueError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Update Session Meta ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/update_session_meta",
        vol.Required("session_id"): str,
        vol.Optional("note"): vol.Any(str, None),
        vol.Optional("rating_quality"): vol.Any(
            vol.All(int, vol.Range(min=1, max=5)), None
        ),
        vol.Optional("rating_feeling"): vol.Any(
            vol.All(int, vol.Range(min=1, max=5)), None
        ),
        vol.Optional("tags"): [str],
    }
)
@websocket_api.async_response
async def ws_update_session_meta(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Update session metadata (note, ratings, tags)."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    meta = {
        k: v
        for k, v in msg.items()
        if k not in ("id", "type", "session_id")
    }

    try:
        session = await coordinator.async_update_session_meta(
            user_id, msg["session_id"], **meta
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "update_meta_failed", str(err))


# --- Get Tag Usage ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/get_tag_usage"}
)
@websocket_api.async_response
async def ws_get_tag_usage(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get tag usage counts for the current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id
    usage = coordinator.get_tag_usage(user_id)
    connection.send_result(msg["id"], usage)


# --- Finalize Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/finalize_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_finalize_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Finalize a session (locks edits, triggers export if configured)."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_finalize_session(
            user_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "finalize_failed", str(err))


# --- Unfinalize Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/unfinalize_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_unfinalize_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Unfinalize a session (escape hatch to re-enable edits)."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_unfinalize_session(
            user_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "unfinalize_failed", str(err))


# --- Export Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/export_session",
        vol.Required("session_id"): str,
    }
)
@websocket_api.async_response
async def ws_export_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Export a session to the configured REST endpoint."""
    from .export import async_export_session

    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    session = coordinator.store.get_session(msg["session_id"])
    if session is None or session.user_id != user_id:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    try:
        await async_export_session(hass, coordinator, msg["session_id"])
        connection.send_result(msg["id"], {"success": True})
    except Exception as err:
        connection.send_error(msg["id"], "export_failed", str(err))


# --- Subscribe ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/subscribe"}
)
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Subscribe to real-time state updates for the current user."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    connection.send_result(msg["id"])
    state = coordinator.get_user_state(user_id)
    connection.send_message(websocket_api.event_message(msg["id"], state))

    @callback
    def on_update() -> None:
        state = coordinator.get_user_state(user_id)
        connection.send_message(websocket_api.event_message(msg["id"], state))

    unsub = coordinator.add_user_listener(user_id, on_update)
    connection.subscriptions[msg["id"]] = unsub
