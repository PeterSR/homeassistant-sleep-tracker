"""WebSocket API for Sleep Tracker frontend."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PULSE_AWAKE, PULSE_STILL_AWAKE

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_get_state)
    websocket_api.async_register_command(hass, ws_get_history)
    websocket_api.async_register_command(hass, ws_get_session)
    websocket_api.async_register_command(hass, ws_start_sleep)
    websocket_api.async_register_command(hass, ws_stop_sleep)
    websocket_api.async_register_command(hass, ws_pulse)
    websocket_api.async_register_command(hass, ws_setup_user)
    websocket_api.async_register_command(hass, ws_update_settings)
    websocket_api.async_register_command(hass, ws_get_stats)
    websocket_api.async_register_command(hass, ws_delete_pulse)
    websocket_api.async_register_command(hass, ws_swap_pulse_type)
    websocket_api.async_register_command(hass, ws_finalize_session)
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


# --- Pulse ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/pulse",
        vol.Required("pulse_type"): vol.In([PULSE_AWAKE, PULSE_STILL_AWAKE]),
    }
)
@websocket_api.async_response
async def ws_pulse(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Record a pulse in the active session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_pulse(
            user_id, msg["pulse_type"], source="panel"
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "pulse_failed", str(err))


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
        vol.Optional("auto_finalize_hours"): vol.All(
            int, vol.Range(min=1, max=48)
        ),
        vol.Optional("export_url"): vol.Any(str, None),
        vol.Optional("export_headers"): dict,
        vol.Optional("retention_days"): vol.All(
            int, vol.Range(min=7, max=365)
        ),
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


# --- Delete Pulse ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/delete_pulse",
        vol.Required("session_id"): str,
        vol.Required("pulse_index"): int,
    }
)
@websocket_api.async_response
async def ws_delete_pulse(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a pulse from a session."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_delete_pulse(
            user_id, msg["session_id"], msg["pulse_index"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "delete_failed", str(err))


# --- Swap Pulse Type ---

@websocket_api.websocket_command(
    {
        vol.Required("type"): "sleep_tracker/swap_pulse_type",
        vol.Required("session_id"): str,
        vol.Required("pulse_index"): int,
    }
)
@websocket_api.async_response
async def ws_swap_pulse_type(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Swap a pulse's type between awake and still_awake."""
    coordinator = _get_data(hass)["coordinator"]
    user_id = connection.user.id

    try:
        session = await coordinator.async_swap_pulse_type(
            user_id, msg["session_id"], msg["pulse_index"]
        )
        connection.send_result(msg["id"], session)
    except ValueError as err:
        connection.send_error(msg["id"], "swap_failed", str(err))


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

    # Verify ownership
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

    # Send initial state
    connection.send_result(msg["id"])
    state = coordinator.get_user_state(user_id)
    connection.send_message(websocket_api.event_message(msg["id"], state))

    @callback
    def on_update() -> None:
        state = coordinator.get_user_state(user_id)
        connection.send_message(websocket_api.event_message(msg["id"], state))

    unsub = coordinator.add_user_listener(user_id, on_update)
    connection.subscriptions[msg["id"]] = unsub
