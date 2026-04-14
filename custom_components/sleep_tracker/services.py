"""Service handlers for Sleep Tracker integration."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall

from .const import DOMAIN, EVENT_AWAKE, EVENT_FELL_ASLEEP, EVENT_STILL_AWAKE

_LOGGER = logging.getLogger(__name__)

SERVICE_START_SLEEP = "start_sleep"
SERVICE_STOP_SLEEP = "stop_sleep"
SERVICE_PAUSE_SLEEP = "pause_sleep"
SERVICE_REOPEN_SESSION = "reopen_session"
SERVICE_EVENT_AWAKE = "event_awake"
SERVICE_EVENT_STILL_AWAKE = "event_still_awake"
SERVICE_EVENT_FELL_ASLEEP = "event_fell_asleep"
SERVICE_EXPORT_SESSION = "export_session"

SCHEMA_USER_AND_SOURCE = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Optional("source", default="automation"): str,
    }
)

SCHEMA_SESSION_ID = vol.Schema(
    {
        vol.Required("session_id"): str,
    }
)

SCHEMA_REOPEN = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Required("session_id"): str,
    }
)


def _get_coordinator(hass: HomeAssistant):
    """Get the coordinator from hass.data."""
    data = hass.data.get(DOMAIN)
    if data is None:
        raise ValueError("Sleep Tracker is not set up")
    return data["coordinator"]


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up Sleep Tracker services."""

    async def handle_start_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_start_sleep(
            user_id=call.data["user_id"],
            source=call.data.get("source", "automation"),
        )

    async def handle_stop_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_stop_sleep(
            user_id=call.data["user_id"],
            source=call.data.get("source", "automation"),
        )

    async def handle_pause_sleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_pause_sleep(
            user_id=call.data["user_id"],
            source=call.data.get("source", "automation"),
        )

    async def handle_reopen_session(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_reopen_session(
            user_id=call.data["user_id"],
            session_id=call.data["session_id"],
        )

    async def handle_event_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            user_id=call.data["user_id"],
            event_type=EVENT_AWAKE,
            source=call.data.get("source", "automation"),
        )

    async def handle_event_still_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            user_id=call.data["user_id"],
            event_type=EVENT_STILL_AWAKE,
            source=call.data.get("source", "automation"),
        )

    async def handle_event_fell_asleep(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_event(
            user_id=call.data["user_id"],
            event_type=EVENT_FELL_ASLEEP,
            source=call.data.get("source", "automation"),
        )

    async def handle_export_session(call: ServiceCall) -> None:
        from .export import async_export_session

        coordinator = _get_coordinator(hass)
        await async_export_session(hass, coordinator, call.data["session_id"])

    hass.services.async_register(
        DOMAIN, SERVICE_START_SLEEP, handle_start_sleep,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_SLEEP, handle_stop_sleep,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PAUSE_SLEEP, handle_pause_sleep,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_REOPEN_SESSION, handle_reopen_session,
        schema=SCHEMA_REOPEN,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_AWAKE, handle_event_awake,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_STILL_AWAKE, handle_event_still_awake,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EVENT_FELL_ASLEEP, handle_event_fell_asleep,
        schema=SCHEMA_USER_AND_SOURCE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EXPORT_SESSION, handle_export_session,
        schema=SCHEMA_SESSION_ID,
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
    ):
        hass.services.async_remove(DOMAIN, service)
