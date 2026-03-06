# ResearchOS

A research project management application with smart GANTT scheduling, automatic git-based data synchronization, and intuitive task tracking.

![ResearchOS](https://img.shields.io/badge/version-0.2.0-blue)

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

## Installation

### Option 1: Easy Installer (Recommended)

Download the installer for your platform and run it. The installer will:
- Check for required dependencies (Python, Node.js, Git)
- Automatically install any missing dependencies
- Set up ResearchOS and create a desktop shortcut

**Downloads:**
- **macOS**: Download `researchos-installer-darwin-arm64-x.x.x.zip` from the [Releases](releases) page
- **Windows**: Download `ResearchOSInstallerSetup.exe` from the [Releases](releases) page

After installation, launch ResearchOS from your desktop shortcut or Applications folder.

### Option 2: Manual Installation

If you prefer to install manually or are a developer, follow these steps:

#### Prerequisites

| Requirement | Version | Where to Get It |
|-------------|---------|-----------------|
| **Python** | 3.10+ | [python.org/downloads](https://www.python.org/downloads/) |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Git** | Any | [git-scm.com/downloads](https://git-scm.com/downloads) |
| **GitHub Account** | Free | [github.com/signup](https://github.com/signup) |

#### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gnick18/ResearchOS.git
   cd ResearchOS
   ```

2. **Install dependencies:**
   ```bash
   # Backend
   cd backend
   pip install -r requirements.txt
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Run the application:**
   
   **macOS/Linux:**
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
   
   **Windows:**
   ```powershell
   .\start.ps1
   ```

4. **Access the app:** Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## First-Time Setup

When you first launch ResearchOS, you'll need to configure it:

### 1. Create a Private Data Repository

ResearchOS stores your data in your own private GitHub repository:

1. Go to [GitHub](https://github.com/new) and create a new repository
2. Name it `ResearchOS` (or any name you prefer)
3. Set it to **Private**
4. Leave it empty (don't initialize with README)

### 2. Create a GitHub Personal Access Token

1. Go to [GitHub Settings > Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a name (e.g., "ResearchOS")
4. Select the `repo` scope
5. Click "Generate token" and copy it

### 3. Configure ResearchOS

1. Click the **Settings** button (gear icon) in ResearchOS
2. Enter:
   - **GitHub Token**: Your personal access token
   - **Data Repository**: Your private repo name (e.g., `username/ResearchOS`)
   - **Local Path**: Where to store data locally

That's it! ResearchOS will automatically save your research data to GitHub.

---

## How Data Storage Works

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

**Why two repositories?**
- **Privacy**: Your research data stays private
- **Backup**: Every change is automatically saved to GitHub
- **Version History**: You can see and revert any change
- **Collaboration**: Share your data repo with lab members

---

## Project Structure

```
ResearchOS/
├── backend/                 # FastAPI Python backend
│   ├── app/
│   │   ├── main.py         # Application entry point
│   │   ├── config.py       # Settings configuration
│   │   ├── git_sync.py     # Auto git commit/push
│   │   ├── storage.py      # JSON file storage
│   │   ├── routers/        # API endpoints
│   │   └── engine/         # Scheduling engine
│   └── requirements.txt
├── frontend/               # Next.js React frontend
│   ├── src/
│   │   ├── app/           # Pages
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities and API
│   └── package.json
├── installer/              # Electron-based smart installer
│   ├── src/
│   │   ├── main.js        # Installer logic
│   │   ├── preload.js     # IPC bridge
│   │   └── renderer/      # UI components
│   └── package.json
├── start.sh               # Start script (macOS/Linux)
└── start.ps1              # Start script (Windows)
```

---

## Building the Installer

To build distributable installers:

```bash
cd installer
npm install
npm run make
```

The output will be in `installer/out/make/`.

---

## Troubleshooting

### "Data repo path does not exist"
Ensure the local path in Settings points to a valid directory.

### "git push failed"
1. Check that your GitHub token is valid and has `repo` scope
2. Ensure you have push access to the repository

### "Port already in use"
The start script automatically kills processes on ports 8000 and 3000. If issues persist:

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
Access interactive API docs at [http://localhost:8000/docs](http://localhost:8000/docs) when the backend is running.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Support

If you encounter any issues or have questions, please open an issue on GitHub.
