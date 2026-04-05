"""Coordinator for Sleep Tracker integration.

Manages sleep sessions, pulse processing, entity notification,
and state queries. Entirely event-driven (no tick loop).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
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
        """Start a new sleep session."""
        config = self.store.get_user_config(user_id)
        if config is None:
            raise ValueError(f"User {user_id} is not set up for sleep tracking")

        active = self.store.get_active_session(user_id)
        if active is not None:
            raise ValueError(
                f"User {user_id} already has an active session: {active.session_id}"
            )

        session = SleepSession(
            session_id=str(uuid.uuid4()),
            user_id=user_id,
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        self.store.add_session(session)

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
        """Stop the active sleep session."""
        session = self.store.get_active_session(user_id)
        if session is None:
            raise ValueError(f"User {user_id} has no active session")

        ended_at = datetime.now(timezone.utc).isoformat()
        self.store.update_session(session.session_id, ended_at=ended_at)

        # Purge old sessions
        config = self.store.get_user_config(user_id)
        if config:
            purged = self.store.purge_old_sessions(user_id, config.retention_days)
            if purged:
                _LOGGER.debug("Purged %d old sessions for user %s", purged, user_id)

        self._notify_listeners(user_id)

        stats = self._compute_session_stats(session)
        self.hass.bus.async_fire(
            "sleep_tracker_session_ended",
            {
                "user_id": user_id,
                "session_id": session.session_id,
                **stats,
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

        # Include last completed session summary if no active session
        if not active_session and config:
            history = self.store.get_user_sessions(user_id, limit=1)
            result["last_session"] = (
                self._session_to_dict(history[0]) if history else None
            )

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

    # --- Helpers ---

    def _session_to_dict(self, session: SleepSession) -> dict:
        """Convert session to dict with computed intervals and stats."""
        config = self.store.get_user_config(session.user_id)
        latency = config.fall_asleep_latency_minutes if config else 15

        intervals = compute_intervals(
            session.started_at,
            session.ended_at,
            session.pulses,
            latency,
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

    def _compute_session_stats(self, session: SleepSession) -> dict:
        """Compute stats for a session (for events)."""
        if not session.ended_at:
            return {}
        config = self.store.get_user_config(session.user_id)
        latency = config.fall_asleep_latency_minutes if config else 15
        intervals = compute_intervals(
            session.started_at,
            session.ended_at,
            session.pulses,
            latency,
        )
        return compute_stats(intervals, session.started_at, session.ended_at)
