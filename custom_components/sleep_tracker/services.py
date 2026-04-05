"""Service handlers for Sleep Tracker integration."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall

from .const import DOMAIN, PULSE_AWAKE, PULSE_STILL_AWAKE

_LOGGER = logging.getLogger(__name__)

SERVICE_START_SLEEP = "start_sleep"
SERVICE_STOP_SLEEP = "stop_sleep"
SERVICE_PULSE_AWAKE = "pulse_awake"
SERVICE_PULSE_STILL_AWAKE = "pulse_still_awake"
SERVICE_EXPORT_SESSION = "export_session"

SCHEMA_START_SLEEP = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Optional("source", default="automation"): str,
    }
)

SCHEMA_STOP_SLEEP = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Optional("source", default="automation"): str,
    }
)

SCHEMA_PULSE_AWAKE = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Optional("source", default="automation"): str,
    }
)

SCHEMA_PULSE_STILL_AWAKE = vol.Schema(
    {
        vol.Required("user_id"): str,
        vol.Optional("source", default="automation"): str,
    }
)

SCHEMA_EXPORT_SESSION = vol.Schema(
    {
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

    async def handle_pulse_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_pulse(
            user_id=call.data["user_id"],
            pulse_type=PULSE_AWAKE,
            source=call.data.get("source", "automation"),
        )

    async def handle_pulse_still_awake(call: ServiceCall) -> None:
        coordinator = _get_coordinator(hass)
        await coordinator.async_pulse(
            user_id=call.data["user_id"],
            pulse_type=PULSE_STILL_AWAKE,
            source=call.data.get("source", "automation"),
        )

    async def handle_export_session(call: ServiceCall) -> None:
        from .export import async_export_session

        coordinator = _get_coordinator(hass)
        await async_export_session(hass, coordinator, call.data["session_id"])

    hass.services.async_register(
        DOMAIN, SERVICE_START_SLEEP, handle_start_sleep,
        schema=SCHEMA_START_SLEEP,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_SLEEP, handle_stop_sleep,
        schema=SCHEMA_STOP_SLEEP,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PULSE_AWAKE, handle_pulse_awake,
        schema=SCHEMA_PULSE_AWAKE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_PULSE_STILL_AWAKE, handle_pulse_still_awake,
        schema=SCHEMA_PULSE_STILL_AWAKE,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_EXPORT_SESSION, handle_export_session,
        schema=SCHEMA_EXPORT_SESSION,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload Sleep Tracker services."""
    for service in (
        SERVICE_START_SLEEP,
        SERVICE_STOP_SLEEP,
        SERVICE_PULSE_AWAKE,
        SERVICE_PULSE_STILL_AWAKE,
        SERVICE_EXPORT_SESSION,
    ):
        hass.services.async_remove(DOMAIN, service)
