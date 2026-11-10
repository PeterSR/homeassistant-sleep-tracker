"""REST export for finalized sleep sessions."""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .history_helper import async_get_state_history
from .phases import compute_stats, materialize_phases

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator

_LOGGER = logging.getLogger(__name__)

EXPORT_TIMEOUT_SECONDS = 30


class ExportError(HomeAssistantError):
    """Raised when export fails."""


async def async_build_export_payload(
    hass: HomeAssistant,
    coordinator: SleepTrackerCoordinator,
    session_id: str,
) -> dict[str, Any]:
    """Build the export payload for a completed session.

    Shared by the REST export and the get_session action so both always
    produce the same data.
    """
    session = coordinator.store.get_session(session_id)
    if session is None:
        raise ExportError(f"Session {session_id} not found")
    if session.is_active:
        raise ExportError("Session is still active")

    config = coordinator.store.get_tracker_config(session.tracker_id)
    if config is None:
        raise ExportError("Tracker not found")

    # Prefer stored (edited) phases; fall back to materializing from events
    if session.phases is not None:
        phases = session.phases
    else:
        phases = materialize_phases(
            session.started_at,
            session.ended_at,
            session.events,
            fall_asleep_latency_minutes=config.fall_asleep_latency_minutes,
            sleep_onset_minutes=config.sleep_onset_minutes,
        )
    stats = compute_stats(phases, session.started_at, session.ended_at)

    payload: dict[str, Any] = {
        "session_id": session.session_id,
        "tracker_id": session.tracker_id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "events": [e.to_dict() for e in session.events],
        "phases": [p.to_dict() for p in phases],
        "stats": stats,
        "note": session.note,
        "rating_quality": session.rating_quality,
        "rating_feeling": session.rating_feeling,
        "tags": list(session.tags),
        # Read before any await below, so it always matches the data above.
        "revision": session.revision,
    }

    if (
        config.export_environment_data
        and config.environment_entities
        and session.ended_at
    ):
        try:
            start_dt = datetime.fromisoformat(session.started_at)
            end_dt = datetime.fromisoformat(session.ended_at)
            payload["environment_history"] = await async_get_state_history(
                hass, config.environment_entities, start_dt, end_dt
            )
        except Exception:  # noqa: BLE001 - never fail export over missing history
            _LOGGER.exception(
                "Failed to fetch environment history for session %s", session_id
            )
            payload["environment_history"] = {}

    return payload


async def async_export_session(
    hass: HomeAssistant,
    coordinator: SleepTrackerCoordinator,
    session_id: str,
    *,
    raise_if_changed: bool = True,
) -> bool:
    """Export a finalized session to the user's configured REST endpoint.

    If the session changed or was removed while the request was in flight it
    is left unexported. That raises ExportError unless `raise_if_changed` is
    false (auto-export), which only logs a warning. Returns True when the
    session was marked exported, False when it was left unexported.
    """
    session = coordinator.store.get_session(session_id)
    if session is None:
        raise ExportError(f"Session {session_id} not found")
    if session.is_active:
        raise ExportError("Cannot export an active session")

    if not session.finalized:
        raise ExportError("Session is not finalized")

    config = coordinator.store.get_tracker_config(session.tracker_id)
    if config is None or not config.export_url:
        raise ExportError("No export URL configured for this tracker")
    if not config.export_url.startswith(("http://", "https://")):
        raise ExportError("export_url must be an http(s) URL")

    payload = await async_build_export_payload(hass, coordinator, session_id)

    client = async_get_clientsession(hass)
    headers = {"Content-Type": "application/json"}
    if config.export_headers:
        headers.update(config.export_headers)

    try:
        async with client.post(
            config.export_url,
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=EXPORT_TIMEOUT_SECONDS),
        ) as resp:
            if resp.status >= 300:
                # Log the body server-side only; relaying it to the caller
                # would let a crafted export_url read internal HTTP responses.
                body = await resp.text()
                _LOGGER.warning(
                    "Export of session %s failed with status %s: %s",
                    session_id,
                    resp.status,
                    body[:200],
                )
                raise ExportError(f"Export failed with status {resp.status}")
    except ExportError:
        raise
    except asyncio.TimeoutError as err:
        raise ExportError(
            f"Export timed out after {EXPORT_TIMEOUT_SECONDS}s"
        ) from err
    except aiohttp.ClientError as err:
        raise ExportError(f"Export request failed: {err}") from err

    try:
        coordinator.async_set_exported(session_id, True, payload["revision"])
    except HomeAssistantError as err:
        # Unfinalized, re-finalized, active or deleted while the request was
        # in flight: the delivered data may be stale, so leave it unexported.
        _LOGGER.warning(
            "Session %s changed or removed during export, not marking it exported",
            session_id,
        )
        if raise_if_changed:
            raise ExportError(
                "Session changed during export; not marked exported"
            ) from err
        return False
    _LOGGER.info("Session %s exported successfully", session_id)
    return True
