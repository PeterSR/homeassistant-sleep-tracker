"""WebSocket settings test."""

from __future__ import annotations

import pytest

from custom_components.sleep_tracker.websocket_api import ws_update_settings


@pytest.mark.parametrize("value", [True, False])
async def test_update_settings_round_trips_keep_unexported(hass, coordinator, value):
    from unittest.mock import MagicMock

    connection = MagicMock()
    connection.user.id = "tracker-1"
    connection.user.is_admin = True
    msg = {
        "id": 1,
        "type": "sleep_tracker/update_settings",
        "tracker_id": "tracker-1",
        "keep_unexported": value,
    }
    ws_update_settings(hass, connection, msg)
    await hass.async_block_till_done()
    connection.send_result.assert_called_once()
    assert connection.send_result.call_args[0][1]["keep_unexported"] is value
    assert coordinator.store.get_tracker_config("tracker-1").keep_unexported is value
