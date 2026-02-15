1. Project Overview
ResearchOS is a specialized, minimalist project management webtool designed for postdoc researchers. It prioritizes the "messy reality" of lab work, including shifting timelines, protocol deviations, and the need for a permanent, version-controlled archive of results.
Tech Stack
•	Backend: Python (FastAPI)
•	Frontend: JavaScript / Tailwind CSS
•	Database: Neon (Postgres) — Handles all task, project, and dependency metadata.
•	Storage: GitHub — Primary archive for Markdown (.md) protocols, result notes, and image assets.
•	Hosting: Vercel
 
2. Core Functional Modules
A. Project & Task Management
•	Project Types: Users can define multiple research projects, each with a custom name and a set of global metadata tags (e.g., #sequencing, #LC-MS).
•	Task Metadata: Name, Expected Duration (days), Start Date, Status (Todo/Done), and Associated Method.
•	High-Level Goals: Specialized tasks that span weeks or months. Displayed with semi-transparent styling at the top of the project axis to provide context for granular tasks.
•	The "Replicate" Multiplier: Ability to "Duplicate with Offset" or "Batch Create" tasks. Allows instant generation of $N$ replicates from a single template task.
B. Smart Dependency & GANTT Engine
•	Dependency Types: * Finish-to-Start (FS): Task B starts after Task A ends.
o	Start-with-Start (SS): Task B starts alongside Task A.
o	Start-to-Finish (SF): Task B ends when Task A starts.
•	Recursive Shifting: If a parent task is delayed, all dependent tasks must shift automatically.
•	The Weekend Logic: * Toggle: Each project has a "7-day/Weekend Active" setting.
o	Constraint: If OFF, any automated shift that lands a start/end date on a Saturday or Sunday is automatically pushed to the following Monday.
•	Bulk-Move Modal: Moving a task with children triggers a confirmation: "This move affects X dependent tasks. Shift all? [Confirm/Cancel]"
C. The Sidebar Tree & Snapping Logic
•	Nested Tree View: A scrollable sidebar displaying tasks in a hierarchical structure.
•	Drag-and-Drop Interaction:
o	Top 25% of Target: Snaps as FS (New task before target).
o	Middle 50% of Target: Snaps as SS (New task concurrent with target).
o	Bottom 25% of Target: Snaps as FS (New task after target).
D. Scientific ELN & Method Library
•	Protocol Evolution: * Tasks can link to a Method (stored as .md on GitHub).
o	Users can "Note Deviations" during a run.
o	Upon completion, users can:
1.	Save deviations only to the Task Result File.
2.	Fork Method: Save as a new .md file which becomes a child of the original in the sidebar hierarchy.
•	Results Subpage: Tasks marked as "Major Results" unlock a Markdown editor with image drag-and-drop support.
•	Quick View: Markdown files (Methods/Results) open in a minimalist internal modal preview instead of redirecting to GitHub.
 
3. Database Schema (Neon Postgres)
SQL
CREATE TABLE projects (
	id SERIAL PRIMARY KEY,
	name TEXT NOT NULL,
	weekend_active BOOLEAN DEFAULT FALSE,
	tags TEXT[], -- Array of metadata tags
	created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tasks (
	id SERIAL PRIMARY KEY,
	project_id INTEGER REFERENCES projects(id),
	name TEXT NOT NULL,
	start_date DATE NOT NULL,
	duration_days INTEGER NOT NULL,
	is_high_level BOOLEAN DEFAULT FALSE,
	is_complete BOOLEAN DEFAULT FALSE,
	method_id INTEGER, -- Optional link to method
	deviation_log TEXT,
	tags TEXT[]
);

CREATE TABLE dependencies (
	id SERIAL PRIMARY KEY,
	parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
	child_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
	dep_type TEXT CHECK (dep_type IN ('FS', 'SS', 'SF'))
);

CREATE TABLE methods (
	id SERIAL PRIMARY KEY,
	name TEXT NOT NULL,
	parent_method_id INTEGER REFERENCES methods(id), -- For protocol forking
	github_path TEXT NOT NULL,
	folder_path TEXT -- For organization
);
 
4. UI/UX Guidelines
•	Aesthetic: Clean, ultra-minimalist, white-space heavy.
•	Colors: Soft grays for borders; project-specific colors for GANTT bars.
•	Feedback: "Green-to-Gold" gradient pulse when a task is marked complete.
•	Navigation: Multi-select project/tag pills at the top to filter the entire view.
•	Archive View: A calendar interface allowing users to scroll back through old GANTT snapshots and completed experimental results.
 
5. Implementation Priorities for Agent
1.	Backend Date Engine: Create the recursive Python function to handle shifting dates while respecting the weekend_active constraint.
2.	GitHub Proxy: Build the FastAPI bridge to commit Markdown and images to the repo using a Personal Access Token.
3.	The Tree & GANTT: Develop the sidebar tree and the 2D timeline simultaneously to ensure data parity.


---- Other features I want
-  The calendar page should also have the abillity to filter different projects being displayed as should the GANNT chart 2D viewer
-  Seperate from the GANNT view I want a calendar page that shows a normal month calendar view with all of the tasks on it. I should be able to add new tasks by double clicking on the calendar on specific days AND there should also be a + on the top right of the calendar that will open a new task creation modal.

IN RESPONSE TO THESE QUESTIONS:
Weekend Override: Should individual tasks be able to override the project's weekend_active setting?

SF Dependency: For Start-to-Finish dependencies, should the child task's end date be allowed to shift into the past (before today)?

Method Forking: When forking a method, should the new method inherit the parent's tags automatically?

GANTT Default View: What date range should be shown by default - current month, project start to estimated end, or something else?

1. Yes
2. Yes but make a popup if this is going to happen and confirm with the user that a task is getting shift into past. Lets also add a feature that displays all of the overdue tasks in the clean summary on the homepage, and another feature that displays the days tasks on the homepage (seperate from overdue tasks to keep things less clutered)
3. Yes
4. The GANNT default view should be 3 months, But there should be buttons for 1 week, 2 weeks, 1 month, 3 months, 6 months, 1 year, and all time. And the axis will just keep zooming out and show all projects. Each project should be its own row that is displays. 

