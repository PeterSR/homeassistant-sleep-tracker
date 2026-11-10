"""Tests for the per-tracker status sensor."""

from __future__ import annotations

ENTITY_ID = "sensor.sleep_tracker_test_status"


async def test_status_sensor_lifecycle(hass, coordinator):
    state = hass.states.get(ENTITY_ID)
    assert state.state == "idle"
    assert state.attributes["options"] == ["idle", "active", "paused"]
    assert state.attributes["device_class"] == "enum"
    assert state.attributes["tracker_id"] == "tracker-1"
    assert state.attributes["session_id"] is None
    assert state.attributes["started_at"] is None

    session = await coordinator.async_start_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY_ID)
    assert state.state == "active"
    assert state.attributes["tracker_id"] == "tracker-1"
    assert state.attributes["session_id"] == session["session_id"]
    assert state.attributes["started_at"] == session["started_at"]

    await coordinator.async_pause_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY_ID)
    assert state.state == "paused"
    assert state.attributes["session_id"] == session["session_id"]
    assert state.attributes["started_at"] == session["started_at"]

    await coordinator.async_start_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state == "active"

    await coordinator.async_stop_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY_ID)
    assert state.state == "idle"
    assert state.attributes["session_id"] is None
    assert state.attributes["started_at"] is None


async def test_status_sensor_for_tracker_existing_before_setup(hass):
    from unittest.mock import patch

    from homeassistant.loader import async_get_integration
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.sleep_tracker.const import DOMAIN
    from custom_components.sleep_tracker.models import SleepSession, TrackerConfig
    from custom_components.sleep_tracker.store import SleepTrackerStore

    hass.config.components.update({"frontend", "http", "websocket_api"})
    await async_get_integration(hass, DOMAIN)
    store = SleepTrackerStore(hass)
    store.trackers["t9"] = TrackerConfig(tracker_id="t9", display_name="Early")
    store.sessions["s"] = SleepSession(
        session_id="s", tracker_id="t9", started_at="2026-01-01T00:00:00+00:00",
        paused_at="2026-01-01T01:00:00+00:00",
    )
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    with (
        patch("custom_components.sleep_tracker.Path.is_dir", return_value=False),
        patch.object(SleepTrackerStore, "async_load", lambda self: _load(self, store)),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    state = hass.states.get("sensor.sleep_tracker_early_status")
    assert state.state == "paused"
    assert state.attributes["session_id"] == "s"


async def _load(target, source):
    target.trackers = source.trackers
    target.sessions = source.sessions


async def test_status_after_reopen_and_stop_variants(hass, coordinator):
    session = await coordinator.async_start_sleep("tracker-1", "test")
    await coordinator.async_stop_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    assert hass.states.get(ENTITY_ID).state == "idle"

    await coordinator.async_reopen_session("tracker-1", session["session_id"])
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY_ID)
    assert state.state == "active"
    assert state.attributes["session_id"] == session["session_id"]

    await coordinator.async_pause_sleep("tracker-1", "test")
    await coordinator.async_stop_sleep("tracker-1", "test")
    await hass.async_block_till_done()
    state = hass.states.get(ENTITY_ID)
    assert state.state == "idle"
    assert state.attributes["session_id"] is None
