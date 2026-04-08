"""Pure-function phase materialization and statistics for sleep sessions.

No Home Assistant dependencies — can be tested independently.

A "phase" is an awake or asleep interval. Phases are materialized from a list
of raw events (the user's input signals) using a latency/onset model.

The bipartite invariant: phases strictly alternate between "awake" and
"asleep". The materialization algorithm produces phases by construction.
After materialization, edits must preserve the alternation.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from .const import EVENT_AWAKE, EVENT_FELL_ASLEEP, EVENT_STILL_AWAKE, PHASE_ASLEEP, PHASE_AWAKE
from .models import SleepEvent, SleepPhase


def _parse(iso: str) -> datetime:
    """Parse an ISO 8601 datetime string."""
    return datetime.fromisoformat(iso)


def _fmt(dt: datetime) -> str:
    """Format a datetime as ISO 8601."""
    return dt.isoformat()


def materialize_phases(
    started_at: str,
    ended_at: str | None,
    events: list[SleepEvent],
    fall_asleep_latency_minutes: int = 15,
    sleep_onset_minutes: int = 0,
    now: datetime | None = None,
) -> list[SleepPhase]:
    """Materialize sleep phases from a list of events.

    Algorithm:
    - Session starts in AWAKE state (user just lay down).
    - Initial fall-asleep time = start + max(latency, onset). Onset acts
      as a minimum settling period.
    - Each event extends the fall-asleep timer to max(current, event + latency).
      Events can only push the fall-asleep time later, never earlier.
    - "awake" / "still_awake" events keep the user awake (extend the timer)
      or transition asleep -> awake.
    - "fell_asleep" event forces an immediate awake -> asleep transition at
      its timestamp (no-op if already asleep).
    - When the timer is reached without input, the user transitions to asleep.
    - Session end means the user is AWAKE (getting up).
    - Result is bipartite: phases strictly alternate.
    """
    start_dt = _parse(started_at)
    if ended_at:
        end_dt = _parse(ended_at)
    elif now is not None:
        end_dt = now
    else:
        from datetime import timezone as _tz
        end_dt = datetime.now(start_dt.tzinfo or _tz.utc)

    latency = timedelta(minutes=fall_asleep_latency_minutes)
    onset = timedelta(minutes=sleep_onset_minutes)

    sorted_events = sorted(events, key=lambda e: e.timestamp)

    raw_phases: list[SleepPhase] = []
    state = PHASE_AWAKE
    segment_start = start_dt
    sleep_at = start_dt + max(latency, onset)

    for event in sorted_events:
        event_time = _parse(event.timestamp)
        if event_time >= end_dt:
            break

        if event.event_type == EVENT_FELL_ASLEEP:
            # Force awake -> asleep transition at event_time
            if state == PHASE_AWAKE:
                if event_time > segment_start:
                    raw_phases.append(
                        SleepPhase(_fmt(segment_start), _fmt(event_time), PHASE_AWAKE)
                    )
                segment_start = event_time
                state = PHASE_ASLEEP
            # else: already asleep, no-op
            continue

        if event.event_type == EVENT_STILL_AWAKE:
            # User confirms they have been awake all along since the last event.
            if state == PHASE_ASLEEP:
                # Edge case: algorithm thought asleep, user says they were awake.
                if event_time > segment_start:
                    raw_phases.append(
                        SleepPhase(_fmt(segment_start), _fmt(event_time), PHASE_ASLEEP)
                    )
                segment_start = event_time
                state = PHASE_AWAKE
            sleep_at = max(sleep_at, event_time + latency)
            continue

        # event.event_type == EVENT_AWAKE
        if state == PHASE_AWAKE:
            if sleep_at <= event_time:
                # We fell asleep at sleep_at; this event wakes us
                if sleep_at > segment_start:
                    raw_phases.append(
                        SleepPhase(_fmt(segment_start), _fmt(sleep_at), PHASE_AWAKE)
                    )
                if event_time > sleep_at:
                    raw_phases.append(
                        SleepPhase(_fmt(sleep_at), _fmt(event_time), PHASE_ASLEEP)
                    )
                segment_start = event_time
                state = PHASE_AWAKE
            sleep_at = max(sleep_at, event_time + latency)
        elif state == PHASE_ASLEEP:
            if event_time > segment_start:
                raw_phases.append(
                    SleepPhase(_fmt(segment_start), _fmt(event_time), PHASE_ASLEEP)
                )
            segment_start = event_time
            state = PHASE_AWAKE
            sleep_at = max(sleep_at, event_time + latency)

    # Close out remaining time
    if state == PHASE_AWAKE:
        if sleep_at < end_dt:
            if sleep_at > segment_start:
                raw_phases.append(
                    SleepPhase(_fmt(segment_start), _fmt(sleep_at), PHASE_AWAKE)
                )
            raw_phases.append(
                SleepPhase(_fmt(sleep_at), _fmt(end_dt), PHASE_ASLEEP)
            )
        else:
            if end_dt > segment_start:
                raw_phases.append(
                    SleepPhase(_fmt(segment_start), _fmt(end_dt), PHASE_AWAKE)
                )
    elif state == PHASE_ASLEEP:
        if end_dt > segment_start:
            raw_phases.append(
                SleepPhase(_fmt(segment_start), _fmt(end_dt), PHASE_ASLEEP)
            )

    # Coalesce any same-state neighbors (defensive — shouldn't happen, but
    # ensures the bipartite invariant holds for downstream code).
    return _coalesce(raw_phases)


def _coalesce(phases: list[SleepPhase]) -> list[SleepPhase]:
    """Merge any adjacent same-state phases. Drops zero-length phases."""
    result: list[SleepPhase] = []
    for p in phases:
        if p.start == p.end:
            continue
        if result and result[-1].state == p.state and result[-1].end == p.start:
            result[-1] = SleepPhase(result[-1].start, p.end, p.state)
        else:
            result.append(p)
    return result


def compute_stats(
    phases: list[SleepPhase],
    started_at: str,
    ended_at: str,
) -> dict:
    """Compute sleep statistics from materialized phases.

    Returns dict with the new metric set:
    - time_in_bed_minutes: full session duration
    - sleep_period_minutes: from first asleep start to last asleep end
    - total_sleep_minutes: sum of asleep phase durations
    - total_awake_minutes: sum of awake phase durations
    - sleep_efficiency: total_sleep / sleep_period (clinical PSG definition)
    - time_to_fall_asleep_minutes: start to first asleep
    - time_before_getting_up_minutes: last asleep end to session end
    - awakenings: count of awake phases sandwiched between asleep phases
    """
    start_dt = _parse(started_at)
    end_dt = _parse(ended_at)
    time_in_bed_minutes = (end_dt - start_dt).total_seconds() / 60

    sleep_minutes = 0.0
    awake_minutes = 0.0
    first_asleep_start: datetime | None = None
    last_asleep_end: datetime | None = None

    for p in phases:
        duration = (_parse(p.end) - _parse(p.start)).total_seconds() / 60
        if p.state == PHASE_ASLEEP:
            sleep_minutes += duration
            if first_asleep_start is None:
                first_asleep_start = _parse(p.start)
            last_asleep_end = _parse(p.end)
        else:
            awake_minutes += duration

    if first_asleep_start is not None and last_asleep_end is not None:
        sleep_period_minutes = (
            last_asleep_end - first_asleep_start
        ).total_seconds() / 60
        time_to_fall_asleep = (first_asleep_start - start_dt).total_seconds() / 60
        time_before_getting_up = (end_dt - last_asleep_end).total_seconds() / 60
        sleep_efficiency = (
            sleep_minutes / sleep_period_minutes if sleep_period_minutes > 0 else 0.0
        )
    else:
        sleep_period_minutes = 0.0
        time_to_fall_asleep = time_in_bed_minutes
        time_before_getting_up = 0.0
        sleep_efficiency = 0.0

    # Awakenings = awake phases sandwiched between two asleep phases
    awakenings = 0
    for idx, p in enumerate(phases):
        if p.state != PHASE_AWAKE:
            continue
        prev_asleep = idx > 0 and phases[idx - 1].state == PHASE_ASLEEP
        next_asleep = idx < len(phases) - 1 and phases[idx + 1].state == PHASE_ASLEEP
        if prev_asleep and next_asleep:
            awakenings += 1

    return {
        "time_in_bed_minutes": round(time_in_bed_minutes, 1),
        "sleep_period_minutes": round(sleep_period_minutes, 1),
        "total_sleep_minutes": round(sleep_minutes, 1),
        "total_awake_minutes": round(awake_minutes, 1),
        "sleep_efficiency": round(sleep_efficiency, 3),
        "time_to_fall_asleep_minutes": round(time_to_fall_asleep, 1),
        "time_before_getting_up_minutes": round(time_before_getting_up, 1),
        "awakenings": awakenings,
    }


# --- Phase edit operations ---
#
# These all preserve the bipartite invariant: phases strictly alternate
# between awake and asleep, with no zero-length phases.


def delete_phase(
    phases: list[SleepPhase],
    index: int,
    session_started_at: str,
    session_ended_at: str,
) -> list[SleepPhase]:
    """Delete the phase at index. Merges neighbors if both exist (which by
    bipartite invariant are the same opposite-state, so they collapse into
    one phase). If first/last, the remaining neighbor extends to cover the
    session boundary."""
    if index < 0 or index >= len(phases):
        raise ValueError(f"Invalid phase index: {index}")
    if len(phases) == 1:
        raise ValueError("Cannot delete the only phase")

    new_phases = list(phases)
    if index == 0:
        # Deleting first phase: next phase extends back to session start
        right = new_phases[1]
        new_phases[1] = SleepPhase(session_started_at, right.end, right.state)
        new_phases.pop(0)
    elif index == len(new_phases) - 1:
        # Deleting last phase: previous phase extends to session end
        left = new_phases[index - 1]
        new_phases[index - 1] = SleepPhase(left.start, session_ended_at, left.state)
        new_phases.pop(index)
    else:
        # Middle: collapse left + deleted + right into one phase (left state)
        left = new_phases[index - 1]
        right = new_phases[index + 1]
        # By invariant, left.state == right.state
        merged = SleepPhase(left.start, right.end, left.state)
        new_phases[index - 1 : index + 2] = [merged]

    return new_phases


def split_phase(
    phases: list[SleepPhase],
    index: int,
    at_timestamp: str,
    wedge_minutes: float = 1.0,
) -> list[SleepPhase]:
    """Split phase[index] by inserting an opposite-state wedge centered at
    at_timestamp. Produces three phases of states [orig, opposite, orig]."""
    if index < 0 or index >= len(phases):
        raise ValueError(f"Invalid phase index: {index}")

    orig = phases[index]
    orig_start = _parse(orig.start)
    orig_end = _parse(orig.end)
    at_dt = _parse(at_timestamp)

    if at_dt <= orig_start or at_dt >= orig_end:
        raise ValueError("Split point must be strictly inside the phase")

    half_wedge = timedelta(minutes=wedge_minutes / 2)
    wedge_start = at_dt - half_wedge
    wedge_end = at_dt + half_wedge

    # Clamp the wedge so it stays strictly inside the phase
    min_gap = timedelta(seconds=1)
    if wedge_start <= orig_start:
        wedge_start = orig_start + min_gap
    if wedge_end >= orig_end:
        wedge_end = orig_end - min_gap
    if wedge_start >= wedge_end:
        # Phase too small to split with this wedge
        raise ValueError("Phase too small to split with this wedge size")

    opposite = PHASE_ASLEEP if orig.state == PHASE_AWAKE else PHASE_AWAKE
    new_phases = list(phases)
    new_phases[index : index + 1] = [
        SleepPhase(orig.start, _fmt(wedge_start), orig.state),
        SleepPhase(_fmt(wedge_start), _fmt(wedge_end), opposite),
        SleepPhase(_fmt(wedge_end), orig.end, orig.state),
    ]
    return new_phases


def adjust_phase_boundary(
    phases: list[SleepPhase],
    after_index: int,
    new_time: str,
) -> list[SleepPhase]:
    """Move the boundary that comes after phase[after_index] to new_time.

    The boundary is the shared timestamp phases[after_index].end ==
    phases[after_index + 1].start. Both are updated.
    """
    if after_index < 0 or after_index >= len(phases) - 1:
        raise ValueError(f"Invalid boundary index: {after_index}")

    left = phases[after_index]
    right = phases[after_index + 1]
    new_dt = _parse(new_time)
    left_start = _parse(left.start)
    right_end = _parse(right.end)

    if new_dt <= left_start or new_dt >= right_end:
        raise ValueError("New boundary must be strictly between adjacent phase bounds")

    new_phases = list(phases)
    new_phases[after_index] = SleepPhase(left.start, _fmt(new_dt), left.state)
    new_phases[after_index + 1] = SleepPhase(_fmt(new_dt), right.end, right.state)
    return new_phases
