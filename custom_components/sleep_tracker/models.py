"""Data models for Sleep Tracker integration."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class UserConfig:
    """Per-user sleep tracking configuration."""

    user_id: str
    enabled: bool = True
    display_name: str = ""
    sleep_onset_minutes: int = 0
    fall_asleep_latency_minutes: int = 15
    auto_finalize_hours: int = 12
    export_url: str | None = None
    export_headers: dict[str, str] = field(default_factory=dict)
    retention_days: int = 90

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "enabled": self.enabled,
            "display_name": self.display_name,
            "sleep_onset_minutes": self.sleep_onset_minutes,
            "fall_asleep_latency_minutes": self.fall_asleep_latency_minutes,
            "auto_finalize_hours": self.auto_finalize_hours,
            "export_url": self.export_url,
            "export_headers": self.export_headers,
            "retention_days": self.retention_days,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UserConfig:
        return cls(
            user_id=data["user_id"],
            enabled=data.get("enabled", True),
            display_name=data.get("display_name", ""),
            sleep_onset_minutes=data.get("sleep_onset_minutes", 0),
            fall_asleep_latency_minutes=data.get("fall_asleep_latency_minutes", 15),
            auto_finalize_hours=data.get("auto_finalize_hours", 12),
            export_url=data.get("export_url"),
            export_headers=data.get("export_headers", {}),
            retention_days=data.get("retention_days", 90),
        )


@dataclass
class SleepEvent:
    """A single raw event during a sleep session — immutable signal."""

    timestamp: str  # ISO 8601
    event_type: str  # "awake", "still_awake", or "fell_asleep"
    source: str = "manual"

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SleepEvent:
        return cls(
            timestamp=data["timestamp"],
            event_type=data["event_type"],
            source=data.get("source", "manual"),
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
    user_id: str
    started_at: str  # ISO 8601
    ended_at: str | None = None  # ISO 8601, None if active
    events: list[SleepEvent] = field(default_factory=list)
    phases: list[SleepPhase] | None = None  # materialized on stop
    finalized: bool = False
    exported: bool = False

    @property
    def is_active(self) -> bool:
        return self.ended_at is None

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "events": [e.to_dict() for e in self.events],
            "phases": (
                [p.to_dict() for p in self.phases] if self.phases is not None else None
            ),
            "finalized": self.finalized,
            "exported": self.exported,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SleepSession:
        phases_data = data.get("phases")
        return cls(
            session_id=data["session_id"],
            user_id=data["user_id"],
            started_at=data["started_at"],
            ended_at=data.get("ended_at"),
            events=[SleepEvent.from_dict(e) for e in data.get("events", [])],
            phases=(
                [SleepPhase.from_dict(p) for p in phases_data]
                if phases_data is not None
                else None
            ),
            finalized=data.get("finalized", False),
            exported=data.get("exported", False),
        )
