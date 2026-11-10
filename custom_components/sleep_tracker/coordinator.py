"""Coordinator for Sleep Tracker integration.

Manages sleep sessions, event processing, phase materialization, entity
notification, and state queries. Entirely event-driven (no tick loop).

A "tracker" is either a personal tracker (kind="user", tracker_id == HA user id)
or a shared tracker (kind="shared", tracker_id == generated UUID) that any
authenticated user can act on (e.g. for a baby).

Model:
- Events are raw immutable signals (user button, sensor, etc.) collected
  during an active session.
- Phases (awake/asleep intervals) are materialized from events on session
  stop and stored. After stop, phases are edited directly; events become
  read-only history.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, NamedTuple

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from .const import (
    BUS_EVENT_EVENT,
    BUS_EVENT_SESSION_ENDED,
    BUS_EVENT_SESSION_FINALIZED,
    BUS_EVENT_SESSION_PAUSED,
    BUS_EVENT_SESSION_RESUMED,
    BUS_EVENT_SESSION_STARTED,
    DEFAULT_PANEL_SOURCE,
    DOMAIN,
    EVENT_AWAKE,
    EVENT_CUSTOM,
    EVENT_PAUSE,
    EVENT_RESUME,
    EVENT_STILL_AWAKE,
    KIND_SHARED,
    KIND_USER,
    PHASE_ASLEEP,
    PHASE_AWAKE,
    USER_EVENT_TYPES,
)
from .models import (
    TRACKER_SWITCHER_VALUES,
    ChecklistItem,
    CustomEvent,
    SleepEvent,
    SleepPhase,
    SleepSession,
    TrackerConfig,
)
from .phases import (
    adjust_phase_boundary,
    append_phase,
    compute_stats,
    delete_phase,
    materialize_phases,
    split_phase,
)
from .store import SleepTrackerStore

_LOGGER = logging.getLogger(__name__)


class PhaseSnapshot(NamedTuple):
    """Undo snapshot: phase list plus the session's ended_at at edit time.

    ended_at is tracked because append_phase extends the session boundary,
    so undo must restore it alongside phases.
    """

    phases: list[SleepPhase]
    ended_at: str | None


class SleepTrackerCoordinator:
    """Brain of the sleep tracker - session management and state queries."""

    def __init__(self, hass: HomeAssistant, store: SleepTrackerStore) -> None:
        self.hass = hass
        self.store = store
        self._listeners: list[Callable[[], None]] = []
        self._tracker_listeners: dict[str, list[Callable[[], None]]] = {}
        # In-memory edit history for undo: session_id -> list of snapshots
        self._edit_history: dict[str, list[PhaseSnapshot]] = {}
        self._max_history = 30

    # --- Listener management ---

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Add a global listener. Returns unsubscribe function."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            self._listeners.remove(listener)

        return remove

    @callback
    def add_tracker_listener(
        self, tracker_id: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Add a per-tracker listener. Returns unsubscribe function."""
        self._tracker_listeners.setdefault(tracker_id, []).append(listener)

        @callback
        def remove() -> None:
            listeners = self._tracker_listeners.get(tracker_id, [])
            if listener in listeners:
                listeners.remove(listener)

        return remove

    @callback
    def _notify_listeners(self, tracker_id: str) -> None:
        """Notify global and tracker-specific listeners."""
        for listener in self._listeners:
            listener()
        for listener in self._tracker_listeners.get(tracker_id, []):
            listener()

    # --- Tracker management ---

    async def async_setup_tracker(
        self,
        tracker_id: str,
        display_name: str,
        kind: str = KIND_USER,
        **kwargs: Any,
    ) -> dict:
        """Set up a tracker. Creates entities dynamically.

        If the tracker already exists, returns the existing config untouched -
        callers should use `async_update_tracker_config` to change settings.
        """
        display_name = display_name.strip()
        if not display_name:
            raise HomeAssistantError("display_name must be non-empty")
        if kind not in (KIND_USER, KIND_SHARED):
            raise HomeAssistantError(f"Invalid tracker kind: {kind}")

        existing = self.store.get_tracker_config(tracker_id)
        if existing is not None:
            return existing.to_dict()

        if "checklist" in kwargs:
            kwargs["checklist"] = [
                ChecklistItem.from_dict(item) for item in kwargs["checklist"]
            ]

        config = TrackerConfig(
            tracker_id=tracker_id,
            kind=kind,
            display_name=display_name,
            **kwargs,
        )
        self.store.set_tracker_config(config)

        await self._async_create_tracker_entities(tracker_id)

        self._notify_listeners(tracker_id)
        return config.to_dict()

    async def async_create_shared_tracker(
        self, display_name: str, created_by: str
    ) -> dict:
        """Create a new shared tracker with a generated UUID."""
        tracker_id = str(uuid.uuid4())
        return await self.async_setup_tracker(
            tracker_id, display_name, kind=KIND_SHARED, created_by=created_by
        )

    async def async_delete_tracker(self, tracker_id: str) -> None:
        """Delete a tracker (config + all sessions + entities)."""
        config = self.store.get_tracker_config(tracker_id)
        if config is None:
            raise HomeAssistantError(f"Tracker {tracker_id} not found")

        # Remove entities by clearing their listeners and unregistering.
        # Entities self-unregister via async_will_remove_from_hass when the
        # entity registry deletes them - we just need to clear store state.
        self.store.remove_tracker(tracker_id)
        self._tracker_listeners.pop(tracker_id, None)

        # Remove device entry so entities disappear from HA.
        from homeassistant.helpers import device_registry as dr
        device_reg = dr.async_get(self.hass)
        device = device_reg.async_get_device(identifiers={(DOMAIN, tracker_id)})
        if device:
            device_reg.async_remove_device(device.id)

        _LOGGER.info("Tracker %s deleted", tracker_id)

    def get_accessible_trackers(self, hass_user_id: str) -> list[dict]:
        """Return trackers visible to a given HA user.

        Visibility rules:
        - Personal trackers (kind=user): only the owner sees them.
        - Shared trackers (kind=shared): all authenticated users see them.
        Personal first, then shared alphabetical by display_name.
        """
        personal: list[dict] = []
        shared: list[dict] = []
        for config in self.store.trackers.values():
            if config.kind == KIND_USER:
                if config.tracker_id == hass_user_id:
                    personal.append(config.to_dict())
            elif config.kind == KIND_SHARED:
                shared.append(config.to_dict())
        shared.sort(key=lambda t: (t.get("display_name") or "").lower())
        return personal + shared

    # --- User preferences ---

    def get_user_preferences(self, ha_user_id: str) -> dict:
        """Get UI preferences for a HA user (with defaults)."""
        return self.store.get_user_preferences(ha_user_id).to_dict()

    async def async_update_user_preferences(
        self, ha_user_id: str, **kwargs: Any
    ) -> dict:
        """Update UI preferences for a HA user."""
        prefs = self.store.get_user_preferences(ha_user_id)

        if "tracker_switcher_visibility" in kwargs:
            value = kwargs["tracker_switcher_visibility"]
            if value not in TRACKER_SWITCHER_VALUES:
                raise HomeAssistantError(
                    f"Invalid tracker_switcher_visibility: {value}"
                )
            prefs.tracker_switcher_visibility = value

        self.store.set_user_preferences(prefs)
        return prefs.to_dict()

    async def async_update_tracker_config(
        self, tracker_id: str, **kwargs: Any
    ) -> dict:
        """Update tracker configuration."""
        config = self.store.get_tracker_config(tracker_id)
        if config is None:
            raise HomeAssistantError(f"Tracker {tracker_id} is not set up")

        if "checklist" in kwargs:
            kwargs["checklist"] = [
                ChecklistItem.from_dict(item) for item in kwargs["checklist"]
            ]

        if "custom_events" in kwargs:
            kwargs["custom_events"] = self._normalize_custom_events(
                kwargs["custom_events"]
            )

        for key, value in kwargs.items():
            if key in ("tracker_id", "kind") or not hasattr(config, key):
                raise HomeAssistantError(f"Unknown config key: {key}")
            setattr(config, key, value)

        self.store.set_tracker_config(config)
        self._notify_listeners(tracker_id)
        return config.to_dict()

    def _normalize_custom_events(
        self, raw: list[dict[str, Any]]
    ) -> list[CustomEvent]:
        """Normalize incoming custom-event dicts: fill id, default label to tag."""
        result: list[CustomEvent] = []
        for entry in raw:
            label = (entry.get("label") or "").strip()
            tag = (entry.get("tag") or "").strip() or None
            icon = (entry.get("icon") or "").strip() or None
            if not label:
                if tag:
                    label = tag
                else:
                    raise HomeAssistantError("Custom event needs a label or a tag")
            entry_id = entry.get("id") or str(uuid.uuid4())
            result.append(CustomEvent(id=entry_id, label=label, icon=icon, tag=tag))
        return result

    async def _async_create_tracker_entities(self, tracker_id: str) -> None:
        """Create sensor/binary_sensor entities for a newly set up tracker."""
        from .binary_sensor import create_tracker_binary_sensors
        from .sensor import create_tracker_sensors

        add_sensors = self.hass.data.get(DOMAIN, {}).get(
            "async_add_sensor_entities"
        )
        add_binary = self.hass.data.get(DOMAIN, {}).get(
            "async_add_binary_sensor_entities"
        )

        if add_sensors:
            add_sensors(create_tracker_sensors(self, tracker_id))
        if add_binary:
            add_binary(create_tracker_binary_sensors(self, tracker_id))

    # --- Session management ---

    async def async_start_sleep(
        self,
        tracker_id: str,
        source: str,
        automation_id: str | None = None,
        automation_trigger_id: str | None = None,
    ) -> dict:
        """Start a new sleep session, or resume a paused one.

        If there is a paused session, resume it (record resume event, clear
        paused_at). Otherwise, create a new session. Auto-finalizes any
        pending sessions first.
        """
        config = self.store.get_tracker_config(tracker_id)
        if config is None:
            raise HomeAssistantError(
                f"Tracker {tracker_id} is not set up for sleep tracking"
            )

        active = self.store.get_active_session(tracker_id)
        if active is not None:
            if active.paused_at is not None:
                return await self._async_resume_sleep(
                    tracker_id, active, source,
                    automation_id=automation_id,
                    automation_trigger_id=automation_trigger_id,
                )
            raise HomeAssistantError(
                f"Tracker {tracker_id} already has an active session: {active.session_id}"
            )

        # Auto-finalize any unfinalized sessions
        await self._async_auto_finalize(tracker_id)

        session = SleepSession(
            session_id=str(uuid.uuid4()),
            tracker_id=tracker_id,
            started_at=dt_util.utcnow().isoformat(),
        )
        self.store.add_session(session)

        purged = self.store.purge_old_sessions(tracker_id, config.retention_days)
        if purged:
            _LOGGER.debug("Purged %d old sessions for tracker %s", purged, tracker_id)

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_SESSION_STARTED,
            {"tracker_id": tracker_id, "session_id": session.session_id},
        )

        _LOGGER.info(
            "Sleep session started for tracker %s (source: %s)", tracker_id, source
        )
        return self._session_to_dict(session)

    async def _async_resume_sleep(
        self,
        tracker_id: str,
        session: SleepSession,
        source: str,
        automation_id: str | None = None,
        automation_trigger_id: str | None = None,
    ) -> dict:
        """Resume a paused session. Records a resume event and clears paused_at."""
        event = SleepEvent(
            timestamp=dt_util.utcnow().isoformat(),
            event_type=EVENT_RESUME,
            source=source,
            automation_id=automation_id,
            automation_trigger_id=automation_trigger_id,
        )
        session.events.append(event)
        self.store.update_session(
            session.session_id, events=session.events, paused_at=None
        )

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_SESSION_RESUMED,
            {"tracker_id": tracker_id, "session_id": session.session_id},
        )

        _LOGGER.info(
            "Sleep session resumed for tracker %s (source: %s)", tracker_id, source
        )
        return self._session_to_dict(session)

    async def async_stop_sleep(
        self, tracker_id: str, source: str
    ) -> dict:
        """Stop the active sleep session.

        Sets ended_at but does NOT materialize phases - the session enters
        event-review mode. Call async_complete_session to materialize.
        """
        session = self.store.get_active_session(tracker_id)
        if session is None:
            raise HomeAssistantError(f"Tracker {tracker_id} has no active session")

        ended_at = dt_util.utcnow().isoformat()
        self.store.update_session(
            session.session_id, ended_at=ended_at, paused_at=None
        )

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_SESSION_ENDED,
            {"tracker_id": tracker_id, "session_id": session.session_id},
        )

        _LOGGER.info(
            "Sleep session ended for tracker %s (source: %s)", tracker_id, source
        )

        # Auto-progress if tracker has skip settings enabled
        config = self.store.get_tracker_config(tracker_id)
        if config and config.skip_event_review:
            return await self.async_complete_session(tracker_id, session.session_id)

        return self._session_to_dict(session)

    async def async_pause_sleep(
        self,
        tracker_id: str,
        source: str,
        automation_id: str | None = None,
        automation_trigger_id: str | None = None,
    ) -> dict:
        """Pause the active session - marks tracker as awake until resumed."""
        session = self.store.get_active_session(tracker_id)
        if session is None:
            raise HomeAssistantError(f"Tracker {tracker_id} has no active session")
        if session.paused_at is not None:
            raise HomeAssistantError("Session is already paused")

        now = dt_util.utcnow()
        event = SleepEvent(
            timestamp=now.isoformat(),
            event_type=EVENT_PAUSE,
            source=source,
            automation_id=automation_id,
            automation_trigger_id=automation_trigger_id,
        )
        session.events.append(event)
        self.store.update_session(
            session.session_id,
            events=session.events,
            paused_at=now.isoformat(),
        )

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_SESSION_PAUSED,
            {"tracker_id": tracker_id, "session_id": session.session_id},
        )

        _LOGGER.info(
            "Sleep session paused for tracker %s (source: %s)", tracker_id, source
        )
        return self._session_to_dict(session)

    async def async_reopen_session(self, tracker_id: str, session_id: str) -> dict:
        """Reopen a stopped session by clearing ended_at and phases.

        Allows new events to be appended again. Errors if the session is
        finalized.
        """
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.is_active:
            raise HomeAssistantError("Session is already active")
        if session.finalized:
            raise HomeAssistantError("Cannot reopen a finalized session")

        # Block reopen if there's already an active session for this tracker
        active = self.store.get_active_session(tracker_id)
        if active is not None:
            raise HomeAssistantError(
                f"Tracker {tracker_id} already has an active session: {active.session_id}"
            )

        # Block reopen if there's a newer session (would violate chronological order)
        session_started = datetime.fromisoformat(session.started_at)
        for other in self.store.sessions.values():
            if other.tracker_id != tracker_id or other.session_id == session_id:
                continue
            try:
                other_started = datetime.fromisoformat(other.started_at)
            except ValueError:
                continue
            if other_started > session_started:
                raise HomeAssistantError("Cannot resume: a newer session exists")

        self.store.update_session(session_id, ended_at=None, phases=None)
        # Clear any phase edit history for this session
        self._edit_history.pop(session_id, None)

        self._notify_listeners(tracker_id)
        _LOGGER.info(
            "Sleep session %s reopened for tracker %s", session_id, tracker_id
        )
        return self._session_to_dict(session)

    async def async_revert_to_event_review(
        self, tracker_id: str, session_id: str
    ) -> dict:
        """Clear materialized phases on a completed session, returning it to event-review state.

        Keeps ended_at intact (unlike reopen). Errors if finalized or active.
        """
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.finalized:
            raise HomeAssistantError("Cannot revert a finalized session")
        if session.is_active:
            raise HomeAssistantError("Session is not completed")
        if session.phases is None:
            raise HomeAssistantError("Session has no materialized phases")

        self.store.update_session(session_id, phases=None)
        self._edit_history.pop(session_id, None)

        self._notify_listeners(tracker_id)
        _LOGGER.info(
            "Session %s reverted to event review for tracker %s",
            session_id, tracker_id,
        )
        return self._session_to_dict(session)

    async def async_event(
        self,
        tracker_id: str,
        event_type: str,
        source: str,
        automation_id: str | None = None,
        automation_trigger_id: str | None = None,
    ) -> dict:
        """Record an event in the active session.

        For "awake" events: if the tracker is currently in the awake state (still
        in the initial onset/latency window or in a previous awake window), the
        event is auto-demoted to "still_awake" - you can't wake up if you
        haven't fallen asleep yet.

        Stopped sessions reject events.
        """
        if event_type not in USER_EVENT_TYPES:
            raise HomeAssistantError(f"Invalid event type: {event_type}")

        session = self.store.get_active_session(tracker_id)
        if session is None:
            raise HomeAssistantError(
                f"Tracker {tracker_id} has no active session - events are rejected on stopped sessions"
            )
        if session.paused_at is not None:
            raise HomeAssistantError("Cannot record events while session is paused")

        now = dt_util.utcnow()

        # Auto-demote awake -> still_awake when currently awake OR within the
        # awakening-grace window after the latency-based fall-asleep.
        if event_type == EVENT_AWAKE:
            params = self._get_tracker_timeline_params(tracker_id)
            config = self.store.get_tracker_config(tracker_id)
            grace = config.awakening_grace_minutes if config else 0
            phases = materialize_phases(
                session.started_at, None, session.events, **params, now=now
            )
            if phases:
                last = phases[-1]
                if last.state == PHASE_AWAKE:
                    event_type = EVENT_STILL_AWAKE
                elif grace > 0:
                    asleep_at = datetime.fromisoformat(last.start)
                    if (now - asleep_at) <= timedelta(minutes=grace):
                        event_type = EVENT_STILL_AWAKE
            if event_type == EVENT_STILL_AWAKE:
                _LOGGER.debug(
                    "Auto-demoted awake event to still_awake for tracker %s",
                    tracker_id,
                )

        event = SleepEvent(
            timestamp=now.isoformat(),
            event_type=event_type,
            source=source,
            automation_id=automation_id,
            automation_trigger_id=automation_trigger_id,
        )
        session.events.append(event)
        self.store.update_session(session.session_id, events=session.events)

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_EVENT,
            {
                "tracker_id": tracker_id,
                "session_id": session.session_id,
                "event_type": event_type,
                "source": source,
            },
        )

        _LOGGER.debug(
            "Event %s recorded for tracker %s (source: %s)",
            event_type, tracker_id, source,
        )
        return self._session_to_dict(session)

    async def async_custom_event(
        self,
        tracker_id: str,
        custom_event_id: str,
        source: str,
        automation_id: str | None = None,
        automation_trigger_id: str | None = None,
    ) -> dict:
        """Record a custom event in the active session.

        Unlike pulse events, custom events are also allowed while paused -
        they're just user-marked timeline annotations. Stopped sessions reject.
        If the custom event has an associated tag, it's auto-applied to the
        session's tags (deduped).
        """
        config = self.store.get_tracker_config(tracker_id)
        if config is None:
            raise HomeAssistantError(f"Tracker {tracker_id} is not set up")

        custom = next(
            (c for c in config.custom_events if c.id == custom_event_id), None
        )
        if custom is None:
            raise HomeAssistantError(f"Unknown custom event: {custom_event_id}")

        session = self.store.get_active_session(tracker_id)
        if session is None:
            raise HomeAssistantError(
                f"Tracker {tracker_id} has no active session - events are rejected on stopped sessions"
            )

        now = dt_util.utcnow()
        event = SleepEvent(
            timestamp=now.isoformat(),
            event_type=EVENT_CUSTOM,
            source=source,
            custom_event_id=custom_event_id,
            automation_id=automation_id,
            automation_trigger_id=automation_trigger_id,
        )
        session.events.append(event)

        # Auto-apply the tag, if any (dedupe).
        tag_applied = False
        if custom.tag and custom.tag not in session.tags:
            session.tags = session.tags + [custom.tag]
            tag_applied = True

        updates: dict[str, Any] = {"events": session.events}
        if tag_applied:
            updates["tags"] = session.tags
        self.store.update_session(session.session_id, **updates)

        # Propagate the new tag to the available_tags palette.
        if tag_applied and custom.tag not in config.available_tags:
            config.available_tags = config.available_tags + [custom.tag]
            self.store.set_tracker_config(config)

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_EVENT,
            {
                "tracker_id": tracker_id,
                "session_id": session.session_id,
                "event_type": EVENT_CUSTOM,
                "custom_event_id": custom_event_id,
                "source": source,
            },
        )

        _LOGGER.debug(
            "Custom event %s recorded for tracker %s (source: %s)",
            custom_event_id, tracker_id, source,
        )
        return self._session_to_dict(session)

    def get_current_phase_state(self, tracker_id: str) -> str:
        """Return the tracker's current phase: "awake" or "asleep".

        "awake" when: no active session, session is paused, or the live
        materialized phase is awake. "asleep" only during an active
        (non-paused) session where the current phase is asleep.
        """
        session = self.store.get_active_session(tracker_id)
        if session is None or session.paused_at is not None:
            return PHASE_AWAKE

        params = self._get_tracker_timeline_params(tracker_id)
        phases = materialize_phases(
            session.started_at,
            None,
            session.events,
            **params,
            now=dt_util.utcnow(),
        )
        if phases and phases[-1].state == PHASE_ASLEEP:
            return PHASE_ASLEEP
        return PHASE_AWAKE

    def get_next_phase_transition(self, tracker_id: str) -> datetime | None:
        """Return the UTC time of the next time-based phase transition, or None.

        For an active, non-paused session, materialize phases far into the
        future and find the first transition strictly after now. This is the
        moment the latency timer would flip the phase awake → asleep without
        any new event. PhaseSensor uses this to schedule a self-update so its
        state stops being stale between events.
        """
        session = self.store.get_active_session(tracker_id)
        if session is None or session.paused_at is not None:
            return None

        now = dt_util.utcnow()
        far_future = now + timedelta(days=365)
        params = self._get_tracker_timeline_params(tracker_id)
        phases = materialize_phases(
            session.started_at,
            None,
            session.events,
            **params,
            now=far_future,
        )
        for phase in phases:
            start = datetime.fromisoformat(phase.start)
            if start > now:
                return start
        return None

    # --- Session completion (event review → phase editing) ---

    async def async_complete_session(
        self, tracker_id: str, session_id: str
    ) -> dict:
        """Complete event review: materialize phases from events.

        Session must be stopped (ended_at set) with no stored phases yet.
        """
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.is_active:
            raise HomeAssistantError("Cannot complete an active session - stop it first")
        if session.phases is not None:
            raise HomeAssistantError("Session already has materialized phases")

        params = self._get_tracker_timeline_params(tracker_id)
        materialized = materialize_phases(
            session.started_at, session.ended_at, session.events, **params
        )
        self.store.update_session(session_id, phases=materialized)

        self._notify_listeners(tracker_id)
        _LOGGER.info(
            "Session %s completed (phases materialized) for tracker %s",
            session_id, tracker_id,
        )

        # Auto-finalize if tracker has skip setting enabled
        config = self.store.get_tracker_config(tracker_id)
        if config and config.skip_phase_review:
            return await self.async_finalize_session(tracker_id, session_id)

        return self._session_to_dict(session)

    # --- Event editing (only for stopped sessions without materialized phases) ---

    def _get_event_editable_session(
        self, tracker_id: str, session_id: str
    ) -> SleepSession:
        """Get a session whose events can be edited (stopped, no phases, not finalized)."""
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.is_active:
            raise HomeAssistantError("Cannot edit events on an active session")
        if session.phases is not None:
            raise HomeAssistantError("Events are locked after phase materialization")
        if session.finalized:
            raise HomeAssistantError("Cannot edit a finalized session")
        return session

    async def async_edit_event(
        self, tracker_id: str, session_id: str, event_index: int, new_event_type: str
    ) -> dict:
        """Change the type of an event during event review."""
        if new_event_type not in USER_EVENT_TYPES:
            raise HomeAssistantError(f"Invalid event type: {new_event_type}")
        session = self._get_event_editable_session(tracker_id, session_id)
        if event_index < 0 or event_index >= len(session.events):
            raise HomeAssistantError(f"Invalid event index: {event_index}")
        # Don't allow editing pause/resume events
        if session.events[event_index].event_type in (EVENT_PAUSE, EVENT_RESUME):
            raise HomeAssistantError("Cannot edit pause/resume events")

        session.events[event_index].event_type = new_event_type
        self.store.update_session(session_id, events=session.events)
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    async def async_delete_event(
        self, tracker_id: str, session_id: str, event_index: int
    ) -> dict:
        """Delete an event during event review."""
        session = self._get_event_editable_session(tracker_id, session_id)
        if event_index < 0 or event_index >= len(session.events):
            raise HomeAssistantError(f"Invalid event index: {event_index}")

        session.events.pop(event_index)
        self.store.update_session(session_id, events=session.events)
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    # --- Session deletion ---

    async def async_delete_session(self, tracker_id: str, session_id: str) -> None:
        """Delete any session (active, stopped, finalized)."""
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")

        self._edit_history.pop(session_id, None)
        self.store.delete_session(session_id)

        self._notify_listeners(tracker_id)
        _LOGGER.info("Session %s deleted for tracker %s", session_id, tracker_id)

    # --- Session metadata (note, ratings, tags) ---

    async def async_update_session_meta(
        self, tracker_id: str, session_id: str, **kwargs: Any
    ) -> dict:
        """Update session metadata (note, ratings, tags).

        Blocked on finalized sessions - unfinalize first to edit.
        """
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.finalized:
            raise HomeAssistantError("Cannot edit a finalized session")

        allowed = {"note", "rating_quality", "rating_feeling", "tags"}
        updates = {}
        for key, value in kwargs.items():
            if key not in allowed:
                continue
            if key in ("rating_quality", "rating_feeling"):
                if value is not None and (not isinstance(value, int) or value < 1 or value > 5):
                    raise HomeAssistantError(f"{key} must be 1-5 or null")
            updates[key] = value

        if updates:
            self.store.update_session(session_id, **updates)

        # Auto-add new tags to the tracker's available_tags palette
        if "tags" in updates:
            config = self.store.get_tracker_config(tracker_id)
            if config:
                new_tags = set(updates["tags"]) - set(config.available_tags)
                if new_tags:
                    config.available_tags = config.available_tags + sorted(new_tags)
                    self.store.set_tracker_config(config)

        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    def get_tag_usage(self, tracker_id: str) -> dict[str, int]:
        """Count how many sessions use each tag for a tracker."""
        usage: dict[str, int] = {}
        for s in self.store.sessions.values():
            if s.tracker_id != tracker_id:
                continue
            for tag in s.tags:
                usage[tag] = usage.get(tag, 0) + 1
        return usage

    # --- Phase editing (only for stopped, non-finalized sessions) ---

    def _push_edit_history(self, session: SleepSession) -> None:
        """Snapshot current phases and ended_at for undo."""
        if session.phases is None:
            return
        history = self._edit_history.setdefault(session.session_id, [])
        phases = [SleepPhase(p.start, p.end, p.state) for p in session.phases]
        history.append(PhaseSnapshot(phases=phases, ended_at=session.ended_at))
        if len(history) > self._max_history:
            history.pop(0)

    def _get_editable_session(
        self, tracker_id: str, session_id: str
    ) -> SleepSession:
        """Get a session that can be edited (stopped, not finalized, owned)."""
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.is_active:
            raise HomeAssistantError("Cannot edit an active session")
        if session.finalized:
            raise HomeAssistantError("Cannot edit a finalized session")
        if session.phases is None:
            raise HomeAssistantError("Session has no materialized phases")
        return session

    async def async_delete_phase(
        self, tracker_id: str, session_id: str, phase_index: int
    ) -> dict:
        """Delete a phase. Bipartite invariant is preserved by collapsing
        same-state neighbors that result from the deletion."""
        session = self._get_editable_session(tracker_id, session_id)
        assert session.phases is not None
        assert session.ended_at is not None

        new_phases = delete_phase(
            session.phases, phase_index, session.started_at, session.ended_at
        )
        self._push_edit_history(session)
        self.store.update_session(session_id, phases=new_phases)
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    async def async_split_phase(
        self,
        tracker_id: str,
        session_id: str,
        phase_index: int,
        at_timestamp: str,
        wedge_minutes: float = 1.0,
    ) -> dict:
        """Split a phase by inserting an opposite-state wedge."""
        session = self._get_editable_session(tracker_id, session_id)
        assert session.phases is not None

        new_phases = split_phase(
            session.phases, phase_index, at_timestamp, wedge_minutes
        )
        self._push_edit_history(session)
        self.store.update_session(session_id, phases=new_phases)
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    async def async_adjust_phase_boundary(
        self,
        tracker_id: str,
        session_id: str,
        after_index: int,
        new_time: str,
    ) -> dict:
        """Move the boundary that comes after phase[after_index]."""
        session = self._get_editable_session(tracker_id, session_id)
        assert session.phases is not None

        # Detect no-op
        if (
            0 <= after_index < len(session.phases) - 1
            and session.phases[after_index].end == new_time
        ):
            return self._session_to_dict(session)

        new_phases = adjust_phase_boundary(session.phases, after_index, new_time)
        self._push_edit_history(session)
        self.store.update_session(session_id, phases=new_phases)
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    async def async_append_phase(
        self,
        tracker_id: str,
        session_id: str,
        state: str,
        end_timestamp: str,
    ) -> dict:
        """Append a new phase at the end, extending session.ended_at."""
        session = self._get_editable_session(tracker_id, session_id)
        assert session.phases is not None

        new_phases = append_phase(session.phases, state, end_timestamp)
        self._push_edit_history(session)
        self.store.update_session(
            session_id, phases=new_phases, ended_at=end_timestamp
        )
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    async def async_undo_edit(self, tracker_id: str, session_id: str) -> dict:
        """Undo the most recent phase edit on a session."""
        session = self._get_editable_session(tracker_id, session_id)
        history = self._edit_history.get(session_id, [])
        if not history:
            raise HomeAssistantError("Nothing to undo")

        snapshot = history.pop()
        self.store.update_session(
            session_id, phases=snapshot.phases, ended_at=snapshot.ended_at
        )
        self._notify_listeners(tracker_id)
        return self._session_to_dict(session)

    def get_edit_history_count(self, session_id: str) -> int:
        """Get the number of undoable edits for a session."""
        return len(self._edit_history.get(session_id, []))

    # --- Finalization ---

    async def async_finalize_session(
        self, tracker_id: str, session_id: str
    ) -> dict:
        """Finalize a session: mark as final, export if configured."""
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if session.is_active:
            raise HomeAssistantError("Cannot finalize an active session")
        if session.finalized:
            raise HomeAssistantError("Session is already finalized")

        self.store.update_session(
            session_id, finalized=True, revision=session.revision + 1
        )
        self._edit_history.pop(session_id, None)

        config = self.store.get_tracker_config(tracker_id)
        if config and config.export_url:
            try:
                from .export import async_export_session
                await async_export_session(
                    self.hass, self, session_id, raise_if_changed=False
                )
                _LOGGER.info("Session %s auto-exported on finalization", session_id)
            except Exception:
                _LOGGER.exception("Auto-export failed for session %s", session_id)

        self._notify_listeners(tracker_id)
        self.hass.bus.async_fire(
            BUS_EVENT_SESSION_FINALIZED,
            {"tracker_id": tracker_id, "session_id": session_id},
        )
        return self._session_to_dict(session)

    @callback
    def async_set_exported(
        self, session_id: str, exported: bool, revision: int | None = None
    ) -> None:
        """Set the exported flag of a session and notify listeners.

        Only a finalized session can be marked exported; clearing the flag is
        always allowed. Active sessions are rejected. When `revision` is given
        and exported is true, it must equal the session's current revision, so
        a delivery of an older finalization cannot mark a re-finalized session.
        """
        session = self.store.get_session(session_id)
        if session is None:
            raise HomeAssistantError(f"Session {session_id} not found")
        if session.is_active:
            raise HomeAssistantError("Session is still active")
        if exported and not session.finalized:
            raise HomeAssistantError("Session is not finalized")
        if exported and revision is not None and revision != session.revision:
            raise HomeAssistantError(
                f"Session revision is {session.revision}, not {revision}"
            )
        self.store.update_session(session_id, exported=exported)
        self._notify_listeners(session.tracker_id)

    async def async_unfinalize_session(
        self, tracker_id: str, session_id: str
    ) -> dict:
        """Unfinalize a session - escape hatch to edit metadata/phases again."""
        session = self.store.get_session(session_id)
        if session is None or session.tracker_id != tracker_id:
            raise HomeAssistantError("Session not found")
        if not session.finalized:
            raise HomeAssistantError("Session is not finalized")

        self.store.update_session(session_id, finalized=False, exported=False)
        self._notify_listeners(tracker_id)
        _LOGGER.info(
            "Session %s unfinalized for tracker %s", session_id, tracker_id
        )
        return self._session_to_dict(session)

    async def _async_auto_finalize(self, tracker_id: str) -> None:
        """Auto-finalize all unfinalized completed sessions for a tracker."""
        unfinalized = self.store.get_unfinalized_sessions(tracker_id)
        for session in unfinalized:
            try:
                await self.async_finalize_session(tracker_id, session.session_id)
                _LOGGER.info(
                    "Auto-finalized session %s for tracker %s",
                    session.session_id, tracker_id,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed to auto-finalize session %s", session.session_id
                )

    # --- State queries ---

    def get_tracker_state(self, tracker_id: str) -> dict:
        """Get the current state for a tracker (for panel/WS)."""
        config = self.store.get_tracker_config(tracker_id)
        active_session = self.store.get_active_session(tracker_id)

        result: dict[str, Any] = {
            "config": config.to_dict() if config else None,
            "active_session": (
                self._session_to_dict(active_session) if active_session else None
            ),
        }

        if not active_session and config:
            history = self.store.get_tracker_sessions(tracker_id, limit=1)
            result["last_session"] = (
                self._session_to_dict(history[0]) if history else None
            )
            unfinalized = self.store.get_unfinalized_sessions(tracker_id)
            result["unfinalized_sessions"] = [
                self._session_to_dict(s) for s in unfinalized
            ]

        return result

    def get_tracker_history(
        self, tracker_id: str, limit: int = 20, offset: int = 0
    ) -> list[dict]:
        """Get past sessions for a tracker."""
        sessions = self.store.get_tracker_sessions(tracker_id, limit, offset)
        return [self._session_to_dict(s) for s in sessions]

    async def async_export_tracker_data(
        self,
        tracker_id: str,
        start_date: str | None = None,
        end_date: str | None = None,
        include_environment: bool = False,
    ) -> dict:
        """Export all sessions for a tracker within an optional date range.

        start_date / end_date are ISO strings compared against session.started_at
        lexicographically (both are ISO, so lex-order == chronological). Returns
        all completed or finalized sessions - active sessions are excluded.

        When include_environment is True, attaches an "environment_history" map
        (entity_id -> list of state changes) for each session, scoped to the
        session's [started_at, ended_at] window and limited to the tracker's
        configured environment_entities.
        """
        sessions: list[SleepSession] = []
        for s in self.store.sessions.values():
            if s.tracker_id != tracker_id or s.is_active:
                continue
            if start_date and s.started_at < start_date:
                continue
            if end_date and s.started_at > end_date:
                continue
            sessions.append(s)
        sessions.sort(key=lambda s: s.started_at)

        config = self.store.get_tracker_config(tracker_id)
        attach_env = (
            include_environment
            and config is not None
            and bool(config.environment_entities)
        )

        session_dicts: list[dict] = []
        for s in sessions:
            d = self._session_to_dict(s)
            if attach_env and s.ended_at:
                try:
                    from .history_helper import async_get_state_history

                    start_dt = datetime.fromisoformat(s.started_at)
                    end_dt = datetime.fromisoformat(s.ended_at)
                    d["environment_history"] = await async_get_state_history(
                        self.hass,
                        config.environment_entities,
                        start_dt,
                        end_dt,
                    )
                except Exception:  # noqa: BLE001
                    _LOGGER.exception(
                        "Failed to fetch environment history for session %s",
                        s.session_id,
                    )
                    d["environment_history"] = {}
            session_dicts.append(d)

        return {
            "sessions": session_dicts,
            "count": len(sessions),
            "exported_at": dt_util.utcnow().isoformat(),
        }

    def get_session_detail(self, session_id: str) -> dict | None:
        """Get full session detail with computed phases and stats."""
        session = self.store.get_session(session_id)
        if session is None:
            return None
        return self._session_to_dict(session)

    # --- Aggregate stats ---

    def get_tracker_stats(self, tracker_id: str, days: int = 30) -> dict:
        """Get aggregated sleep statistics over a period."""
        cutoff_dt = dt_util.utcnow() - timedelta(days=days)

        sessions: list[SleepSession] = []
        for s in self.store.sessions.values():
            if s.tracker_id != tracker_id or s.is_active or not s.ended_at:
                continue
            try:
                started = datetime.fromisoformat(s.started_at)
            except ValueError:
                _LOGGER.debug(
                    "Skipping session %s: unparseable started_at %r",
                    s.session_id, s.started_at,
                )
                continue
            if started.tzinfo is None:
                started = started.replace(tzinfo=cutoff_dt.tzinfo)
            if started >= cutoff_dt:
                sessions.append(s)
        sessions.sort(key=lambda s: s.started_at)

        params = self._get_tracker_timeline_params(tracker_id)
        daily: list[dict] = []

        for session in sessions:
            phases = session.phases if session.phases is not None else materialize_phases(
                session.started_at, session.ended_at, session.events, **params
            )
            stats = compute_stats(phases, session.started_at, session.ended_at)
            daily.append({
                "session_id": session.session_id,
                "date": session.started_at[:10],
                "started_at": session.started_at,
                "ended_at": session.ended_at,
                **stats,
            })

        n = len(daily)
        if n > 0:
            avg_sleep = sum(d["total_sleep_minutes"] for d in daily) / n
            avg_efficiency = sum(d["sleep_efficiency"] for d in daily) / n
            avg_awakenings = sum(d["awakenings"] for d in daily) / n
            avg_time_to_sleep = sum(d["time_to_fall_asleep_minutes"] for d in daily) / n
            avg_sleep_period = sum(d["sleep_period_minutes"] for d in daily) / n
            avg_time_before_up = sum(d["time_before_getting_up_minutes"] for d in daily) / n
        else:
            avg_sleep = avg_efficiency = avg_awakenings = avg_time_to_sleep = 0
            avg_sleep_period = avg_time_before_up = 0

        return {
            "days": days,
            "session_count": n,
            "daily": daily,
            "averages": {
                "total_sleep_minutes": round(avg_sleep, 1),
                "sleep_period_minutes": round(avg_sleep_period, 1),
                "sleep_efficiency": round(avg_efficiency, 3),
                "awakenings": round(avg_awakenings, 1),
                "time_to_fall_asleep_minutes": round(avg_time_to_sleep, 1),
                "time_before_getting_up_minutes": round(avg_time_before_up, 1),
            },
        }

    # --- Helpers ---

    def _get_tracker_timeline_params(self, tracker_id: str) -> dict:
        """Get phase materialization parameters for a tracker."""
        config = self.store.get_tracker_config(tracker_id)
        return {
            "fall_asleep_latency_minutes": config.fall_asleep_latency_minutes if config else 15,
            "sleep_onset_minutes": config.sleep_onset_minutes if config else 0,
        }

    def _session_to_dict(self, session: SleepSession) -> dict:
        """Convert session to dict with phases and stats.

        For active sessions or sessions without stored phases, materialize
        on-the-fly. For stopped sessions with stored phases, use those directly.
        """
        if session.phases is not None:
            phases = session.phases
        else:
            params = self._get_tracker_timeline_params(session.tracker_id)
            phases = materialize_phases(
                session.started_at,
                session.ended_at,
                session.events,
                **params,
            )

        result = session.to_dict()
        result["status"] = session.status
        result["phases"] = [p.to_dict() for p in phases]
        result["undo_count"] = self.get_edit_history_count(session.session_id)

        if session.ended_at:
            result["stats"] = compute_stats(
                phases, session.started_at, session.ended_at
            )
        else:
            result["stats"] = None

        return result

    def get_session_stats(self, session: SleepSession) -> dict | None:
        """Public helper for entities: return stats for a session, or None if active."""
        if session.ended_at is None:
            return None
        if session.phases is not None:
            phases = session.phases
        else:
            params = self._get_tracker_timeline_params(session.tracker_id)
            phases = materialize_phases(
                session.started_at,
                session.ended_at,
                session.events,
                **params,
            )
        return compute_stats(phases, session.started_at, session.ended_at)
