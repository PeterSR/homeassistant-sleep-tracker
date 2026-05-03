"""REST export for finalized sleep sessions."""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging
from typing import TYPE_CHECKING

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .history_helper import async_get_state_history
from .phases import compute_stats, materialize_phases

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator

_LOGGER = logging.getLogger(__name__)

EXPORT_TIMEOUT_SECONDS = 30


class ExportError(Exception):
    """Raised when export fails."""


async def async_export_session(
    hass: HomeAssistant,
    coordinator: SleepTrackerCoordinator,
    session_id: str,
) -> None:
    """Export a completed session to the user's configured REST endpoint."""
    session = coordinator.store.get_session(session_id)
    if session is None:
        raise ExportError(f"Session {session_id} not found")
    if session.is_active:
        raise ExportError("Cannot export an active session")

    config = coordinator.store.get_tracker_config(session.tracker_id)
    if config is None or not config.export_url:
        raise ExportError("No export URL configured for this tracker")

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

    payload = {
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
        "tags": session.tags,
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
        except Exception:  # noqa: BLE001 — never fail export over missing history
            _LOGGER.exception(
                "Failed to fetch environment history for session %s", session_id
            )
            payload["environment_history"] = {}

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
                body = await resp.text()
                raise ExportError(
                    f"Export failed with status {resp.status}: {body[:200]}"
                )
    except ExportError:
        raise
    except asyncio.TimeoutError as err:
        raise ExportError(
            f"Export timed out after {EXPORT_TIMEOUT_SECONDS}s"
        ) from err
    except aiohttp.ClientError as err:
        raise ExportError(f"Export request failed: {err}") from err

    coordinator.store.update_session(session_id, exported=True)
    _LOGGER.info("Session %s exported successfully", session_id)
