"""REST export for finalized sleep sessions."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .timeline import compute_intervals, compute_stats

if TYPE_CHECKING:
    from .coordinator import SleepTrackerCoordinator

_LOGGER = logging.getLogger(__name__)


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

    config = coordinator.store.get_user_config(session.user_id)
    if config is None or not config.export_url:
        raise ExportError("No export URL configured for this user")

    intervals = compute_intervals(
        session.started_at,
        session.ended_at,
        session.pulses,
        config.fall_asleep_latency_minutes,
    )
    stats = compute_stats(intervals, session.started_at, session.ended_at)

    payload = {
        "session_id": session.session_id,
        "user_id": session.user_id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "pulses": [p.to_dict() for p in session.pulses],
        "computed": {
            **stats,
            "intervals": [i.to_dict() for i in intervals],
        },
    }

    client = async_get_clientsession(hass)
    headers = {"Content-Type": "application/json"}
    if config.export_headers:
        headers.update(config.export_headers)

    try:
        async with client.post(
            config.export_url, json=payload, headers=headers
        ) as resp:
            if resp.status >= 300:
                body = await resp.text()
                raise ExportError(
                    f"Export failed with status {resp.status}: {body[:200]}"
                )
    except ExportError:
        raise
    except Exception as err:
        raise ExportError(f"Export request failed: {err}") from err

    coordinator.store.update_session(session_id, exported=True)
    _LOGGER.info("Session %s exported successfully", session_id)
