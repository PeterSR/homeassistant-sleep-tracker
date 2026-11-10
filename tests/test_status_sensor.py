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
