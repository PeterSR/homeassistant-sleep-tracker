"""Model round-trip tests."""

from __future__ import annotations

from custom_components.sleep_tracker.models import SleepSession


def test_revision_defaults_to_zero_without_the_key():
    session = SleepSession.from_dict(
        {"session_id": "s", "tracker_id": "t", "started_at": "2026-01-01T00:00:00+00:00"}
    )
    assert session.revision == 0


def test_revision_round_trips():
    session = SleepSession(
        session_id="s", tracker_id="t", started_at="2026-01-01T00:00:00+00:00", revision=3
    )
    assert SleepSession.from_dict(session.to_dict()).revision == 3
