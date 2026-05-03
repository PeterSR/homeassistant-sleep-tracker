"""Data models for Sleep Tracker integration."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .const import KIND_USER


CHECKLIST_TYPE_ENTITY = "entity"
CHECKLIST_TYPE_TEXT = "text"


@dataclass
class ChecklistItem:
    """A pre-sleep checklist item — either an entity state check or free text."""

    type: str  # CHECKLIST_TYPE_ENTITY or CHECKLIST_TYPE_TEXT
    entity_id: str | None = None
    desired_state: str | None = None
    text: str | None = None

    def __post_init__(self) -> None:
        if self.type == CHECKLIST_TYPE_ENTITY:
            if not self.entity_id:
                raise ValueError("entity checklist item requires entity_id")
        elif self.type == CHECKLIST_TYPE_TEXT:
            if not self.text:
                raise ValueError("text checklist item requires text")
        else:
            raise ValueError(f"Invalid checklist item type: {self.type}")

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"type": self.type}
        if self.entity_id is not None:
            data["entity_id"] = self.entity_id
        if self.desired_state is not None:
            data["desired_state"] = self.desired_state
        if self.text is not None:
            data["text"] = self.text
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ChecklistItem:
        return cls(
            type=data["type"],
            entity_id=data.get("entity_id"),
            desired_state=data.get("desired_state"),
            text=data.get("text"),
        )


@dataclass
class CustomEvent:
    """User-defined event shown as a button during active sessions."""

    id: str
    label: str
    icon: str | None = None
    tag: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "icon": self.icon,
            "tag": self.tag,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CustomEvent:
        return cls(
            id=data["id"],
            label=data["label"],
            icon=data.get("icon"),
            tag=data.get("tag"),
        )


@dataclass
class TrackerConfig:
    """Per-tracker sleep tracking configuration.

    A "tracker" is either a personal tracker (kind="user", tracker_id == HA user id)
    or a shared tracker (kind="shared", tracker_id == generated UUID) that any
    authenticated user can act on (e.g. for a baby).
    """

    tracker_id: str
    kind: str = KIND_USER  # KIND_USER | KIND_SHARED
    enabled: bool = True
    display_name: str = ""
    sleep_onset_minutes: int = 0
    fall_asleep_latency_minutes: int = 15
    awakening_grace_minutes: int = 0
    skip_event_review: bool = False
    skip_phase_review: bool = False
    export_url: str | None = None
    export_headers: dict[str, str] = field(default_factory=dict)
    export_environment_data: bool = False
    retention_days: int = 90
    checklist: list[ChecklistItem] = field(default_factory=list)
    show_note: bool = True
    show_rating_quality: bool = True
    show_rating_feeling: bool = True
    show_tags: bool = True
    available_tags: list[str] = field(default_factory=list)
    show_environment: bool = True
    environment_entities: list[str] = field(default_factory=list)
    sleep_goal_minutes: int = 0
    custom_events: list[CustomEvent] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tracker_id": self.tracker_id,
            "kind": self.kind,
            "enabled": self.enabled,
            "display_name": self.display_name,
            "sleep_onset_minutes": self.sleep_onset_minutes,
            "fall_asleep_latency_minutes": self.fall_asleep_latency_minutes,
            "awakening_grace_minutes": self.awakening_grace_minutes,
            "skip_event_review": self.skip_event_review,
            "skip_phase_review": self.skip_phase_review,
            "export_url": self.export_url,
            "export_headers": self.export_headers,
            "export_environment_data": self.export_environment_data,
            "retention_days": self.retention_days,
            "checklist": [item.to_dict() for item in self.checklist],
            "show_note": self.show_note,
            "show_rating_quality": self.show_rating_quality,
            "show_rating_feeling": self.show_rating_feeling,
            "show_tags": self.show_tags,
            "available_tags": self.available_tags,
            "show_environment": self.show_environment,
            "environment_entities": self.environment_entities,
            "sleep_goal_minutes": self.sleep_goal_minutes,
            "custom_events": [e.to_dict() for e in self.custom_events],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TrackerConfig:
        # Accept legacy "user_id" field for migration.
        tracker_id = data.get("tracker_id") or data["user_id"]
        return cls(
            tracker_id=tracker_id,
            kind=data.get("kind", KIND_USER),
            enabled=data.get("enabled", True),
            display_name=data.get("display_name", ""),
            sleep_onset_minutes=data.get("sleep_onset_minutes", 0),
            fall_asleep_latency_minutes=data.get("fall_asleep_latency_minutes", 15),
            awakening_grace_minutes=data.get("awakening_grace_minutes", 0),
            skip_event_review=data.get("skip_event_review", False),
            skip_phase_review=data.get("skip_phase_review", False),
            export_url=data.get("export_url"),
            export_headers=data.get("export_headers", {}),
            export_environment_data=data.get("export_environment_data", False),
            retention_days=data.get("retention_days", 90),
            checklist=[
                ChecklistItem.from_dict(item) for item in data.get("checklist", [])
            ],
            show_note=data.get("show_note", True),
            show_rating_quality=data.get("show_rating_quality", True),
            show_rating_feeling=data.get("show_rating_feeling", True),
            show_tags=data.get("show_tags", True),
            available_tags=data.get("available_tags", []),
            show_environment=data.get("show_environment", True),
            environment_entities=data.get("environment_entities", []),
            sleep_goal_minutes=data.get("sleep_goal_minutes", 0),
            custom_events=[
                CustomEvent.from_dict(e) for e in data.get("custom_events", [])
            ],
        )


@dataclass
class SleepEvent:
    """A single raw event during a sleep session — immutable signal."""

    timestamp: str  # ISO 8601
    event_type: str  # "awake", "still_awake", "fell_asleep", "pause", "resume", "custom"
    source: str = "manual"
    custom_event_id: str | None = None  # set when event_type == "custom"
    automation_id: str | None = None  # e.g. automation.bedside_button
    automation_trigger_id: str | None = None  # trigger.id within the automation

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "source": self.source,
        }
        if self.custom_event_id is not None:
            data["custom_event_id"] = self.custom_event_id
        if self.automation_id is not None:
            data["automation_id"] = self.automation_id
        if self.automation_trigger_id is not None:
            data["automation_trigger_id"] = self.automation_trigger_id
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SleepEvent:
        return cls(
            timestamp=data["timestamp"],
            event_type=data["event_type"],
            source=data.get("source", "manual"),
            custom_event_id=data.get("custom_event_id"),
            automation_id=data.get("automation_id"),
            automation_trigger_id=data.get("automation_trigger_id"),
        )


@dataclass
class SleepPhase:
    """A sleep/wake phase — the editable representation of a sleep state."""

    start: str  # ISO 8601
    end: str  # ISO 8601
    state: str  # "awake" or "asleep"

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "state": self.state,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SleepPhase:
        return cls(
            start=data["start"],
            end=data["end"],
            state=data["state"],
        )


@dataclass
class SleepSession:
    """A single sleep tracking session (one night).

    During an active session, only events accumulate. On stop, phases are
    materialized from events using the latency/onset algorithm and stored.
    After stop, phases are edited directly and events become read-only history.
    """

    session_id: str
    tracker_id: str
    started_at: str  # ISO 8601
    ended_at: str | None = None  # ISO 8601, None if active
    paused_at: str | None = None  # ISO 8601, set when session is paused
    events: list[SleepEvent] = field(default_factory=list)
    phases: list[SleepPhase] | None = None  # materialized on complete
    finalized: bool = False
    exported: bool = False
    note: str | None = None
    rating_quality: int | None = None  # 1-5
    rating_feeling: int | None = None  # 1-5
    tags: list[str] = field(default_factory=list)

    @property
    def is_active(self) -> bool:
        return self.ended_at is None

    @property
    def status(self) -> str:
        """Lifecycle status: active, paused, stopped, completed, finalized."""
        if self.finalized:
            return "finalized"
        if self.ended_at is not None:
            return "completed" if self.phases is not None else "stopped"
        if self.paused_at is not None:
            return "paused"
        return "active"

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "tracker_id": self.tracker_id,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "paused_at": self.paused_at,
            "events": [e.to_dict() for e in self.events],
            "phases": (
                [p.to_dict() for p in self.phases] if self.phases is not None else None
            ),
            "finalized": self.finalized,
            "exported": self.exported,
            "note": self.note,
            "rating_quality": self.rating_quality,
            "rating_feeling": self.rating_feeling,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SleepSession:
        phases_data = data.get("phases")
        # Accept legacy "user_id" field for migration.
        tracker_id = data.get("tracker_id") or data["user_id"]
        return cls(
            session_id=data["session_id"],
            tracker_id=tracker_id,
            started_at=data["started_at"],
            ended_at=data.get("ended_at"),
            paused_at=data.get("paused_at"),
            events=[SleepEvent.from_dict(e) for e in data.get("events", [])],
            phases=(
                [SleepPhase.from_dict(p) for p in phases_data]
                if phases_data is not None
                else None
            ),
            finalized=data.get("finalized", False),
            exported=data.get("exported", False),
            note=data.get("note"),
            rating_quality=data.get("rating_quality"),
            rating_feeling=data.get("rating_feeling"),
            tags=data.get("tags", []),
        )
