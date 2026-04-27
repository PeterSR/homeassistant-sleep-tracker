"""Helpers for fetching HA recorder state history."""

from __future__ import annotations

from datetime import datetime
from functools import partial
import logging
from typing import Any

from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


def _entry_to_dict(entry: Any) -> dict[str, Any]:
    """Normalize either a State object or an HA history dict into a plain dict."""
    if isinstance(entry, dict):
        last_changed = entry.get("last_changed") or entry.get("lc")
        if isinstance(last_changed, datetime):
            last_changed = last_changed.isoformat()
        return {"state": entry.get("state") or entry.get("s"), "last_changed": last_changed}
    last_changed = entry.last_changed
    if isinstance(last_changed, datetime):
        last_changed = last_changed.isoformat()
    return {"state": entry.state, "last_changed": last_changed}


async def async_get_state_history(
    hass: HomeAssistant,
    entity_ids: list[str],
    start_time: datetime,
    end_time: datetime,
) -> dict[str, list[dict[str, Any]]]:
    """Fetch all state changes for the given entities in [start_time, end_time].

    Returns a mapping {entity_id: [{"state": str, "last_changed": iso8601}, ...]}.
    Entities with no recorded data return an empty list.
    """
    if not entity_ids:
        return {}

    instance = get_instance(hass)
    raw = await instance.async_add_executor_job(
        partial(
            get_significant_states,
            hass,
            start_time,
            end_time,
            entity_ids,
            include_start_time_state=True,
            significant_changes_only=False,
            no_attributes=True,
        )
    )

    result: dict[str, list[dict[str, Any]]] = {}
    for entity_id in entity_ids:
        states = raw.get(entity_id, []) or []
        result[entity_id] = [_entry_to_dict(s) for s in states]
    return result
