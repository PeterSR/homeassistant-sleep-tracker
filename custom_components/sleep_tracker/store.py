"""Persistent storage for Sleep Tracker integration."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import KIND_USER, STORAGE_KEY, STORAGE_VERSION
from .models import SleepSession, TrackerConfig, UserPreferences

_LOGGER = logging.getLogger(__name__)

SAVE_DELAY = 10


class SleepTrackerStore:
    """Manages persistent storage for sleep tracking data."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.trackers: dict[str, TrackerConfig] = {}
        self.sessions: dict[str, SleepSession] = {}
        self.user_prefs: dict[str, UserPreferences] = {}

    async def async_load(self) -> None:
        """Load data from disk, migrating legacy user_id format if present."""
        data = await self._store.async_load()
        if data is None:
            _LOGGER.debug("No existing storage data, using defaults")
            return

        migrated = False

        # Legacy storage used "users" key; new storage uses "trackers".
        trackers_raw = data.get("trackers")
        if trackers_raw is None:
            trackers_raw = data.get("users", {})
            if trackers_raw:
                migrated = True
                _LOGGER.info("Migrating legacy 'users' storage key to 'trackers'")

        for tracker_id, tracker_data in trackers_raw.items():
            # Legacy entries used "user_id" instead of "tracker_id" and lacked "kind".
            if "tracker_id" not in tracker_data:
                tracker_data["tracker_id"] = tracker_data.pop("user_id", tracker_id)
                migrated = True
            if "kind" not in tracker_data:
                tracker_data["kind"] = KIND_USER
                migrated = True
            self.trackers[tracker_id] = TrackerConfig.from_dict(tracker_data)

        for session_id, session_data in data.get("sessions", {}).items():
            session_data.setdefault("session_id", session_id)
            if "tracker_id" not in session_data and "user_id" in session_data:
                session_data["tracker_id"] = session_data.pop("user_id")
                migrated = True
            self.sessions[session_id] = SleepSession.from_dict(session_data)

        for ha_user_id, prefs_data in data.get("user_prefs", {}).items():
            prefs_data.setdefault("ha_user_id", ha_user_id)
            self.user_prefs[ha_user_id] = UserPreferences.from_dict(prefs_data)

        _LOGGER.debug(
            "Loaded %d trackers, %d sessions",
            len(self.trackers),
            len(self.sessions),
        )

        if migrated:
            _LOGGER.info("Sleep Tracker storage migrated to tracker_id format")
            self.async_save()

    @callback
    def _data_to_save(self) -> dict[str, Any]:
        """Return data to save."""
        return {
            "trackers": {tid: t.to_dict() for tid, t in self.trackers.items()},
            "sessions": {sid: s.to_dict() for sid, s in self.sessions.items()},
            "user_prefs": {
                uid: p.to_dict() for uid, p in self.user_prefs.items()
            },
        }

    def async_save(self) -> None:
        """Schedule a debounced save."""
        self._store.async_delay_save(self._data_to_save, SAVE_DELAY)

    # --- Tracker config ---

    def get_tracker_config(self, tracker_id: str) -> TrackerConfig | None:
        """Get config for a tracker."""
        return self.trackers.get(tracker_id)

    def set_tracker_config(self, config: TrackerConfig) -> None:
        """Set or update tracker config."""
        self.trackers[config.tracker_id] = config
        self.async_save()

    def remove_tracker(self, tracker_id: str) -> None:
        """Remove a tracker and all its sessions."""
        self.trackers.pop(tracker_id, None)
        to_remove = [
            sid for sid, s in self.sessions.items() if s.tracker_id == tracker_id
        ]
        for sid in to_remove:
            del self.sessions[sid]
        self.async_save()

    # --- User preferences ---

    def get_user_preferences(self, ha_user_id: str) -> UserPreferences:
        """Get prefs for a HA user, returning defaults if none stored."""
        prefs = self.user_prefs.get(ha_user_id)
        if prefs is None:
            return UserPreferences(ha_user_id=ha_user_id)
        return prefs

    def set_user_preferences(self, prefs: UserPreferences) -> None:
        """Set or update user preferences."""
        self.user_prefs[prefs.ha_user_id] = prefs
        self.async_save()

    # --- Sessions ---

    def add_session(self, session: SleepSession) -> None:
        """Add a new session."""
        self.sessions[session.session_id] = session
        self.async_save()

    def update_session(self, session_id: str, **kwargs: Any) -> SleepSession:
        """Update fields on an existing session."""
        session = self.sessions[session_id]
        for key, value in kwargs.items():
            if hasattr(session, key):
                setattr(session, key, value)
        self.async_save()
        return session

    def delete_session(self, session_id: str) -> None:
        """Delete a session by ID."""
        if session_id in self.sessions:
            del self.sessions[session_id]
            self.async_save()

    def get_session(self, session_id: str) -> SleepSession | None:
        """Get a session by ID."""
        return self.sessions.get(session_id)

    def get_active_session(self, tracker_id: str) -> SleepSession | None:
        """Get the active (not ended) session for a tracker."""
        for session in self.sessions.values():
            if session.tracker_id == tracker_id and session.is_active:
                return session
        return None

    def get_tracker_sessions(
        self, tracker_id: str, limit: int = 20, offset: int = 0
    ) -> list[SleepSession]:
        """Get completed sessions for a tracker, newest first."""
        completed = sorted(
            (s for s in self.sessions.values()
             if s.tracker_id == tracker_id and not s.is_active),
            key=lambda s: s.started_at,
            reverse=True,
        )
        return completed[offset : offset + limit]

    def get_unfinalized_sessions(self, tracker_id: str) -> list[SleepSession]:
        """Get completed but not finalized sessions for a tracker."""
        return [
            s for s in self.sessions.values()
            if s.tracker_id == tracker_id and not s.is_active and not s.finalized
        ]

    def purge_old_sessions(self, tracker_id: str, retention_days: int) -> int:
        """Delete sessions older than retention period. Returns count deleted.

        Sessions that have not been exported are kept when the tracker has
        keep_unexported set or an export_url configured.
        """
        config = self.trackers.get(tracker_id)
        protect_unexported = bool(
            config and (config.keep_unexported or config.export_url)
        )
        cutoff_dt = dt_util.utcnow() - timedelta(days=retention_days)

        to_remove: list[str] = []
        for sid, s in self.sessions.items():
            if s.tracker_id != tracker_id or s.is_active:
                continue
            if protect_unexported and not s.exported:
                continue
            try:
                started = datetime.fromisoformat(s.started_at)
            except ValueError:
                _LOGGER.debug(
                    "Skipping session %s: unparseable started_at %r",
                    sid, s.started_at,
                )
                continue
            if started.tzinfo is None:
                started = started.replace(tzinfo=cutoff_dt.tzinfo)
            if started < cutoff_dt:
                to_remove.append(sid)

        for sid in to_remove:
            del self.sessions[sid]
        if to_remove:
            self.async_save()
        return len(to_remove)
