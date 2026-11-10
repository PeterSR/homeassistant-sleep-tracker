"""Helpers shared by the Sleep Tracker tests."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.util import dt as dt_util

from custom_components.sleep_tracker.models import SleepSession


def add_session(
    coordinator,
    session_id: str,
    *,
    tracker_id: str = "tracker-1",
    days_ago: float = 1,
    hours: float = 8,
    finalized: bool = True,
    exported: bool = False,
    active: bool = False,
) -> SleepSession:
    """Store a session that started `days_ago` days ago and lasted `hours` hours."""
    start = dt_util.utcnow() - timedelta(days=days_ago)
    session = SleepSession(
        session_id=session_id,
        tracker_id=tracker_id,
        started_at=start.isoformat(),
        ended_at=None if active else (start + timedelta(hours=hours)).isoformat(),
        finalized=finalized,
        exported=exported,
    )
    coordinator.store.add_session(session)
    return session
