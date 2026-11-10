"""Fixtures for the Sleep Tracker tests."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from homeassistant.loader import async_get_integration
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sleep_tracker.const import DOMAIN

TRACKER_ID = "tracker-1"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Let Home Assistant load the integration from custom_components."""


@pytest.fixture
async def setup_integration(hass):
    """Set up the integration without the panel, HTTP and frontend parts."""
    # Pretend the dependencies are loaded: the frontend component needs a
    # packaged web UI that is not installed in the test environment.
    hass.config.components.update({"frontend", "http", "websocket_api"})
    # Resolve the integration before is_dir is patched below, since the loader
    # also uses it to find custom integrations.
    await async_get_integration(hass, DOMAIN)
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    # The panel needs the real http and frontend components, which these tests
    # do not exercise, so the panel branch (only taken when a built dist
    # directory exists) is skipped.
    with patch("custom_components.sleep_tracker.Path.is_dir", return_value=False):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return hass.data[DOMAIN]["coordinator"]


@pytest.fixture
async def coordinator(setup_integration):
    """The coordinator with one tracker set up."""
    await setup_integration.async_setup_tracker(TRACKER_ID, "Test")
    return setup_integration
