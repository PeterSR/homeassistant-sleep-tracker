"""Tests for the list_sessions, get_session and mark_exported actions."""

from __future__ import annotations

from unittest.mock import patch

import pytest
import voluptuous as vol
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMockResponse,
)
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError, Unauthorized

from custom_components.sleep_tracker.const import DOMAIN
from custom_components.sleep_tracker.export import ExportError, async_export_session

from .helpers import add_session

LIST_KEYS = {
    "session_id", "tracker_id", "started_at", "ended_at", "finalized", "exported", "revision",
}


async def _call(hass, service, data, *, response=False, context=None):
    return await hass.services.async_call(
        DOMAIN, service, data, blocking=True, return_response=response, context=context
    )


async def test_list_sessions_orders_by_start_ascending(hass, coordinator):
    add_session(coordinator, "newest", days_ago=1)
    add_session(coordinator, "oldest", days_ago=5)
    add_session(coordinator, "middle", days_ago=3)

    result = await _call(hass, "list_sessions", {}, response=True)

    assert [s["session_id"] for s in result["sessions"]] == ["oldest", "middle", "newest"]
    assert set(result["sessions"][0]) == LIST_KEYS


async def test_list_sessions_filters(hass, coordinator):
    await coordinator.async_setup_tracker("tracker-2", "Other")
    add_session(coordinator, "a", days_ago=4, finalized=True, exported=False)
    add_session(coordinator, "b", days_ago=3, finalized=True, exported=True)
    add_session(coordinator, "c", days_ago=2, finalized=False, exported=False)
    add_session(coordinator, "d", days_ago=1, tracker_id="tracker-2", finalized=True)

    async def ids(**data):
        result = await _call(hass, "list_sessions", data, response=True)
        return [s["session_id"] for s in result["sessions"]]

    assert await ids() == ["a", "b", "c", "d"]
    assert await ids(tracker_id="tracker-1") == ["a", "b", "c"]
    assert await ids(tracker_id="tracker-2") == ["d"]
    assert await ids(finalized=True) == ["a", "b", "d"]
    assert await ids(finalized=False) == ["c"]
    assert await ids(exported=False) == ["a", "c", "d"]
    assert await ids(exported=True) == ["b"]
    assert await ids(tracker_id="tracker-1", finalized=True, exported=False) == ["a"]
    assert await ids(tracker_id="missing") == []


async def test_get_session_matches_rest_export(hass, coordinator, aioclient_mock):
    await coordinator.async_update_tracker_config(
        "tracker-1",
        export_url="https://example.org/sleep",
        export_headers={"X-Test": "1"},
    )
    session = await coordinator.async_start_sleep("tracker-1", "test")
    await coordinator.async_stop_sleep("tracker-1", "test")
    await coordinator.async_complete_session("tracker-1", session["session_id"])
    # Finalize directly so no auto-export runs before the REST call under test.
    # This leaves revision 0, like a session stored before revisions existed.
    coordinator.store.update_session(session["session_id"], finalized=True)
    aioclient_mock.post("https://example.org/sleep", status=200)

    result = await _call(hass, "get_session", {"session_id": session["session_id"]}, response=True)
    # Reading the payload does not change the exported flag; the REST export does.
    assert coordinator.store.get_session(session["session_id"]).exported is False
    await async_export_session(hass, coordinator, session["session_id"])

    assert len(aioclient_mock.mock_calls) == 1
    posted = aioclient_mock.mock_calls[0][2]
    assert result == {"session": posted, "revision": posted["revision"]}
    assert posted["revision"] == coordinator.store.get_session(session["session_id"]).revision
    assert posted["session_id"] == session["session_id"]
    assert posted["tracker_id"] == "tracker-1"
    assert "environment_history" not in posted
    assert coordinator.store.get_session(session["session_id"]).exported is True


async def test_get_session_includes_environment_history(hass, coordinator):
    from unittest.mock import AsyncMock, patch

    await coordinator.async_update_tracker_config(
        "tracker-1",
        export_environment_data=True,
        environment_entities=["sensor.temperature"],
    )
    add_session(coordinator, "s1")
    history = {"sensor.temperature": [{"state": "20", "last_changed": "x"}]}

    with patch(
        "custom_components.sleep_tracker.export.async_get_state_history",
        AsyncMock(return_value=history),
    ):
        result = await _call(hass, "get_session", {"session_id": "s1"}, response=True)

    assert result["session"]["environment_history"] == history


async def test_get_session_errors(hass, coordinator):
    with pytest.raises(HomeAssistantError):
        await _call(hass, "get_session", {"session_id": "missing"}, response=True)
    add_session(coordinator, "live", active=True, finalized=False)
    with pytest.raises(HomeAssistantError):
        await _call(hass, "get_session", {"session_id": "live"}, response=True)


async def test_mark_exported(hass, coordinator):
    add_session(coordinator, "s1", exported=False, finalized=True)

    await _call(hass, "mark_exported", {"session_id": "s1"})
    assert coordinator.store.get_session("s1").exported is True

    await _call(hass, "mark_exported", {"session_id": "s1", "exported": False})
    assert coordinator.store.get_session("s1").exported is False

    with pytest.raises(HomeAssistantError):
        await _call(hass, "mark_exported", {"session_id": "missing"})


@pytest.mark.parametrize(
    ("service", "data", "response"),
    [
        ("list_sessions", {}, True),
        ("get_session", {"session_id": "s1"}, True),
        ("mark_exported", {"session_id": "s1"}, False),
    ],
)
async def test_actions_are_admin_only(
    hass, coordinator, hass_admin_user, hass_read_only_user, service, data, response
):
    add_session(coordinator, "s1")

    with pytest.raises(Unauthorized):
        await _call(
            hass, service, data, response=response,
            context=Context(user_id=hass_read_only_user.id),
        )

    await _call(
        hass, service, data, response=response,
        context=Context(user_id=hass_admin_user.id),
    )


async def test_mark_exported_rejects_active_session(hass, coordinator):
    add_session(coordinator, "live", active=True, finalized=False)
    with pytest.raises(HomeAssistantError):
        await _call(hass, "mark_exported", {"session_id": "live"})


async def test_mark_exported_requires_finalized(hass, coordinator):
    add_session(coordinator, "s1", finalized=False)
    with pytest.raises(HomeAssistantError):
        await _call(hass, "mark_exported", {"session_id": "s1"})
    assert coordinator.store.get_session("s1").exported is False
    # Clearing the flag is always allowed.
    await _call(hass, "mark_exported", {"session_id": "s1", "exported": False})


async def test_mark_exported_after_unfinalize_race(hass, coordinator):
    add_session(coordinator, "s1", finalized=True)
    result = await _call(hass, "get_session", {"session_id": "s1"}, response=True)
    assert result["session"]["session_id"] == "s1"
    await coordinator.async_unfinalize_session("tracker-1", "s1")
    with pytest.raises(HomeAssistantError):
        await _call(hass, "mark_exported", {"session_id": "s1"})
    assert coordinator.store.get_session("s1").exported is False


async def test_mark_exported_notifies_listeners(hass, coordinator):
    add_session(coordinator, "s1", finalized=True)
    calls = []
    coordinator.add_tracker_listener("tracker-1", lambda: calls.append(1))
    await _call(hass, "mark_exported", {"session_id": "s1"})
    assert calls


async def test_unfinalize_resets_exported(hass, coordinator):
    add_session(coordinator, "s1", finalized=True, exported=False)
    await _call(hass, "mark_exported", {"session_id": "s1"})
    await coordinator.async_unfinalize_session("tracker-1", "s1")
    await coordinator.async_finalize_session("tracker-1", "s1")

    result = await _call(hass, "list_sessions", {"exported": False}, response=True)
    assert [s["session_id"] for s in result["sessions"]] == ["s1"]


async def test_list_sessions_sorts_by_parsed_datetime(hass, coordinator):
    from custom_components.sleep_tracker.models import SleepSession

    for sid, start in (
        ("later", "2026-01-01T01:00:00+00:00"),
        ("earlier", "2026-01-01T02:30:00+02:00"),
    ):
        coordinator.store.add_session(
            SleepSession(session_id=sid, tracker_id="tracker-1", started_at=start,
                         ended_at=start, finalized=True)
        )
    result = await _call(hass, "list_sessions", {}, response=True)
    assert [s["session_id"] for s in result["sessions"]] == ["earlier", "later"]


async def test_revision_race_refuses_stale_mark(hass, coordinator):
    add_session(coordinator, "s1", finalized=False)
    await coordinator.async_finalize_session("tracker-1", "s1")

    first = await _call(hass, "get_session", {"session_id": "s1"}, response=True)
    revision = first["revision"]
    assert revision == 1

    await coordinator.async_unfinalize_session("tracker-1", "s1")
    await coordinator.async_update_session_meta("tracker-1", "s1", note="edited")
    await coordinator.async_finalize_session("tracker-1", "s1")

    with pytest.raises(HomeAssistantError):
        await _call(hass, "mark_exported", {"session_id": "s1", "revision": revision})
    listed = await _call(hass, "list_sessions", {"exported": False}, response=True)
    assert [(s["session_id"], s["revision"]) for s in listed["sessions"]] == [("s1", 2)]

    again = await _call(hass, "get_session", {"session_id": "s1"}, response=True)
    assert again["revision"] == 2
    assert again["session"]["note"] == "edited"
    await _call(hass, "mark_exported", {"session_id": "s1", "revision": 2})
    assert coordinator.store.get_session("s1").exported is True


async def test_rest_export_requires_finalized_and_notifies(hass, coordinator, aioclient_mock):
    await coordinator.async_update_tracker_config(
        "tracker-1", export_url="https://example.org/sleep"
    )
    aioclient_mock.post("https://example.org/sleep", status=200)
    add_session(coordinator, "open", finalized=False)
    with pytest.raises(HomeAssistantError):
        await async_export_session(hass, coordinator, "open")
    assert aioclient_mock.call_count == 0

    add_session(coordinator, "done", finalized=True)
    calls = []
    coordinator.add_tracker_listener("tracker-1", lambda: calls.append(1))
    await async_export_session(hass, coordinator, "done")
    assert coordinator.store.get_session("done").exported is True
    assert calls


async def test_get_session_revision_matches_payload_during_await(hass, coordinator):
    await coordinator.async_update_tracker_config(
        "tracker-1",
        export_environment_data=True,
        environment_entities=["sensor.temperature"],
    )
    add_session(coordinator, "s1", finalized=False)
    await coordinator.async_finalize_session("tracker-1", "s1")

    async def refinalize(*args, **kwargs):
        await coordinator.async_unfinalize_session("tracker-1", "s1")
        await coordinator.async_update_session_meta("tracker-1", "s1", note="edited")
        await coordinator.async_finalize_session("tracker-1", "s1")
        return {}

    with patch(
        "custom_components.sleep_tracker.export.async_get_state_history", refinalize
    ):
        result = await _call(hass, "get_session", {"session_id": "s1"}, response=True)

    assert coordinator.store.get_session("s1").revision == 2
    assert result["revision"] == 1
    assert result["session"]["revision"] == 1
    assert result["session"]["note"] is None


@pytest.mark.parametrize("bad", [-1, True, "1", 1.5])
async def test_mark_exported_rejects_bad_revision(hass, coordinator, bad):
    add_session(coordinator, "s1")
    with pytest.raises(vol.Invalid):
        await _call(hass, "mark_exported", {"session_id": "s1", "revision": bad})


async def test_mark_exported_ignores_revision_when_clearing(hass, coordinator):
    add_session(coordinator, "s1", exported=True)
    await _call(hass, "mark_exported", {"session_id": "s1", "exported": False, "revision": 99})
    assert coordinator.store.get_session("s1").exported is False


async def test_rest_export_session_changed_during_post(
    hass, coordinator, aioclient_mock, caplog
):
    await coordinator.async_update_tracker_config(
        "tracker-1", export_url="https://example.org/sleep"
    )
    add_session(coordinator, "s1", finalized=True)

    async def unfinalize(method, url, data):
        await coordinator.async_unfinalize_session("tracker-1", "s1")
        return AiohttpClientMockResponse(method, url, status=200)

    aioclient_mock.post("https://example.org/sleep", side_effect=unfinalize)

    with pytest.raises(ExportError, match="changed during export"):
        await async_export_session(hass, coordinator, "s1")
    assert coordinator.store.get_session("s1").exported is False
    assert "changed or removed during export" in caplog.text

    # Auto-export mode only logs.
    coordinator.store.update_session("s1", finalized=True)
    caplog.clear()
    await async_export_session(hass, coordinator, "s1", raise_if_changed=False)
    assert coordinator.store.get_session("s1").exported is False
    assert "changed or removed during export" in caplog.text


async def test_auto_export_changed_during_post_is_quiet(
    hass, coordinator, aioclient_mock, caplog
):
    await coordinator.async_update_tracker_config(
        "tracker-1", export_url="https://example.org/sleep"
    )
    add_session(coordinator, "s1", finalized=False)
    events = []
    hass.bus.async_listen("sleep_tracker_session_finalized", events.append)

    async def unfinalize(method, url, data):
        await coordinator.async_unfinalize_session("tracker-1", "s1")
        return AiohttpClientMockResponse(method, url, status=200)

    aioclient_mock.post("https://example.org/sleep", side_effect=unfinalize)
    await coordinator.async_finalize_session("tracker-1", "s1")
    await hass.async_block_till_done()

    assert "Auto-export failed" not in caplog.text
    assert "auto-exported on finalization" not in caplog.text
    assert coordinator.store.get_session("s1").exported is False
    assert len(events) == 1
