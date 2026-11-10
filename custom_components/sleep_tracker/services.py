"""Service handlers for Sleep Tracker integration."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.util import dt as dt_util

from .automation_meta import resolve_automation_metadata
from .const import (
    DEFAULT_AUTOMATION_SOURCE,
    DOMAIN,
    EVENT_AWAKE,
    EVENT_FELL_ASLEEP,
    EVENT_STILL_AWAKE,
)

SERVICE_START_SLEEP = "start_sleep"
SERVICE_STOP_SLEEP = "stop_sleep"
SERVICE_PAUSE_SLEEP = "pause_sleep"
SERVICE_REOPEN_SESSION = "reopen_session"
SERVICE_EVENT_AWAKE = "event_awake"
SERVICE_EVENT_STILL_AWAKE = "event_still_awake"
SERVICE_EVENT_FELL_ASLEEP = "event_fell_asleep"
SERVICE_EXPORT_SESSION = "export_session"
SERVICE_LIST_SESSIONS = "list_sessions"
SERVICE_GET_SESSION = "get_session"
SERVICE_MARK_EXPORTED = "mark_exported"

SCHEMA_TRACKER_AND_SOURCE = vol.Schema(
    {
        vol.Required("tracker_id"): str,
        vol.Optional("source", default=DEFAULT_AUTOMATION_SOURCE): str,
        vol.Optional("automation_id"): vol.Any(str, None),
        vol.Optional("automation_trigger_id"): vol.Any(str, None),
    }
)

SCHEMA_SESSION_ID = vol.Schema(
    {
        vol.Required("session_id"): str,
    }
)

SCHEMA_LIST_SESSIONS = vol.Schema(
    {
        vol.Optional("tracker_id"): str,
        vol.Optional("finalized"): cv.boolean,
        vol.Optional("exported"): cv.boolean,
    }
)

SCHEMA_MARK_EXPORTED = vol.Schema(
    {
        vol.Required("session_id"): str,
        vol.Optional("exported", default=True): cv.boolean,
        vol.Optional("revision"): vol.All(int, vol.Range(min=0)),
    }
)

SCHEMA_REOPEN = vol.Schema(
    {
        vol.Required("tracker_id"): str,
        vol.Required("session_id"): str,
    }
)


def _start_sort_key(session) -> tuple[float, str]:
    """Sort by parsed start time, falling back to the raw string."""
    parsed = dt_util.parse_datetime(session.started_at)
    if parsed is None:
        return (float("inf"), session.started_at)
    return (dt_util.as_utc(parsed).timestamp(), session.started_at)


async def _automation_kwargs(
    hass: HomeAssistant, call: ServiceCall
) -> dict[str, str | None]:
    """Resolve automation metadata for a service call.

    Explicit fields on the service call win. Any field left unset is
    auto-detected from HA's trace component (best-effort).
    """
    auto_id, auto_trigger = await resolve_automation_metadata(hass, call.context)
    return {
        "automation_id": (
            call.data["automation_id"]
            if "automation_id" in call.data
            else auto_id
        ),
        "automation_trigger_id": (
            call.data["automation_trigger_id"]
            if "automation_trigger_id" in call.data
            else auto_trigger
        ),
    }


def _get_coordinator(hass: HomeAssistant):
    """Get the coordinator from hass.data."""
    data = hass.data.get(DOMAIN)
    if data is None:
        raise HomeAssistantError("Sleep Tracker is not set up")
    return data["coordinator"]


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up Sleep Tracker services."""

    async def handle_start_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_start_sleep(
            tracker_id=call.data["tracker_id"],
            source=call.data["source"],
            **await _automation_kwargs(hass, call),
        )

    async def handle_stop_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_stop_sleep(
            tracker_id=call.data["tracker_id"],
            source=call.data["source"],
        )

    async def handle_pause_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_pause_sleep(
            tracker_id=call.data["tracker_id"],
            source=call.data["source"],
            **await _automation_kwargs(hass, call),
        )

    async def handle_reopen_session(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_reopen_session(
            tracker_id=call.data["tracker_id"],
            session_id=call.data["session_id"],
        )

    async def handle_event_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            tracker_id=call.data["tracker_id"],
            event_type=EVENT_AWAKE,
            source=call.data["source"],
            **await _automation_kwargs(hass, call),
        )

    async def handle_event_still_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            tracker_id=call.data["tracker_id"],
            event_type=EVENT_STILL_AWAKE,
            source=call.data["source"],
            **await _automation_kwargs(hass, call),
        )

    async def handle_event_fell_asleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            tracker_id=call.data["tracker_id"],
            event_type=EVENT_FELL_ASLEEP,
            source=call.data["source"],
            **await _automation_kwargs(hass, call),
        )

    async def handle_export_session(call: ServiceCall) -> None:
        from .export import async_export_session

        coordinator = _get_coordinator(hass)
        await async_export_session(hass, coordinator, call.data["session_id"])

    async def handle_list_sessions(call: ServiceCall) -> dict:
        coordinator = _get_coordinator(hass)
        sessions = [
            s
            for s in coordinator.store.sessions.values()
            if ("tracker_id" not in call.data or s.tracker_id == call.data["tracker_id"])
            and ("finalized" not in call.data or s.finalized == call.data["finalized"])
            and ("exported" not in call.data or s.exported == call.data["exported"])
        ]
        sessions.sort(key=_start_sort_key)
        return {
            "sessions": [
                {
                    "session_id": s.session_id,
                    "tracker_id": s.tracker_id,
                    "started_at": s.started_at,
                    "ended_at": s.ended_at,
                    "finalized": s.finalized,
                    "exported": s.exported,
                    "revision": s.revision,
                }
                for s in sessions
            ]
        }

    async def handle_get_session(call: ServiceCall) -> dict:
        from .export import async_build_export_payload

        coordinator = _get_coordinator(hass)
        payload = await async_build_export_payload(
            hass, coordinator, call.data["session_id"]
        )
        session = coordinator.store.get_session(call.data["session_id"])
        return {"session": payload, "revision": session.revision}

    async def handle_mark_exported(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        coordinator.async_set_exported(
            call.data["session_id"], call.data["exported"], call.data.get("revision")
        )

    hass.services.async_register(
        DOMAIN, SERVICE_START_SLEEP, handle_start_sleep,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_SLEEP, handle_stop_sleep,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PAUSE_SLEEP, handle_pause_sleep,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REOPEN_SESSION, handle_reopen_session,
        schema=SCHEMA_REOPEN,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_AWAKE, handle_event_awake,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_STILL_AWAKE, handle_event_still_awake,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_FELL_ASLEEP, handle_event_fell_asleep,
        schema=SCHEMA_TRACKER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EXPORT_SESSION, handle_export_session,
        schema=SCHEMA_SESSION_ID,
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_LIST_SESSIONS, handle_list_sessions,
        schema=SCHEMA_LIST_SESSIONS,
        supports_response=SupportsResponse.ONLY,
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_GET_SESSION, handle_get_session,
        schema=SCHEMA_SESSION_ID,
        supports_response=SupportsResponse.ONLY,
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_MARK_EXPORTED, handle_mark_exported,
        schema=SCHEMA_MARK_EXPORTED,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Sleep Tracker services."""
    for service in (
        SERVICE_START_SLEEP,
        SERVICE_STOP_SLEEP,
        SERVICE_PAUSE_SLEEP,
        SERVICE_REOPEN_SESSION,
        SERVICE_EVENT_AWAKE,
        SERVICE_EVENT_STILL_AWAKE,
        SERVICE_EVENT_FELL_ASLEEP,
        SERVICE_EXPORT_SESSION,
        SERVICE_LIST_SESSIONS,
        SERVICE_GET_SESSION,
        SERVICE_MARK_EXPORTED,
    ):
        hass.services.async_remove(DOMAIN, service)
