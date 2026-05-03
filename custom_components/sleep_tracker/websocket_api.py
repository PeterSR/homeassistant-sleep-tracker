"""WebSocket API for Sleep Tracker frontend."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import (
    DEFAULT_PANEL_SOURCE,
    DOMAIN,
    EVENT_AWAKE,
    EVENT_FELL_ASLEEP,
    EVENT_STILL_AWAKE,
    KIND_USER,
)
from .models import CHECKLIST_TYPE_ENTITY, CHECKLIST_TYPE_TEXT

_MAX_ID_LEN = 64
_MAX_LABEL_LEN = 128
_MAX_TAG_LEN = 64
_MAX_ICON_LEN = 64
_MAX_LIST_ITEMS = 100
_MAX_HEADER_LEN = 1024
_ISO_DATE_RE = r"^\d{4}-\d{2}-\d{2}"

_short_str = vol.All(str, vol.Length(max=_MAX_TAG_LEN))
_icon_str = vol.Any(vol.All(str, vol.Length(max=_MAX_ICON_LEN)), None)
_tag_str = vol.Any(vol.All(str, vol.Length(max=_MAX_TAG_LEN)), None)

CHECKLIST_ITEM_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.In([CHECKLIST_TYPE_ENTITY, CHECKLIST_TYPE_TEXT]),
        vol.Optional("entity_id"): vol.All(str, vol.Length(max=255)),
        vol.Optional("desired_state"): vol.All(str, vol.Length(max=255)),
        vol.Optional("text"): vol.All(str, vol.Length(max=500)),
    }
)

CUSTOM_EVENT_SCHEMA = vol.Schema(
    {
        vol.Optional("id"): vol.All(str, vol.Length(max=_MAX_ID_LEN)),
        vol.Optional("label"): vol.All(str, vol.Length(max=_MAX_LABEL_LEN)),
        vol.Optional("icon"): _icon_str,
        vol.Optional("tag"): _tag_str,
    }
)

_SESSION_META_FIELDS = {"note", "rating_quality", "rating_feeling", "tags"}

_UPDATE_SETTINGS_FIELDS: dict = {
    "sleep_onset_minutes": vol.All(int, vol.Range(min=0, max=120)),
    "fall_asleep_latency_minutes": vol.All(int, vol.Range(min=0, max=120)),
    "awakening_grace_minutes": vol.All(int, vol.Range(min=0, max=180)),
    "skip_event_review": bool,
    "skip_phase_review": bool,
    "export_url": vol.Any(vol.All(str, vol.Length(max=2048)), None),
    "export_headers": vol.Schema({_short_str: vol.All(str, vol.Length(max=_MAX_HEADER_LEN))}),
    "export_environment_data": bool,
    "retention_days": vol.All(int, vol.Range(min=7, max=365)),
    "checklist": vol.All([CHECKLIST_ITEM_SCHEMA], vol.Length(max=_MAX_LIST_ITEMS)),
    "show_note": bool,
    "show_rating_quality": bool,
    "show_rating_feeling": bool,
    "show_tags": bool,
    "available_tags": vol.All([_short_str], vol.Length(max=_MAX_LIST_ITEMS)),
    "show_environment": bool,
    "environment_entities": vol.All(
        [vol.All(str, vol.Length(max=255))], vol.Length(max=_MAX_LIST_ITEMS)
    ),
    "sleep_goal_minutes": vol.All(int, vol.Range(min=0, max=1440)),
    "custom_events": vol.All([CUSTOM_EVENT_SCHEMA], vol.Length(max=_MAX_LIST_ITEMS)),
    "display_name": vol.All(str, vol.Length(min=1, max=_MAX_LABEL_LEN)),
}


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_list_trackers)
    websocket_api.async_register_command(hass, ws_create_shared_tracker)
    websocket_api.async_register_command(hass, ws_delete_tracker)
    websocket_api.async_register_command(hass, ws_get_state)
    websocket_api.async_register_command(hass, ws_get_history)
    websocket_api.async_register_command(hass, ws_get_session)
    websocket_api.async_register_command(hass, ws_get_stats)
    websocket_api.async_register_command(hass, ws_start_sleep)
    websocket_api.async_register_command(hass, ws_stop_sleep)
    websocket_api.async_register_command(hass, ws_pause_sleep)
    websocket_api.async_register_command(hass, ws_reopen_session)
    websocket_api.async_register_command(hass, ws_revert_to_event_review)
    websocket_api.async_register_command(hass, ws_event)
    websocket_api.async_register_command(hass, ws_custom_event)
    websocket_api.async_register_command(hass, ws_export_data)
    websocket_api.async_register_command(hass, ws_complete_session)
    websocket_api.async_register_command(hass, ws_edit_event)
    websocket_api.async_register_command(hass, ws_delete_event)
    websocket_api.async_register_command(hass, ws_setup_tracker)
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


def _get_coordinator(hass: HomeAssistant):
    """Return the coordinator; raise if the integration isn't set up yet."""
    data = hass.data.get(DOMAIN)
    if data is None:
        raise HomeAssistantError("Sleep Tracker is not set up")
    return data["coordinator"]


def _resolve_tracker_id(
    connection: websocket_api.ActiveConnection,
    msg: dict,
    coordinator,
) -> str:
    """Resolve and authorize the tracker_id for a WS command.

    If msg contains "tracker_id", use that — but reject access to a personal
    tracker that doesn't belong to the connection user. If omitted, default to
    the connection user's id (their personal tracker).

    Shared trackers are accessible to any authenticated connection.
    """
    requested = msg.get("tracker_id")
    if not requested:
        return connection.user.id

    config = coordinator.store.get_tracker_config(requested)
    if config is None:
        # Tracker doesn't exist yet — only the matching HA user may set up
        # their own personal tracker; everything else is forbidden.
        if requested != connection.user.id:
            raise HomeAssistantError("Tracker not found")
        return requested

    if config.kind == KIND_USER and config.tracker_id != connection.user.id:
        raise HomeAssistantError("Not authorized to access this tracker")

    return requested


# --- List trackers ---

@websocket_api.websocket_command(
    {vol.Required("type"): "sleep_tracker/list_trackers"}
)
@websocket_api.async_response
async def ws_list_trackers(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """List trackers accessible to the current user (personal + all shared)."""
    coordinator = _get_coordinator(hass)
    trackers = coordinator.get_accessible_trackers(connection.user.id)
    connection.send_result(msg["id"], {"trackers": trackers})


# --- Create shared tracker ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/create_shared_tracker",
        vol.Required("display_name"): vol.All(
            str, vol.Length(min=1, max=_MAX_LABEL_LEN)
        ),
    }
)
@websocket_api.async_response
async def ws_create_shared_tracker(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Create a new shared tracker (e.g. for a baby)."""
    coordinator = _get_coordinator(hass)
    try:
        config = await coordinator.async_create_shared_tracker(msg["display_name"])
        connection.send_result(msg["id"], config)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "create_failed", str(err))


# --- Delete tracker ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_tracker",
        vol.Required("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_tracker(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a tracker (personal trackers: only the owner; shared: any authed)."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        await coordinator.async_delete_tracker(tracker_id)
        connection.send_result(msg["id"], {"success": True})
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Get State ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_state",
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_state(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get current state for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return
    state = coordinator.get_tracker_state(tracker_id)
    connection.send_result(msg["id"], state)


# --- Get History ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_history",
        vol.Optional("tracker_id"): str,
        vol.Optional("limit", default=20): int,
        vol.Optional("offset", default=0): int,
    }
)
@websocket_api.async_response
async def ws_get_history(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get past sessions for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return
    sessions = coordinator.get_tracker_history(tracker_id, msg["limit"], msg["offset"])
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
    coordinator = _get_coordinator(hass)
    session = coordinator.get_session_detail(msg["session_id"])

    if session is None:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    # Verify the connection user has access to this session's tracker.
    config = coordinator.store.get_tracker_config(session.get("tracker_id"))
    if config and config.kind == KIND_USER and config.tracker_id != connection.user.id:
        connection.send_error(msg["id"], "forbidden", "Not authorized")
        return

    connection.send_result(msg["id"], session)


# --- Get Stats ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_stats",
        vol.Optional("tracker_id"): str,
        vol.Optional("days", default=30): vol.All(int, vol.Range(min=7, max=365)),
    }
)
@websocket_api.async_response
async def ws_get_stats(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get aggregated sleep statistics for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return
    stats = coordinator.get_tracker_stats(tracker_id, msg["days"])
    connection.send_result(msg["id"], stats)


# --- Start Sleep ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/start_sleep",
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_start_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Start a sleep session for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_start_sleep(
            tracker_id, source=DEFAULT_PANEL_SOURCE
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "start_failed", str(err))


# --- Stop Sleep ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/stop_sleep",
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_stop_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Stop the active sleep session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_stop_sleep(
            tracker_id, source=DEFAULT_PANEL_SOURCE
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "stop_failed", str(err))


# --- Pause Sleep ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/pause_sleep",
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_pause_sleep(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Pause the active sleep session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_pause_sleep(
            tracker_id, source=DEFAULT_PANEL_SOURCE
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "pause_failed", str(err))


# --- Reopen Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/reopen_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_reopen_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Reopen a stopped session, allowing events to be appended again."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_reopen_session(
            tracker_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "reopen_failed", str(err))


# --- Revert to Event Review ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/revert_to_event_review",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_revert_to_event_review(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Revert a completed session back to event-review (clears phases)."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_revert_to_event_review(
            tracker_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "revert_failed", str(err))


# --- Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/event",
        vol.Required("event_type"): vol.In(
            [EVENT_AWAKE, EVENT_STILL_AWAKE, EVENT_FELL_ASLEEP]
        ),
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Record an event in the active session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_event(
            tracker_id, msg["event_type"], source=DEFAULT_PANEL_SOURCE
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "event_failed", str(err))


# --- Custom Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/custom_event",
        vol.Required("custom_event_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_custom_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Record a user-defined custom event in the active session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_custom_event(
            tracker_id, msg["custom_event_id"], source=DEFAULT_PANEL_SOURCE
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "event_failed", str(err))


# --- Export Data ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/export_data",
        vol.Optional("tracker_id"): str,
        vol.Optional("start_date"): vol.Any(vol.All(str, vol.Match(_ISO_DATE_RE)), None),
        vol.Optional("end_date"): vol.Any(vol.All(str, vol.Match(_ISO_DATE_RE)), None),
        vol.Optional("include_environment"): bool,
    }
)
@websocket_api.async_response
async def ws_export_data(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Export all sessions for a tracker in an optional date range."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return
    data = await coordinator.async_export_tracker_data(
        tracker_id,
        msg.get("start_date"),
        msg.get("end_date"),
        include_environment=bool(msg.get("include_environment", False)),
    )
    connection.send_result(msg["id"], data)


# --- Complete Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/complete_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_complete_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Complete event review: materialize phases from events."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_complete_session(
            tracker_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
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
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_edit_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Change the type of an event during event review."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_edit_event(
            tracker_id, msg["session_id"], msg["event_index"], msg["event_type"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "edit_failed", str(err))


# --- Delete Event ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_event",
        vol.Required("session_id"): str,
        vol.Required("event_index"): int,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_event(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete an event during event review."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_delete_event(
            tracker_id, msg["session_id"], msg["event_index"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Setup Tracker ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/setup_tracker",
        vol.Optional("display_name"): str,
    }
)
@websocket_api.async_response
async def ws_setup_tracker(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Set up the personal tracker for the current user."""
    coordinator = _get_coordinator(hass)
    tracker_id = connection.user.id
    display_name = msg.get("display_name") or connection.user.name or tracker_id[:8]

    try:
        config = await coordinator.async_setup_tracker(tracker_id, display_name)
        connection.send_result(msg["id"], config)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "setup_failed", str(err))


# --- Update Settings ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/update_settings",
        vol.Optional("tracker_id"): str,
        **{vol.Optional(k): v for k, v in _UPDATE_SETTINGS_FIELDS.items()},
    }
)
@websocket_api.async_response
async def ws_update_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Update tracker settings."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return

    updates = {k: msg[k] for k in _UPDATE_SETTINGS_FIELDS if k in msg}

    try:
        config = await coordinator.async_update_tracker_config(tracker_id, **updates)
        connection.send_result(msg["id"], config)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "update_failed", str(err))


# --- Delete Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_phase",
        vol.Required("session_id"): str,
        vol.Required("phase_index"): int,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a phase from a session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_delete_phase(
            tracker_id, msg["session_id"], msg["phase_index"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Split Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/split_phase",
        vol.Required("session_id"): str,
        vol.Required("phase_index"): int,
        vol.Required("at_timestamp"): str,
        vol.Optional("wedge_minutes", default=1.0): vol.Coerce(float),
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_split_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Split a phase by inserting an opposite-state wedge."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_split_phase(
            tracker_id,
            msg["session_id"],
            msg["phase_index"],
            msg["at_timestamp"],
            msg["wedge_minutes"],
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "split_failed", str(err))


# --- Adjust Phase Boundary ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/adjust_phase_boundary",
        vol.Required("session_id"): str,
        vol.Required("after_index"): int,
        vol.Required("new_time"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_adjust_phase_boundary(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Move a phase boundary."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_adjust_phase_boundary(
            tracker_id, msg["session_id"], msg["after_index"], msg["new_time"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "adjust_failed", str(err))


# --- Append Phase ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/append_phase",
        vol.Required("session_id"): str,
        vol.Required("state"): vol.In(["awake", "asleep"]),
        vol.Required("end_timestamp"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_append_phase(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Append a new phase at the end of the session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_append_phase(
            tracker_id, msg["session_id"], msg["state"], msg["end_timestamp"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "append_failed", str(err))


# --- Undo Edit ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/undo_edit",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_undo_edit(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Undo the most recent phase edit on a session."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return

    s = coordinator.store.get_session(msg["session_id"])
    if s is None or s.tracker_id != tracker_id:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    try:
        session = await coordinator.async_undo_edit(tracker_id, msg["session_id"])
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "undo_failed", str(err))


# --- Delete Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a session permanently."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        await coordinator.async_delete_session(tracker_id, msg["session_id"])
        connection.send_result(msg["id"], {"success": True})
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Update Session Meta ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/update_session_meta",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
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
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return

    meta = {k: msg[k] for k in _SESSION_META_FIELDS if k in msg}

    try:
        session = await coordinator.async_update_session_meta(
            tracker_id, msg["session_id"], **meta
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "update_meta_failed", str(err))


# --- Get Tag Usage ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/get_tag_usage",
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_get_tag_usage(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get tag usage counts for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return
    usage = coordinator.get_tag_usage(tracker_id)
    connection.send_result(msg["id"], usage)


# --- Finalize Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/finalize_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_finalize_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Finalize a session (locks edits, triggers export if configured)."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_finalize_session(
            tracker_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "finalize_failed", str(err))


# --- Unfinalize Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/unfinalize_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_unfinalize_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Unfinalize a session (escape hatch to re-enable edits)."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
        session = await coordinator.async_unfinalize_session(
            tracker_id, msg["session_id"]
        )
        connection.send_result(msg["id"], session)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "unfinalize_failed", str(err))


# --- Export Session ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/export_session",
        vol.Required("session_id"): str,
        vol.Optional("tracker_id"): str,
    }
)
@websocket_api.async_response
async def ws_export_session(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Export a session to the configured REST endpoint."""
    from .export import ExportError, async_export_session

    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return

    session = coordinator.store.get_session(msg["session_id"])
    if session is None or session.tracker_id != tracker_id:
        connection.send_error(msg["id"], "not_found", "Session not found")
        return

    try:
        await async_export_session(hass, coordinator, msg["session_id"])
        connection.send_result(msg["id"], {"success": True})
    except ExportError as err:
        connection.send_error(msg["id"], "export_failed", str(err))


# --- Subscribe ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/subscribe",
        vol.Optional("tracker_id"): str,
    }
)
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Subscribe to real-time state updates for a tracker."""
    coordinator = _get_coordinator(hass)
    try:
        tracker_id = _resolve_tracker_id(connection, msg, coordinator)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "forbidden", str(err))
        return

    connection.send_result(msg["id"])
    state = coordinator.get_tracker_state(tracker_id)
    connection.send_message(websocket_api.event_message(msg["id"], state))

    @callback
    def on_update() -> None:
        state = coordinator.get_tracker_state(tracker_id)
        connection.send_message(websocket_api.event_message(msg["id"], state))

    unsub = coordinator.add_tracker_listener(tracker_id, on_update)
    connection.subscriptions[msg["id"]] = unsub
