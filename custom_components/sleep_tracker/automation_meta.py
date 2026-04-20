"""Best-effort resolution of automation metadata from a service call context.

Uses Home Assistant's (private-ish) `trace` component to recover which
automation triggered a service call and which trigger.id matched, so users
don't have to pass them explicitly. Never crashes: on any failure returns
`(None, "ERROR")` or `(None, None)` so the event still records.

If `trace.util` stops exposing these functions in a future HA release, the
resolver logs a debug message and returns `"ERROR"` as the trigger_id marker
so the missing data is visible rather than silent.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import Context, HomeAssistant

_LOGGER = logging.getLogger(__name__)

AUTOMATION_TRIGGER_ID_ERROR = "ERROR"


async def resolve_automation_metadata(
    hass: HomeAssistant, context: Context
) -> tuple[str | None, str | None]:
    """Return (automation_entity_id, trigger_id) for the calling automation.

    Returns (None, None) when the call has no parent context (panel / manual /
    script not in an automation). Returns (entity_id_or_None, "ERROR") when
    the private trace API surface changed or lookup partially failed.
    """
    parent_id = context.parent_id
    if parent_id is None:
        return None, None

    try:
        from homeassistant.components.trace.const import DATA_TRACE
        from homeassistant.components.trace.util import async_list_contexts
    except ImportError:
        _LOGGER.debug("HA trace component unavailable; cannot resolve automation metadata")
        return None, None

    try:
        contexts = await async_list_contexts(hass, None)
    except Exception:
        _LOGGER.debug(
            "trace.async_list_contexts failed for parent %s", parent_id, exc_info=True
        )
        return None, AUTOMATION_TRIGGER_ID_ERROR

    info = contexts.get(parent_id)
    if info is None or info.get("domain") != "automation":
        return None, None

    unique_id = info.get("item_id")
    run_id = info.get("run_id")
    entity_id = _entity_id_for_automation(hass, unique_id)

    trigger_id: str | None = AUTOMATION_TRIGGER_ID_ERROR
    try:
        trace_store = hass.data.get(DATA_TRACE)
        if trace_store is not None and unique_id and run_id:
            trace = trace_store.get(f"automation.{unique_id}", {}).get(run_id)
            extracted = _extract_trigger_id(trace)
            if extracted is not None:
                trigger_id = extracted
    except Exception:
        _LOGGER.debug(
            "trigger.id extraction failed for automation %s run %s",
            unique_id, run_id, exc_info=True,
        )

    return entity_id, trigger_id


def _entity_id_for_automation(hass: HomeAssistant, unique_id: str | None) -> str | None:
    if not unique_id:
        return None
    try:
        from homeassistant.helpers import entity_registry as er

        registry = er.async_get(hass)
        return registry.async_get_entity_id("automation", "automation", unique_id)
    except Exception:
        _LOGGER.debug(
            "entity_registry lookup failed for automation %s", unique_id, exc_info=True
        )
        return None


def _extract_trigger_id(trace: Any) -> str | None:
    """Pull trigger.id out of a trace's trigger step variables."""
    if trace is None:
        return None
    trace_steps = getattr(trace, "_trace", None)
    if not trace_steps:
        return None
    for path, elements in trace_steps.items():
        if not path.startswith("trigger"):
            continue
        for elem in elements:
            variables = getattr(elem, "_variables", None) or {}
            trigger_vars = variables.get("trigger")
            if isinstance(trigger_vars, dict) and "id" in trigger_vars:
                return str(trigger_vars["id"])
    return None
