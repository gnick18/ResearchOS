"""High-Level Goals API routes."""

from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException

from app.schemas import (
    HighLevelGoalCreate,
    HighLevelGoalUpdate,
    HighLevelGoalOut,
    SmartGoal,
)
from app.storage import goals_store

router = APIRouter(prefix="/goals", tags=["goals"])


def compute_goal_end_date(goal_data: dict) -> str:
    """Compute end_date from start_date and duration or return existing end_date."""
    return goal_data.get("end_date", goal_data.get("start_date"))


@router.get("/", response_model=List[HighLevelGoalOut])
def list_goals():
    """List all high-level goals."""
    goals = goals_store.list_all()
    result = []
    for g in goals:
        g["end_date"] = compute_goal_end_date(g)
        result.append(g)
    return result


@router.get("/{goal_id}", response_model=HighLevelGoalOut)
def get_goal(goal_id: int):
    """Get a specific high-level goal."""
    goal = goals_store.get(goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    goal["end_date"] = compute_goal_end_date(goal)
    return goal


@router.post("/", response_model=HighLevelGoalOut)
def create_goal(goal: HighLevelGoalCreate):
    """Create a new high-level goal."""
    data = goal.model_dump()
    data["created_at"] = datetime.now()
    data["is_complete"] = False
    if data.get("smart_goals") is None:
        data["smart_goals"] = []
    result = goals_store.create(data)
    result["end_date"] = compute_goal_end_date(result)
    return result


@router.patch("/{goal_id}", response_model=HighLevelGoalOut)
def update_goal(goal_id: int, goal: HighLevelGoalUpdate):
    """Update a high-level goal."""
    existing = goals_store.get(goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    update_data = {k: v for k, v in goal.model_dump().items() if v is not None}
    
    # Check if all SMART goals are complete to mark the goal as complete
    if "smart_goals" in update_data and update_data["smart_goals"]:
        all_complete = all(sg.get("is_complete", False) for sg in update_data["smart_goals"])
        if all_complete and len(update_data["smart_goals"]) > 0:
            update_data["is_complete"] = True
    
    result = goals_store.update(goal_id, update_data)
    result["end_date"] = compute_goal_end_date(result)
    return result


@router.delete("/{goal_id}")
def delete_goal(goal_id: int):
    """Delete a high-level goal."""
    success = goals_store.delete(goal_id)
    if not success:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"ok": True}


@router.post("/{goal_id}/smart-goals", response_model=HighLevelGoalOut)
def add_smart_goal(goal_id: int, smart_goal: SmartGoal):
    """Add a SMART sub-goal to a high-level goal."""
    existing = goals_store.get(goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    smart_goals = existing.get("smart_goals", [])
    smart_goals.append(smart_goal.model_dump())
    
    result = goals_store.update(goal_id, {"smart_goals": smart_goals})
    result["end_date"] = compute_goal_end_date(result)
    return result


@router.patch("/{goal_id}/smart-goals/{smart_goal_id}", response_model=HighLevelGoalOut)
def toggle_smart_goal(goal_id: int, smart_goal_id: str, is_complete: bool = True):
    """Toggle a SMART sub-goal's completion status."""
    existing = goals_store.get(goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    smart_goals = existing.get("smart_goals", [])
    found = False
    for sg in smart_goals:
        if sg.get("id") == smart_goal_id:
            sg["is_complete"] = is_complete
            found = True
            break
    
    if not found:
        raise HTTPException(status_code=404, detail="SMART goal not found")
    
    # Check if all SMART goals are complete
    all_complete = all(sg.get("is_complete", False) for sg in smart_goals)
    
    result = goals_store.update(goal_id, {
        "smart_goals": smart_goals,
        "is_complete": all_complete
    })
    result["end_date"] = compute_goal_end_date(result)
    return result


@router.delete("/{goal_id}/smart-goals/{smart_goal_id}", response_model=HighLevelGoalOut)
def delete_smart_goal(goal_id: int, smart_goal_id: str):
    """Delete a SMART sub-goal from a high-level goal."""
    existing = goals_store.get(goal_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    smart_goals = existing.get("smart_goals", [])
    smart_goals = [sg for sg in smart_goals if sg.get("id") != smart_goal_id]
    
    result = goals_store.update(goal_id, {"smart_goals": smart_goals})
    result["end_date"] = compute_goal_end_date(result)
    return result
