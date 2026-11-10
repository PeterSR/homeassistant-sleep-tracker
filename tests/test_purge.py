"""Tests for the retention purge guard."""

from __future__ import annotations

import pytest

from .helpers import add_session


def _seed(coordinator):
    add_session(coordinator, "old-unexported", days_ago=200, exported=False)
    add_session(coordinator, "old-exported", days_ago=200, exported=True)
    add_session(coordinator, "recent", days_ago=1, exported=False)


def _remaining(coordinator):
    return set(coordinator.store.sessions)


async def test_purge_default_deletes_all_old(coordinator):
    _seed(coordinator)
    assert coordinator.store.purge_old_sessions("tracker-1", 90) == 2
    assert _remaining(coordinator) == {"recent"}


async def test_purge_keeps_unexported_when_enabled(coordinator):
    await coordinator.async_update_tracker_config("tracker-1", keep_unexported=True)
    _seed(coordinator)
    assert coordinator.store.purge_old_sessions("tracker-1", 90) == 1
    assert _remaining(coordinator) == {"old-unexported", "recent"}


async def test_purge_keeps_unexported_when_export_url_set(coordinator):
    await coordinator.async_update_tracker_config(
        "tracker-1", export_url="https://example.org/sleep"
    )
    _seed(coordinator)
    assert coordinator.store.purge_old_sessions("tracker-1", 90) == 1
    assert _remaining(coordinator) == {"old-unexported", "recent"}


async def test_purge_runs_on_session_start(coordinator):
    await coordinator.async_update_tracker_config("tracker-1", keep_unexported=True)
    _seed(coordinator)
    await coordinator.async_start_sleep("tracker-1", "test")
    assert "old-exported" not in _remaining(coordinator)
    assert "old-unexported" in _remaining(coordinator)


@pytest.mark.parametrize("value", [True, False])
async def test_keep_unexported_round_trips(coordinator, value):
    from custom_components.sleep_tracker.models import TrackerConfig

    await coordinator.async_update_tracker_config("tracker-1", keep_unexported=value)
    config = coordinator.store.get_tracker_config("tracker-1")
    assert TrackerConfig.from_dict(config.to_dict()).keep_unexported is value
    assert TrackerConfig.from_dict({"tracker_id": "x"}).keep_unexported is False


async def test_old_stopped_session_survives_start_with_guard(coordinator):
    await coordinator.async_update_tracker_config("tracker-1", keep_unexported=True)
    add_session(coordinator, "old-stopped", days_ago=200, finalized=False, exported=False)
    await coordinator.async_start_sleep("tracker-1", "test")
    # Auto-finalize ran, then the purge skipped the unexported session.
    session = coordinator.store.get_session("old-stopped")
    assert session is not None
    assert session.finalized is True
    assert session.exported is False
