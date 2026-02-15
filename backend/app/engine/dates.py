"""Date utility functions for the ResearchOS scheduling engine.

Handles weekend-aware date arithmetic: resolving weekend conflicts,
computing end dates that skip weekends, and adding business days.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional


def resolve_weekend(d: date, weekend_active: bool) -> date:
    """If weekends are inactive and date falls on Sat/Sun, push to next Monday.

    Args:
        d: The date to check.
        weekend_active: If True, weekends are valid work days (no adjustment).

    Returns:
        The original date if weekend_active or weekday, else next Monday.
    """
    if weekend_active:
        return d
    weekday = d.weekday()  # 0=Mon, 5=Sat, 6=Sun
    if weekday == 5:  # Saturday
        return d + timedelta(days=2)
    if weekday == 6:  # Sunday
        return d + timedelta(days=1)
    return d


def is_weekend_active_for_task(
    task_weekend_override: bool | None, project_weekend_active: bool
) -> bool:
    """Determine effective weekend_active setting for a task.

    Task-level override takes precedence; if None, falls back to project setting.
    """
    if task_weekend_override is not None:
        return task_weekend_override
    return project_weekend_active


def compute_end_date(start_date: date, duration_days: int, weekend_active: bool) -> date:
    """Compute the end date of a task given start + duration, respecting weekends.

    Duration is in *working* days when weekends are off.
    A 1-day task starts and ends on the same day.

    Args:
        start_date: First day of the task.
        duration_days: Number of working days the task spans.
        weekend_active: Whether weekends count as working days.

    Returns:
        The last day of the task.
    """
    if duration_days < 1:
        raise ValueError("duration_days must be >= 1")

    if weekend_active:
        return start_date + timedelta(days=duration_days - 1)

    # Skip weekends: count only Mon-Fri
    current = start_date
    remaining = duration_days - 1  # start_date is day 1
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:  # Mon-Fri
            remaining -= 1
    return current


def add_business_days(start: date, days: int, weekend_active: bool) -> date:
    """Add N business days to a date. If weekend_active, just add calendar days.

    Args:
        start: Starting date.
        days: Number of days to add (can be 0).
        weekend_active: Whether weekends count.

    Returns:
        The resulting date.
    """
    if weekend_active or days == 0:
        return start + timedelta(days=days)

    current = start
    remaining = days
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current
