"""Coordinator for Sleep Tracker integration.

Manages sleep sessions, pulse processing, entity notification,
and state queries. Entirely event-driven (no tick loop).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback

from .const import PULSE_AWAKE, PULSE_STILL_AWAKE, PULSE_TYPES
from .models import SleepPulse, SleepSession
from .store import SleepTrackerStore
from .timeline import compute_intervals, compute_stats

_LOGGER = logging.getLogger(__name__)


class SleepTrackerCoordinator:
    """Brain of the sleep tracker — session management and state queries."""

    def __init__(self, hass: HomeAssistant, store: SleepTrackerStore) -> None:
        self.hass = hass
        self.store = store
        self._listeners: list[Callable[[], None]] = []
        self._user_listeners: dict[str, list[Callable[[], None]]] = {}

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

        # Create entities for this user
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
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        self.store.add_session(session)

        # Purge old sessions
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
        """Stop the active sleep session. Session remains editable until finalized."""
        session = self.store.get_active_session(user_id)
        if session is None:
            raise ValueError(f"User {user_id} has no active session")

        ended_at = datetime.now(timezone.utc).isoformat()
        self.store.update_session(session.session_id, ended_at=ended_at)

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_session_ended",
            {
                "user_id": user_id,
                "session_id": session.session_id,
            },
        )

        _LOGGER.info("Sleep session ended for user %s (source: %s)", user_id, source)
        return self._session_to_dict(session)

    async def async_pulse(
        self, user_id: str, pulse_type: str, source: str = "manual"
    ) -> dict:
        """Record a pulse in the active session."""
        if pulse_type not in PULSE_TYPES:
            raise ValueError(f"Invalid pulse type: {pulse_type}")

        session = self.store.get_active_session(user_id)
        if session is None:
            raise ValueError(f"User {user_id} has no active session")

        pulse = SleepPulse(
            timestamp=datetime.now(timezone.utc).isoformat(),
            pulse_type=pulse_type,
            source=source,
        )
        session.pulses.append(pulse)
        self.store.update_session(session.session_id, pulses=session.pulses)

        self._notify_listeners(user_id)
        self.hass.bus.async_fire(
            "sleep_tracker_pulse",
            {
                "user_id": user_id,
                "session_id": session.session_id,
                "pulse_type": pulse_type,
                "source": source,
            },
        )

        _LOGGER.debug(
            "Pulse %s recorded for user %s (source: %s)",
            pulse_type, user_id, source,
        )
        return self._session_to_dict(session)

    # --- Pulse editing (only for non-finalized, completed sessions) ---

    async def async_delete_pulse(
        self, user_id: str, session_id: str, pulse_index: int
    ) -> dict:
        """Delete a pulse from a session by index."""
        session = self._get_editable_session(user_id, session_id)

        if pulse_index < 0 or pulse_index >= len(session.pulses):
            raise ValueError(f"Invalid pulse index: {pulse_index}")

        session.pulses.pop(pulse_index)
        self.store.update_session(session_id, pulses=session.pulses)
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    async def async_swap_pulse_type(
        self, user_id: str, session_id: str, pulse_index: int
    ) -> dict:
        """Swap a pulse's type between awake and still_awake."""
        session = self._get_editable_session(user_id, session_id)

        if pulse_index < 0 or pulse_index >= len(session.pulses):
            raise ValueError(f"Invalid pulse index: {pulse_index}")

        pulse = session.pulses[pulse_index]
        pulse.pulse_type = (
            PULSE_STILL_AWAKE if pulse.pulse_type == PULSE_AWAKE else PULSE_AWAKE
        )
        self.store.update_session(session_id, pulses=session.pulses)
        self._notify_listeners(user_id)
        return self._session_to_dict(session)

    def _get_editable_session(
        self, user_id: str, session_id: str
    ) -> SleepSession:
        """Get a session that can be edited (completed, not finalized, owned)."""
        session = self.store.get_session(session_id)
        if session is None or session.user_id != user_id:
            raise ValueError("Session not found")
        if session.is_active:
            raise ValueError("Cannot edit an active session")
        if session.finalized:
            raise ValueError("Cannot edit a finalized session")
        return session

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

        # Auto-export if configured
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
            # Include last completed session and any unfinalized sessions
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
        """Get full session detail with computed intervals and stats."""
        session = self.store.get_session(session_id)
        if session is None:
            return None
        return self._session_to_dict(session)

    # --- Aggregate stats ---

    def get_user_stats(self, user_id: str, days: int = 30) -> dict:
        """Get aggregated sleep statistics over a period."""
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff = cutoff_dt.isoformat()

        sessions = [
            s for s in self.store.sessions.values()
            if s.user_id == user_id
            and not s.is_active
            and s.ended_at
            and s.started_at >= cutoff
        ]
        sessions.sort(key=lambda s: s.started_at)

        params = self._get_user_timeline_params(user_id)
        daily: list[dict] = []

        for session in sessions:
            intervals = compute_intervals(
                session.started_at, session.ended_at, session.pulses, **params
            )
            stats = compute_stats(intervals, session.started_at, session.ended_at)
            daily.append({
                "session_id": session.session_id,
                "date": session.started_at[:10],
                "started_at": session.started_at,
                "ended_at": session.ended_at,
                **stats,
            })

        # Compute averages
        n = len(daily)
        if n > 0:
            avg_sleep = sum(d["total_sleep_minutes"] for d in daily) / n
            avg_efficiency = sum(d["sleep_efficiency"] for d in daily) / n
            avg_awakenings = sum(d["awakenings"] for d in daily) / n
            avg_time_to_sleep = sum(d["time_to_fall_asleep_minutes"] for d in daily) / n
        else:
            avg_sleep = avg_efficiency = avg_awakenings = avg_time_to_sleep = 0

        return {
            "days": days,
            "session_count": n,
            "daily": daily,
            "averages": {
                "total_sleep_minutes": round(avg_sleep, 1),
                "sleep_efficiency": round(avg_efficiency, 3),
                "awakenings": round(avg_awakenings, 1),
                "time_to_fall_asleep_minutes": round(avg_time_to_sleep, 1),
            },
        }

    # --- Helpers ---

    def _get_user_timeline_params(self, user_id: str) -> dict:
        """Get timeline computation parameters for a user."""
        config = self.store.get_user_config(user_id)
        return {
            "fall_asleep_latency_minutes": config.fall_asleep_latency_minutes if config else 15,
            "sleep_onset_minutes": config.sleep_onset_minutes if config else 0,
        }

    def _session_to_dict(self, session: SleepSession) -> dict:
        """Convert session to dict with computed intervals and stats."""
        params = self._get_user_timeline_params(session.user_id)

        intervals = compute_intervals(
            session.started_at,
            session.ended_at,
            session.pulses,
            **params,
        )

        result = session.to_dict()
        result["intervals"] = [i.to_dict() for i in intervals]

        if session.ended_at:
            result["stats"] = compute_stats(
                intervals, session.started_at, session.ended_at
            )
        else:
            result["stats"] = None

        return result
