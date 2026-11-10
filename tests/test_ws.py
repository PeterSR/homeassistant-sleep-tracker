"""WebSocket settings tests, through the real websocket schema."""

from __future__ import annotations

import pytest


@pytest.fixture
async def ws_client(hass, setup_integration, hass_ws_client):
    # The fixture pre-marks these as loaded to skip the packaged frontend; the
    # real http and websocket_api components must be set up for a client.
    hass.config.components.difference_update({"http", "websocket_api"})
    await setup_integration.async_setup_tracker("shared-1", "Shared", kind="shared")
    return await hass_ws_client(hass)


@pytest.mark.parametrize("value", [True, False])
async def test_update_settings_round_trips_keep_unexported(
    ws_client, setup_integration, value
):
    await ws_client.send_json_auto_id(
        {
            "type": "sleep_tracker/update_settings",
            "tracker_id": "shared-1",
            "keep_unexported": value,
        }
    )
    response = await ws_client.receive_json()
    assert response["success"]
    assert response["result"]["keep_unexported"] is value
    assert setup_integration.store.get_tracker_config("shared-1").keep_unexported is value


async def test_update_settings_rejects_non_bool_keep_unexported(ws_client, setup_integration):
    await ws_client.send_json_auto_id(
        {
            "type": "sleep_tracker/update_settings",
            "tracker_id": "shared-1",
            "keep_unexported": "yes",
        }
    )
    response = await ws_client.receive_json()
    assert not response["success"]
    assert setup_integration.store.get_tracker_config("shared-1").keep_unexported is False
