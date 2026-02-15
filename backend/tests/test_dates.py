"""Unit tests for the date utility functions.

These tests do NOT require a database — they test pure date arithmetic.
"""

from datetime import date

import pytest

from app.engine.dates import (
    add_business_days,
    compute_end_date,
    is_weekend_active_for_task,
    resolve_weekend,
)


# ── resolve_weekend ───────────────────────────────────────────────────────────


class TestResolveWeekend:
    def test_weekday_unchanged(self):
        """Monday stays Monday when weekends are off."""
        d = date(2026, 2, 9)  # Monday
        assert resolve_weekend(d, weekend_active=False) == d

    def test_saturday_pushed_to_monday(self):
        """Saturday → next Monday when weekends are off."""
        sat = date(2026, 2, 14)  # Saturday
        assert sat.weekday() == 5
        result = resolve_weekend(sat, weekend_active=False)
        assert result == date(2026, 2, 16)  # Monday
        assert result.weekday() == 0

    def test_sunday_pushed_to_monday(self):
        """Sunday → next Monday when weekends are off."""
        sun = date(2026, 2, 15)  # Sunday
        assert sun.weekday() == 6
        result = resolve_weekend(sun, weekend_active=False)
        assert result == date(2026, 2, 16)  # Monday

    def test_weekend_active_saturday_unchanged(self):
        """Saturday stays Saturday when weekends are active."""
        sat = date(2026, 2, 14)
        assert resolve_weekend(sat, weekend_active=True) == sat

    def test_weekend_active_sunday_unchanged(self):
        """Sunday stays Sunday when weekends are active."""
        sun = date(2026, 2, 15)
        assert resolve_weekend(sun, weekend_active=True) == sun

    def test_friday_unchanged(self):
        """Friday stays Friday regardless."""
        fri = date(2026, 2, 13)  # Friday
        assert resolve_weekend(fri, weekend_active=False) == fri
        assert resolve_weekend(fri, weekend_active=True) == fri


# ── is_weekend_active_for_task ────────────────────────────────────────────────


class TestIsWeekendActiveForTask:
    def test_override_true(self):
        assert is_weekend_active_for_task(True, False) is True

    def test_override_false(self):
        assert is_weekend_active_for_task(False, True) is False

    def test_override_none_falls_back_to_project_true(self):
        assert is_weekend_active_for_task(None, True) is True

    def test_override_none_falls_back_to_project_false(self):
        assert is_weekend_active_for_task(None, False) is False


# ── compute_end_date ──────────────────────────────────────────────────────────


class TestComputeEndDate:
    def test_one_day_task(self):
        """1-day task starts and ends on the same day."""
        mon = date(2026, 2, 9)  # Monday
        assert compute_end_date(mon, 1, weekend_active=True) == mon
        assert compute_end_date(mon, 1, weekend_active=False) == mon

    def test_five_day_task_weekends_active(self):
        """5-day task with weekends active: Mon → Fri (calendar days)."""
        mon = date(2026, 2, 9)
        assert compute_end_date(mon, 5, weekend_active=True) == date(2026, 2, 13)

    def test_five_day_task_weekends_off(self):
        """5-day task with weekends off: Mon → Fri (skipping Sat/Sun)."""
        mon = date(2026, 2, 9)  # Monday
        result = compute_end_date(mon, 5, weekend_active=False)
        assert result == date(2026, 2, 13)  # Friday

    def test_seven_day_task_weekends_off(self):
        """7 business days starting Monday = ends next Wednesday."""
        mon = date(2026, 2, 9)  # Monday
        # Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) [skip Sat Sun] Mon(6) Tue(7)
        result = compute_end_date(mon, 7, weekend_active=False)
        assert result == date(2026, 2, 17)  # Tuesday

    def test_seven_day_task_weekends_active(self):
        """7 calendar days starting Monday = Sunday."""
        mon = date(2026, 2, 9)
        result = compute_end_date(mon, 7, weekend_active=True)
        assert result == date(2026, 2, 15)  # Sunday

    def test_ten_day_task_weekends_off(self):
        """10 business days = 2 full weeks Mon-Fri."""
        mon = date(2026, 2, 9)
        result = compute_end_date(mon, 10, weekend_active=False)
        assert result == date(2026, 2, 20)  # Friday of next week

    def test_invalid_duration_raises(self):
        with pytest.raises(ValueError):
            compute_end_date(date(2026, 2, 9), 0, weekend_active=True)

    def test_start_on_wednesday_three_days_weekends_off(self):
        """Wed + 3 business days = Fri."""
        wed = date(2026, 2, 11)  # Wednesday
        result = compute_end_date(wed, 3, weekend_active=False)
        assert result == date(2026, 2, 13)  # Friday

    def test_start_on_thursday_three_days_weekends_off(self):
        """Thu + 3 business days = Mon (skips weekend)."""
        thu = date(2026, 2, 12)  # Thursday
        # Thu(1) Fri(2) [skip Sat Sun] Mon(3)
        result = compute_end_date(thu, 3, weekend_active=False)
        assert result == date(2026, 2, 16)  # Monday


# ── add_business_days ─────────────────────────────────────────────────────────


class TestAddBusinessDays:
    def test_zero_days(self):
        mon = date(2026, 2, 9)
        assert add_business_days(mon, 0, weekend_active=False) == mon

    def test_add_one_business_day_from_friday(self):
        """Friday + 1 business day = Monday."""
        fri = date(2026, 2, 13)
        result = add_business_days(fri, 1, weekend_active=False)
        assert result == date(2026, 2, 16)  # Monday

    def test_add_five_business_days(self):
        """Monday + 5 business days = Monday next week."""
        mon = date(2026, 2, 9)
        result = add_business_days(mon, 5, weekend_active=False)
        assert result == date(2026, 2, 16)  # Monday

    def test_add_days_weekend_active(self):
        """With weekends active, just add calendar days."""
        mon = date(2026, 2, 9)
        result = add_business_days(mon, 5, weekend_active=True)
        assert result == date(2026, 2, 14)  # Saturday
