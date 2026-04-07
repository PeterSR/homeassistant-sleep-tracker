"""Persistent storage for Sleep Tracker integration."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import STORAGE_KEY, STORAGE_VERSION
from .models import SleepSession, UserConfig

_LOGGER = logging.getLogger(__name__)

SAVE_DELAY = 10


class SleepTrackerStore:
    """Manages persistent storage for sleep tracking data."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.users: dict[str, UserConfig] = {}
        self.sessions: dict[str, SleepSession] = {}

    async def async_load(self) -> None:
        """Load data from disk."""
        data = await self._store.async_load()
        if data is None:
            _LOGGER.debug("No existing storage data, using defaults")
            return

        for user_id, user_data in data.get("users", {}).items():
            user_data.setdefault("user_id", user_id)
            self.users[user_id] = UserConfig.from_dict(user_data)

        for session_id, session_data in data.get("sessions", {}).items():
            session_data.setdefault("session_id", session_id)
            self.sessions[session_id] = SleepSession.from_dict(session_data)

        _LOGGER.debug(
            "Loaded %d users, %d sessions",
            len(self.users),
            len(self.sessions),
        )

    @callback
    def _data_to_save(self) -> dict[str, Any]:
        """Return data to save."""
        return {
            "users": {uid: u.to_dict() for uid, u in self.users.items()},
            "sessions": {sid: s.to_dict() for sid, s in self.sessions.items()},
        }

    def async_save(self) -> None:
        """Schedule a debounced save."""
        self._store.async_delay_save(self._data_to_save, SAVE_DELAY)

    # --- User config ---

    def get_user_config(self, user_id: str) -> UserConfig | None:
        """Get config for a user."""
        return self.users.get(user_id)

    def set_user_config(self, config: UserConfig) -> None:
        """Set or update user config."""
        self.users[config.user_id] = config
        self.async_save()

    def remove_user(self, user_id: str) -> None:
        """Remove a user and all their sessions."""
        self.users.pop(user_id, None)
        to_remove = [
            sid for sid, s in self.sessions.items() if s.user_id == user_id
        ]
        for sid in to_remove:
            del self.sessions[sid]
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

    def get_session(self, session_id: str) -> SleepSession | None:
        """Get a session by ID."""
        return self.sessions.get(session_id)

    def get_active_session(self, user_id: str) -> SleepSession | None:
        """Get the active (not ended) session for a user."""
        for session in self.sessions.values():
            if session.user_id == user_id and session.is_active:
                return session
        return None

    def get_user_sessions(
        self, user_id: str, limit: int = 20, offset: int = 0
    ) -> list[SleepSession]:
        """Get completed sessions for a user, newest first."""
        completed = sorted(
            (s for s in self.sessions.values()
             if s.user_id == user_id and not s.is_active),
            key=lambda s: s.started_at,
            reverse=True,
        )
        return completed[offset : offset + limit]

    def get_unfinalized_sessions(self, user_id: str) -> list[SleepSession]:
        """Get completed but not finalized sessions for a user."""
        return [
            s for s in self.sessions.values()
            if s.user_id == user_id and not s.is_active and not s.finalized
        ]

    def purge_old_sessions(self, user_id: str, retention_days: int) -> int:
        """Delete sessions older than retention period. Returns count deleted."""
        cutoff_dt = dt_util.now() - timedelta(days=retention_days)

        to_remove: list[str] = []
        for sid, s in self.sessions.items():
            if s.user_id != user_id or s.is_active:
                continue
            try:
                started = datetime.fromisoformat(s.started_at)
            except ValueError:
                continue
            # Compare as aware datetimes (handles mixed UTC/local timestamps)
            if started.tzinfo is None:
                started = started.replace(tzinfo=cutoff_dt.tzinfo)
            if started < cutoff_dt:
                to_remove.append(sid)

        for sid in to_remove:
            del self.sessions[sid]
        if to_remove:
            self.async_save()
        return len(to_remove)
