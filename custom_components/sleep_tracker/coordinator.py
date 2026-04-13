"""Coordinator for Sleep Tracker integration.

Manages sleep sessions, event processing, phase materialization, entity
notification, and state queries. Entirely event-driven (no tick loop).

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
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

from .const import (
    EVENT_AWAKE,
    EVENT_FELL_ASLEEP,
    EVENT_STILL_AWAKE,
    EVENT_TYPES,
    PHASE_AWAKE,
)
from .models import SleepEvent, SleepPhase, SleepSession
from .phases import (
    adjust_phase_boundary,
    compute_stats,
    delete_phase,
    materialize_phases,
    split_phase,
)
from .store import SleepTrackerStore

_LOGGER = logging.getLogger(__name__)


class SleepTrackerCoordinator:
    """Brain of the sleep tracker — session management and state queries."""

    def __init__(self, hass: HomeAssistant, store: SleepTrackerStore) -> None:
        self.hass = hass
        self.store = store
        self._listeners: list[Callable[[], None]] = []
        self._user_listeners: dict[str, list[Callable[[], None]]] = {}
        # In-memory edit history for undo: session_id -> list of phase snapshots
        self._edit_history: dict[str, list[list[SleepPhase]]] = {}
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
    def add_user_listener(
        self, user_id: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Add a per-user listener. Returns unsubscribe function."""
        self._user_listeners.setdefault(user_id, []).append(listener)

        @callback
        def remove() -> None:
            listeners = self._user_listeners.get(user_id, [])
            if listener in listeners:
                listeners.remove(listener)

        return remove

    @callback
    def _notify_listeners(self, user_id: str) -> None:
        """Notify global and user-specific listeners."""
        for listener in self._listeners:
            listener()
        for listener in self._user_listeners.get(user_id, []):
            listener()

    # --- User management ---

    async def async_setup_user(
        self, user_id: str, display_name: str, **kwargs: Any
    ) -> dict:
        """Set up sleep tracking for a user. Creates entities dynamically."""
        from .models import UserConfig

        config = UserConfig(
            user_id=user_id,
            display_name=display_name,
            **kwargs,
        )
        self.store.set_user_config(config)

        await self._async_create_user_entities(user_id)

        self._notify_listeners(user_id)
        return config.to_dict()

    async def async_update_user_config(self, user_id: str, **kwargs: Any) -> dict:
        """Update user configuration."""
        config = self.store.get_user_config(user_id)
        if config is None:
            raise ValueError(f"User {user_id} is not set up")

        for key, value in kwargs.items():
            if hasattr(config, key) and key != "user_id":
                setattr(config, key, value)

        self.store.set_user_config(config)
        self._notify_listeners(user_id)
        return config.to_dict()

    async def _async_create_user_entities(self, user_id: str) -> None:
        """Create sensor/binary_sensor entities for a newly set up user."""
        from .binary_sensor import create_user_binary_sensors
        from .sensor import create_user_sensors

        add_sensors = self.hass.data.get("sleep_tracker", {}).get(
            "async_add_sensor_entities"
        )
        add_binary = self.hass.data.get("sleep_tracker", {}).get(
            "async_add_binary_sensor_entities"
        )

        if add_sensors:
            add_sensors(create_user_sensors(self, user_id))
        if add_binary:
            add_binary(create_user_binary_sensors(self, user_id))

    # --- Session management ---

    async def async_start_sleep(
        self, user_id: str, source: str = "manual"
    ) -> dict:
        """Start a new sleep session. Auto-finalizes any pending sessions first."""
        config = self.store.get_user_config(user_id)
        if config is None:
            raise ValueError(f"User {user_id} is not set up for sleep tracking")

        active = self.store.get_active_session(user_id)
        if active is not None:
            raise ValueError(
                f"User {user_id} already has an active session: {active.session_id}"
            )

        # Auto-finalize any unfinalized sessions
        await self._async_auto_finalize(user_id)

        session = SleepSession(
            session_id=str(uuid.uuid4()),
            user_id=user_id,
            started_at=dt_util.now().isoformat(),
        )
        self.store.add_session(session)

        purged = self.store.purge_old_sessions(user_id, config.retention_days)
        if purged:
            _LOGGER.debug("Purged %d old sessions for user %s", purged, user_id)

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_session_started",
            {"user_id": user_id, "session_id": session.session_id},
        )

        _LOGGER.info("Sleep session started for user %s (source: %s)", user_id, source)
        return self._session_to_dict(session)

    async def async_stop_sleep(
        self, user_id: str, source: str = "manual"
    ) -> dict:
        """Stop the active sleep session. Materializes phases and stores them."""
        session = self.store.get_active_session(user_id)
        if session is None:
            raise ValueError(f"User {user_id} has no active session")

        ended_at = dt_util.now().isoformat()
        params = self._get_user_timeline_params(user_id)
        materialized = materialize_phases(
            session.started_at, ended_at, session.events, **params
        )
        self.store.update_session(
            session.session_id, ended_at=ended_at, phases=materialized
        )

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_session_ended",
            {"user_id": user_id, "session_id": session.session_id},
        )

        _LOGGER.info("Sleep session ended for user %s (source: %s)", user_id, source)
        return self._session_to_dict(session)

    async def async_reopen_session(self, user_id: str, session_id: str) -> dict:
        """Reopen a stopped session by clearing ended_at and phases.

        Allows new events to be appended again. Errors if the session is
        finalized.
        """
        session = self.store.get_session(session_id)
        if session is None or session.user_id != user_id:
            raise ValueError("Session not found")
        if session.is_active:
            raise ValueError("Session is already active")
        if session.finalized:
            raise ValueError("Cannot reopen a finalized session")

        # Block reopen if there's already an active session for this user
        active = self.store.get_active_session(user_id)
        if active is not None:
            raise ValueError(
                f"User {user_id} already has an active session: {active.session_id}"
            )

        self.store.update_session(session_id, ended_at=None, phases=None)
        # Clear any phase edit history for this session
        self._edit_history.pop(session_id, None)

        self._notify_listeners(user_id)
        _LOGGER.info("Sleep session %s reopened for user %s", session_id, user_id)
        return self._session_to_dict(session)

    async def async_event(
        self, user_id: str, event_type: str, source: str = "manual"
    ) -> dict:
        """Record an event in the active session.

        For "awake" events: if the user is currently in the awake state (still
        in the initial onset/latency window or in a previous awake window), the
        event is auto-demoted to "still_awake" — you can't wake up if you
        haven't fallen asleep yet.

        Stopped sessions reject events.
        """
        if event_type not in EVENT_TYPES:
            raise ValueError(f"Invalid event type: {event_type}")

        session = self.store.get_active_session(user_id)
        if session is None:
            raise ValueError(
                f"User {user_id} has no active session — events are rejected on stopped sessions"
            )

        now = dt_util.now()

        # Auto-demote awake -> still_awake when currently awake
        if event_type == EVENT_AWAKE:
            params = self._get_user_timeline_params(user_id)
            phases = materialize_phases(
                session.started_at, None, session.events, **params, now=now
            )
            if phases and phases[-1].state == PHASE_AWAKE:
                event_type = EVENT_STILL_AWAKE
                _LOGGER.debug(
                    "Auto-demoted awake event to still_awake for user %s", user_id
                )

        event = SleepEvent(
            timestamp=now.isoformat(),
            event_type=event_type,
            source=source,
        )
        session.events.append(event)
        self.store.update_session(session.session_id, events=session.events)

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_event",
            {
                "user_id": user_id,
                "session_id": session.session_id,
                "event_type": event_type,
                "source": source,
            },
        )

        _LOGGER.debug(
            "Event %s recorded for user %s (source: %s)",
            event_type, user_id, source,
        )
        return self._session_to_dict(session)

    # --- Session deletion ---

    async def async_delete_session(self, user_id: str, session_id: str) -> None:
        """Delete any session (active, stopped, finalized)."""
        session = self.store.get_session(session_id)
        if session is None or session.user_id != user_id:
            raise ValueError("Session not found")

        self._edit_history.pop(session_id, None)
        self.store.delete_session(session_id)

        self._notify_listeners(user_id)
        _LOGGER.info("Session %s deleted for user %s", session_id, user_id)

    # --- Phase editing (only for stopped, non-finalized sessions) ---

    def _push_edit_history(self, session: SleepSession) -> None:
        """Snapshot current phases for undo."""
        if session.phases is None:
            return
        history = self._edit_history.setdefault(session.session_id, [])
        snapshot = [SleepPhase(p.start, p.end, p.state) for p in session.phases]
        history.append(snapshot)
        if len(history) > self._max_history:
            history.pop(0)

    def _get_editable_session(
        self, user_id: str, session_id: str
    ) -> SleepSession:
        """Get a session that can be edited (stopped, not finalized, owned)."""
        session = self.store.get_session(session_id)
        if session is None or session.user_id != user_id:
            raise ValueError("Session not found")
        if session.is_active:
            raise ValueError("Cannot edit an active session")
        if session.finalized:
            raise ValueError("Cannot edit a finalized session")
        if session.phases is None:
            raise ValueError("Session has no materialized phases")
        return session

    async def async_delete_phase(
        self, user_id: str, session_id: str, phase_index: int
    ) -> dict:
        """Delete a phase. Bipartite invariant is preserved by collapsing
        same-state neighbors that result from the deletion."""
        session = self._get_editable_session(user_id, session_id)
        assert session.phases is not None
        assert session.ended_at is not None

        new_phases = delete_phase(
            session.phases, phase_index, session.started_at, session.ended_at
        )
        self._push_edit_history(session)
        self.store.update_session(session_id, phases=new_phases)
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    async def async_split_phase(
        self,
        user_id: str,
        session_id: str,
        phase_index: int,
        at_timestamp: str,
        wedge_minutes: float = 1.0,
    ) -> dict:
        """Split a phase by inserting an opposite-state wedge."""
        session = self._get_editable_session(user_id, session_id)
        assert session.phases is not None

        new_phases = split_phase(
            session.phases, phase_index, at_timestamp, wedge_minutes
        )
        self._push_edit_history(session)
        self.store.update_session(session_id, phases=new_phases)
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    async def async_adjust_phase_boundary(
        self,
        user_id: str,
        session_id: str,
        after_index: int,
        new_time: str,
    ) -> dict:
        """Move the boundary that comes after phase[after_index]."""
        session = self._get_editable_session(user_id, session_id)
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
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    async def async_undo_edit(self, user_id: str, session_id: str) -> dict:
        """Undo the most recent phase edit on a session."""
        session = self._get_editable_session(user_id, session_id)
        history = self._edit_history.get(session_id, [])
        if not history:
            raise ValueError("Nothing to undo")

        previous_phases = history.pop()
        self.store.update_session(session_id, phases=previous_phases)
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    def get_edit_history_count(self, session_id: str) -> int:
        """Get the number of undoable edits for a session."""
        return len(self._edit_history.get(session_id, []))

    # --- Finalization ---

    async def async_finalize_session(
        self, user_id: str, session_id: str
    ) -> dict:
        """Finalize a session: mark as final, export if configured."""
        session = self.store.get_session(session_id)
        if session is None or session.user_id != user_id:
            raise ValueError("Session not found")
        if session.is_active:
            raise ValueError("Cannot finalize an active session")
        if session.finalized:
            raise ValueError("Session is already finalized")

        self.store.update_session(session_id, finalized=True)
        self._edit_history.pop(session_id, None)

        config = self.store.get_user_config(user_id)
        if config and config.export_url:
            try:
                from .export import async_export_session
                await async_export_session(self.hass, self, session_id)
                _LOGGER.info("Session %s auto-exported on finalization", session_id)
            except Exception:
                _LOGGER.exception("Auto-export failed for session %s", session_id)

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_session_finalized",
            {"user_id": user_id, "session_id": session_id},
        )
        return self._session_to_dict(session)

    async def _async_auto_finalize(self, user_id: str) -> None:
        """Auto-finalize all unfinalized completed sessions for a user."""
        unfinalized = self.store.get_unfinalized_sessions(user_id)
        for session in unfinalized:
            try:
                await self.async_finalize_session(user_id, session.session_id)
                _LOGGER.info(
                    "Auto-finalized session %s for user %s",
                    session.session_id, user_id,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed to auto-finalize session %s", session.session_id
                )

    # --- State queries ---

    def get_user_state(self, user_id: str) -> dict:
        """Get the current state for a user (for panel/WS)."""
        config = self.store.get_user_config(user_id)
        active_session = self.store.get_active_session(user_id)

        result: dict[str, Any] = {
            "config": config.to_dict() if config else None,
            "active_session": (
                self._session_to_dict(active_session) if active_session else None
            ),
        }

        if not active_session and config:
            history = self.store.get_user_sessions(user_id, limit=1)
            result["last_session"] = (
                self._session_to_dict(history[0]) if history else None
            )
            unfinalized = self.store.get_unfinalized_sessions(user_id)
            result["unfinalized_sessions"] = [
                self._session_to_dict(s) for s in unfinalized
            ]

        return result

    def get_user_history(
        self, user_id: str, limit: int = 20, offset: int = 0
    ) -> list[dict]:
        """Get past sessions for a user."""
        sessions = self.store.get_user_sessions(user_id, limit, offset)
        return [self._session_to_dict(s) for s in sessions]

    def get_session_detail(self, session_id: str) -> dict | None:
        """Get full session detail with computed phases and stats."""
        session = self.store.get_session(session_id)
        if session is None:
            return None
        return self._session_to_dict(session)

    # --- Aggregate stats ---

    def get_user_stats(self, user_id: str, days: int = 30) -> dict:
        """Get aggregated sleep statistics over a period."""
        cutoff_dt = dt_util.now() - timedelta(days=days)

        sessions: list[SleepSession] = []
        for s in self.store.sessions.values():
            if s.user_id != user_id or s.is_active or not s.ended_at:
                continue
            try:
                started = datetime.fromisoformat(s.started_at)
            except ValueError:
                continue
            if started.tzinfo is None:
                started = started.replace(tzinfo=cutoff_dt.tzinfo)
            if started >= cutoff_dt:
                sessions.append(s)
        sessions.sort(key=lambda s: s.started_at)

        params = self._get_user_timeline_params(user_id)
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

    def _get_user_timeline_params(self, user_id: str) -> dict:
        """Get phase materialization parameters for a user."""
        config = self.store.get_user_config(user_id)
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
            params = self._get_user_timeline_params(session.user_id)
            phases = materialize_phases(
                session.started_at,
                session.ended_at,
                session.events,
                **params,
            )

        result = session.to_dict()
        # Always include phases in the response (even if not stored), so the
        # frontend has a single rendering path.
        result["phases"] = [p.to_dict() for p in phases]
        result["undo_count"] = self.get_edit_history_count(session.session_id)

        if session.ended_at:
            result["stats"] = compute_stats(
                phases, session.started_at, session.ended_at
            )
        else:
            result["stats"] = None

        return result
