"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { labApi, usersApi, LabUser, LabTask, LabProject } from "@/lib/api";
import type { Task, Dependency, Project, HighLevelGoal } from "@/lib/types";
import LabUserFilterButton from "@/components/LabUserFilterButton";
import LabSearchPanel from "@/components/LabSearchPanel";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import LabGanttChart from "@/components/LabGanttChart";
import LabPurchasesPanel from "@/components/LabPurchasesPanel";
import LabExperimentsPanel from "@/components/LabExperimentsPanel";
import NotesPanel from "@/components/NotesPanel";

// Helper function to convert LabTask to Task type for the popup
function labTaskToTask(labTask: LabTask): Task {
  return {
    id: labTask.id,
    project_id: labTask.project_id,
    name: labTask.name,
    start_date: labTask.start_date,
    duration_days: labTask.duration_days,
    end_date: labTask.end_date,
    is_high_level: false,
    is_complete: labTask.is_complete,
    task_type: labTask.task_type as "experiment" | "purchase" | "list",
    weekend_override: null,
    method_id: labTask.method_ids?.[0] || null,
    method_ids: labTask.method_ids || [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: labTask.experiment_color,
    sub_tasks: null,
    pcr_gradient: null,
    pcr_ingredients: null,
    method_attachments: (labTask.method_ids || []).map((methodId) => ({
      method_id: methodId,
      pcr_gradient: null,
      pcr_ingredients: null,
      variation_notes: null,
    })),
    // Sharing fields - in lab mode, the owner is the user whose data we're viewing
    owner: labTask.username,
    shared_with: [],
    inherited_from_project: null,
  };
}

type TabType = "gantt" | "experiments" | "purchases" | "notes" | "search";

export default function LabModePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<LabUser[]>([]);
  const [tasks, setTasks] = useState<LabTask[]>([]);
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("gantt");
  const [selectedTask, setSelectedTask] = useState<LabTask | null>(null);

  // Load all data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load users first
      const usersResponse = await labApi.getUsers();
      setUsers(usersResponse.users);
      
      // Select all users by default
      const allUsernames = new Set(usersResponse.users.map(u => u.username));
      setSelectedUsers(allUsernames);
      
      // Load tasks and projects
      const [tasksResponse, projectsResponse] = await Promise.all([
        labApi.getTasks({ exclude_goals: true, exclude_lists: false }), // Include lists for search
        labApi.getProjects(),
      ]);
      
      console.log("Loaded tasks:", tasksResponse);
      console.log("Loaded users:", usersResponse.users);
      console.log("Loaded projects:", projectsResponse);
      console.log("Task details - first 3 tasks:", tasksResponse.slice(0, 3).map((t: LabTask) => ({
        id: t.id,
        name: t.name,
        username: t.username,
        task_type: t.task_type,
        start_date: t.start_date,
        end_date: t.end_date,
      })));
      
      setTasks(tasksResponse);
      setProjects(projectsResponse);
    } catch (err) {
      console.error("Failed to load lab data:", err);
      setError("Failed to load data. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // Filter data by selected users
  const filteredTasks = tasks.filter(t => selectedUsers.has(t.username));
  const filteredProjects = projects.filter(p => selectedUsers.has(p.username));

  // Get experiments (task_type === "experiment")
  const experiments = tasks.filter(t => 
    selectedUsers.has(t.username) && t.task_type === "experiment"
  );

  // Get purchases (task_type === "purchase")
  const purchases = tasks.filter(t => 
    selectedUsers.has(t.username) && t.task_type === "purchase"
  );



  // Toggle user selection
  const toggleUser = useCallback((username: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  }, []);

  // Select all users
  const selectAllUsers = useCallback(() => {
    setSelectedUsers(new Set(users.map(u => u.username)));
  }, [users]);

  // Deselect all users
  const deselectAllUsers = useCallback(() => {
    setSelectedUsers(new Set());
  }, []);

  // Handle logout - return to main user if set, otherwise go to login
  const handleLogout = async () => {
    try {
      // Get the main user setting
      const mainUserResponse = await usersApi.getMainUser();
      const mainUser = mainUserResponse.main_user;
      
      if (mainUser) {
        // Login as the main user
        await usersApi.login(mainUser);
        router.push("/");
      } else {
        // No main user set, logout completely
        await usersApi.logout();
        router.push("/");
      }
    } catch (err) {
      console.error("Failed to exit lab mode:", err);
      // Still redirect to home page even if there's an error
      router.push("/");
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading Lab Mode...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Lab Mode</h1>
                <p className="text-sm text-gray-500">View-only access to all researchers' work</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Exit Lab Mode
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveTab("gantt")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "gantt"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              GANTT
            </button>
            <button
              onClick={() => setActiveTab("experiments")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "experiments"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Experiments
            </button>
            <button
              onClick={() => setActiveTab("purchases")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "purchases"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Purchases
            </button>
            <button
              onClick={() => setActiveTab("notes")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "notes"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Notes
            </button>
            <button
              onClick={() => setActiveTab("search")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === "search"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Bar - shown on all tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <p className="text-gray-500 text-sm">Users</p>
            <p className="text-2xl font-bold text-gray-900">{users.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <p className="text-gray-500 text-sm">Projects</p>
            <p className="text-2xl font-bold text-gray-900">{filteredProjects.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <p className="text-gray-500 text-sm">Experiments</p>
            <p className="text-2xl font-bold text-blue-600">{experiments.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <p className="text-gray-500 text-sm">Purchases</p>
            <p className="text-2xl font-bold text-amber-600">{purchases.length}</p>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "search" ? (
          <LabSearchPanel
            users={users}
            selectedUsernames={selectedUsers}
            tasks={tasks}
            onTaskClick={setSelectedTask}
          />
        ) : activeTab === "gantt" ? (
          <LabGanttChart
            tasks={tasks}
            users={users}
            projects={projects}
            selectedUsernames={selectedUsers}
            onTaskClick={(task) => setSelectedTask(task)}
          />
        ) : activeTab === "experiments" ? (
          <LabExperimentsPanel
            experiments={experiments}
            users={users}
            projects={projects}
            selectedUsernames={selectedUsers}
            onExperimentClick={setSelectedTask}
          />
        ) : activeTab === "purchases" ? (
          <LabPurchasesPanel
            purchases={purchases}
            users={users}
            projects={projects}
            selectedUsernames={selectedUsers}
            onPurchaseClick={setSelectedTask}
          />
        ) : activeTab === "notes" ? (
          <NotesPanel
            isLabMode={true}
            selectedUsernames={selectedUsers}
            userColors={users.reduce((acc, u) => ({ ...acc, [u.username]: u.color }), {} as Record<string, string>)}
          />
        ) : null}
      </div>

      {/* Floating User Filter Button */}
      {users.length > 0 && (
        <LabUserFilterButton
          users={users}
          selectedUsernames={selectedUsers}
          onToggleUser={toggleUser}
          onSelectAll={selectAllUsers}
          onDeselectAll={deselectAllUsers}
        />
      )}

      {/* Task Detail Popup */}
      {selectedTask && (
        <TaskDetailPopup
          task={labTaskToTask(selectedTask)}
          onClose={() => setSelectedTask(null)}
          readOnly={true}
          username={selectedTask.username}
        />
      )}
    </div>
  );
}
