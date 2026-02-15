We need to establish the a webapp with: The ability to create a research project, add a task with a dependency, and see it reflected on a 2D GANTT timeline.
Core Priorities for the Initial Build:
1.	Recursive Date Engine: The most critical feature is the Python backend logic. If I move a parent task, all children must shift. We must respect the 'Weekend Active' toggle—if a project is not weekend-active, shifted tasks must automatically land on the following Monday.
2.	The Sidebar Tree: Implement the drag-and-drop 'Snapping Logic' (Top 25%/Mid 50%/Bottom 25%) to define Finish-to-Start or Start-with-Start relationships.
3.	Database Integration: Use Neon (PostgreSQL) for task metadata and dependencies.
4.	Vibe-Coded UI: Use Tailwind CSS for a clean, minimalistic 'Modern Lab' aesthetic. No clutter.
Technical Constraints:
•	Use FastAPI for the backend.
•	Use Vercel for hosting.
•	Use the GitHub API for the Methods and Results storage (as specified in the doc).
Please start by:
1.	Reviewing the attached spec.
2.	Proposing the Neon Database schema SQL based on the research_os_spec.md.
3.	Outlining the Python function for the recursive date-shifting logic.
Do not build the UI until we confirm the backend logic for the dependency shifts works perfectly. Let’s get to work."
 
A Few "Pro-Tips" for the Build:
•	The "Brain" First: Coding agents often get distracted by making buttons look pretty. By forcing it to show you the SQL schema and the Python shift logic first, you ensure the app actually works for a complex research timeline.
•	The Weekend Logic: This is the hardest part to code later. Make sure the agent accounts for it in the very first version of the shift_task function.
•	The Snapping UI: If the agent struggles with the "Top 25% / Bottom 25%" logic, tell it to use onMouseMove to calculate the $Y$ coordinates of the target element and divide the height by 4.
