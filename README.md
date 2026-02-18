# ResearchOS

A research project management application with smart GANTT scheduling, automatic git-based data synchronization, and intuitive task tracking.

![ResearchOS](https://img.shields.io/badge/version-0.2.0-blue)

---

## What You'll Need

Before starting, make sure you have the following:

| Requirement | Version | Where to Get It | Why Needed |
|-------------|---------|-----------------|------------|
| **GitHub Account** | Free | [github.com/signup](https://github.com/signup) | Stores your research data securely |
| **Python** | 3.10+ | [python.org/downloads](https://www.python.org/downloads/) | Runs the backend server |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) | Runs the frontend interface |
| **Git** | Any | [git-scm.com/downloads](https://git-scm.com/downloads) | Syncs data to GitHub |

> **Good news!** Docker is **NOT** required. This app runs directly on your machine with just Python and Node.js.

> **Why GitHub?** ResearchOS stores all your research data in your own private GitHub repository. This gives you automatic backups, version history, and the ability to share with collaborators.

---

## Check Your Installations

Open a terminal and run these commands to verify everything is installed:

**macOS / Linux:**
```bash
python3 --version    # Should show Python 3.10.x or higher
node --version       # Should show v18.x.x or higher
git --version        # Should show git version 2.x.x
```

**Windows (Command Prompt or PowerShell):**
```cmd
python --version     # Should show Python 3.10.x or higher
node --version       # Should show v18.x.x or higher
git --version        # Should show git version 2.x.x
```

If any command fails or shows an older version, install or update from the links in the table above.

---

## Features

- **Project Management**: Create and organize research projects with custom colors and tags
- **Smart GANTT Charts**: Automatic scheduling with dependency tracking and date shifting
- **Task Tracking**: Manage experiments, protocols, and daily tasks with progress monitoring
- **PCR Protocol Builder**: Design and manage PCR experiments with reagent calculators
- **Git-Based Storage**: All data stored in a private GitHub repository for version control and backup
- **Methods Library**: Store and reuse experimental protocols
- **Purchase Tracking**: Manage lab inventory and purchases

---

## Quick Start Guide

### Step 1: Clone This Repository

```bash
git clone https://github.com/gnick18/ResearchOS.git
cd ResearchOS
```

### Step 2: Create a Private Data Repository

This application stores all your research data in a **separate private GitHub repository**. This keeps your data secure and version-controlled.

1. Go to [GitHub](https://github.com/new) and create a new repository:
   - **Repository name**: `ResearchOS` (or any name you prefer)
   - **Visibility**: **Private** (important for data security)
   - **Do NOT** initialize with README, .gitignore, or license (keep it empty)

2. Clone your new data repository to your computer:
   ```bash
   # Replace YOUR_USERNAME with your GitHub username
   git clone https://github.com/YOUR_USERNAME/ResearchOS.git
   
   # Note the full path where you cloned it (you'll need this later)
   # Example: /Users/yourname/Desktop/ResearchOS
   ```

### Step 3: Create a GitHub Personal Access Token

The application needs a GitHub token to push changes to your data repository.

1. Go to GitHub Settings > Developer settings > Personal access tokens > **Tokens (classic)**
   - Direct link: [https://github.com/settings/tokens](https://github.com/settings/tokens)

2. Click **"Generate new token (classic)"**

3. Configure the token:
   - **Note**: `ResearchOS App`
   - **Expiration**: Choose based on your preference (90 days, 1 year, or no expiration)
   - **Select scopes**: Check the following:
     - `repo` (Full control of private repositories)

4. Click **"Generate token"**

5. **Copy the token immediately** - you won't be able to see it again!

### Step 4: Configure Environment Variables

You can configure the application in two ways:

#### Option A: Using the GUI (Recommended)

1. Start the application (see Step 5)
2. Click the **Settings** button (gear icon) in the bottom-right corner of the homepage
3. Enter your configuration:
   - **GitHub Token**: Paste your personal access token
   - **Data Repository**: Your private repo name (e.g., `YOUR_USERNAME/ResearchOS`)
   - **Local Path**: Full path to your cloned data repository

#### Option B: Manual Configuration

Create a `.env` file in the `backend/` directory:

```bash
# Navigate to backend directory
cd backend

# Create .env file
cat > .env << 'EOF'
GITHUB_TOKEN=ghp_your_token_here
GITHUB_REPO=YOUR_USERNAME/ResearchOS
GITHUB_LOCALPATH=/path/to/your/local/ResearchOS
CORS_ORIGINS=["http://localhost:3000"]
EOF
```

Replace the values:
- `GITHUB_TOKEN`: Your GitHub personal access token
- `GITHUB_REPO`: Your private repository in format `username/repo-name`
- `GITHUB_LOCALPATH`: **Absolute path** to your cloned data repository

**Example for macOS:**
```
GITHUB_TOKEN=ghp_abc123xyz...
GITHUB_REPO=jsmith/ResearchOS
GITHUB_LOCALPATH=/Users/jsmith/Desktop/ResearchOS
CORS_ORIGINS=["http://localhost:3000"]
```

**Example for Windows:**
```
GITHUB_TOKEN=ghp_abc123xyz...
GITHUB_REPO=jsmith/ResearchOS
GITHUB_LOCALPATH=C:/Users/jsmith/Desktop/ResearchOS
CORS_ORIGINS=["http://localhost:3000"]
```

### Step 5: Install Dependencies

#### Backend (Python)

```bash
cd backend
pip install -r requirements.txt
```

#### Frontend (Node.js)

```bash
cd frontend
npm install
```

### Step 6: Run the Application

#### macOS / Linux

**Option A: Using the Start Script (Recommended)**

From the project root directory:

```bash
chmod +x start.sh  # Make script executable (first time only)
./start.sh
```

This starts both the backend and frontend in one command.

**Option B: Manual Start**

Open two terminal windows:

*Terminal 1 - Backend:*
```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

*Terminal 2 - Frontend:*
```bash
cd frontend
npm run dev
```

#### Windows

**Option A: Using the PowerShell Script (Recommended)**

From the project root directory in PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned  # Allow script execution (first time only)
.\start.ps1
```

This starts both the backend and frontend in one command.

**Option B: Manual Start**

Open two PowerShell windows:

*Window 1 - Backend:*
```powershell
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

*Window 2 - Frontend:*
```powershell
cd frontend
npm run dev
```

**Option C: Using WSL (Windows Subsystem for Linux)**

If you have WSL installed, you can use the bash script:
```bash
./start.sh
```

### Step 7: Access the Application

Open your browser and navigate to:

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## How Data Storage Works

ResearchOS uses **two separate GitHub repositories**:

```
+-------------------+                    +-------------------+
|  Code Repository  |                    |  Data Repository  |
| (this one)        |                    | (you create)      |
|                   |                    |                   |
| - Application     |                    | - Your projects   |
|   source code     |                    | - Your tasks      |
| - Read-only       |                    | - Your methods    |
+-------------------+                    | - Private!        |
         |                               +-------------------+
         | Clone once                           ^
         v                                      | Auto-save
+-------------------+                            |
|  Your Computer    |----------------------------+
|                   |
| - Backend server  |
| - Frontend app    |
| - Local data copy |
+-------------------+
```

| Repository | Purpose | Visibility | Who creates it |
|------------|---------|------------|----------------|
| **Code Repository** | Contains the application code | Public | Already exists (this repo) |
| **Data Repository** | Contains YOUR research data | **Private** | You create it |

**Why two repositories?**

- **Privacy**: Your research data stays private in your own repository
- **Backup**: Every change is automatically saved to GitHub
- **Version History**: You can see and revert any change
- **Collaboration**: Share your data repo with lab members without giving them access to the code

---

## Configuration Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub Personal Access Token with `repo` scope | `ghp_abc123...` |
| `GITHUB_REPO` | Your private data repository | `username/ResearchOS` |
| `GITHUB_LOCALPATH` | Absolute path to cloned data repository | `/Users/name/ResearchOS` |
| `CORS_ORIGINS` | Allowed frontend origins | `["http://localhost:3000"]` |

---

## Project Structure

```
ResearchOS/
|-- backend/                 # FastAPI Python backend
|   |-- app/
|   |   |-- main.py         # Application entry point
|   |   |-- config.py       # Settings configuration
|   |   |-- git_sync.py     # Auto git commit/push
|   |   |-- storage.py      # JSON file storage
|   |   |-- routers/        # API endpoints
|   |   |-- engine/         # Scheduling engine
|   |   |-- schemas.py      # Data models
|   |-- requirements.txt
|   |-- .env                # Your configuration (not in git)
|-- frontend/               # Next.js React frontend
|   |-- src/
|   |   |-- app/           # Pages
|   |   |-- components/    # React components
|   |   |-- lib/           # Utilities and API
|   |-- package.json
|-- start.sh               # Start script (macOS/Linux)
|-- start.ps1              # Start script (Windows PowerShell)
|-- .env.example           # Example environment file
```

---

## How It Works

### Data Storage

All your research data (projects, tasks, methods, etc.) is stored as JSON files in your private GitHub repository. Every change you make is automatically:

1. Saved to the local JSON files
2. Committed to git
3. Pushed to your private repository

This provides:
- **Version History**: Every change is tracked
- **Backup**: Your data is safely stored on GitHub
- **Collaboration**: Share the repository with team members

### Smart Scheduling

The GANTT scheduling engine automatically:
- Shifts task dates when dependencies change
- Respects weekends (configurable per project)
- Handles task dependencies and constraints
- Calculates optimal task ordering

---

## Troubleshooting

### "Data repo path does not exist"

Ensure `GITHUB_LOCALPATH` points to the correct location of your cloned data repository. Use an absolute path.

### "git push failed"

1. Check that your `GITHUB_TOKEN` is valid and has `repo` scope
2. Ensure you have push access to the repository specified in `GITHUB_REPO`
3. Verify the data repository is properly cloned and initialized

### "CORS errors"

Make sure `CORS_ORIGINS` includes `http://localhost:3000` (or your frontend URL).

### "Port already in use"

The start script automatically kills processes on ports 8000 and 3000. If you still have issues:

```bash
# macOS/Linux
lsof -ti tcp:8000 | xargs kill -9
lsof -ti tcp:3000 | xargs kill -9

# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

---

## Development

### Running Tests

```bash
cd backend
pytest
```

### API Documentation

Access the interactive API documentation at [http://localhost:8000/docs](http://localhost:8000/docs) when the backend is running.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## Support

If you encounter any issues or have questions, please open an issue on GitHub.