# ResearchOS

A research project management application with smart GANTT scheduling, automatic git-based data synchronization, and intuitive task tracking.

![ResearchOS](https://img.shields.io/badge/version-1.0.5-blue)

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
- **macOS**: Download `researchos-installer-darwin-arm64-x.x.x.zip` from the [Releases](https://github.com/gnick18/ResearchOS/releases) page
- **Windows**: Download `researchos-installer-win32-x.x.x.zip` from the [Releases](https://github.com/gnick18/ResearchOS/releases) page

> **⚠️ macOS Security Note**: On macOS, the app may show "is damaged and can't be opened" because it's not code-signed. To fix this, open Terminal and run:
> ```bash
> xattr -cr /path/to/researchos-installer.app
> ```
> Or right-click the app and select "Open", then click "Open" again when prompted.

> **⚠️ Windows Security Note**: On Windows, the app may show a SmartScreen warning. To proceed:
> 1. Click "More info" on the warning
> 2. Click "Run anyway" to bypass the warning

For future releases, we plan to add code signing which will eliminate these warnings entirely.

### Option 2: Manual Installation

If you prefer to install manually or are a developer, follow these steps:

#### Prerequisites

| Requirement | Version | Where to Get It |
|-------------|---------|-----------------|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Chromium browser** | Recent | Chrome, Edge, or Brave — Firefox/Safari aren't supported (File System Access API) |

#### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gnick18/ResearchOS.git
   cd ResearchOS
   ```

2. **Install dependencies:**
   ```bash
   cd frontend
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

When you first launch ResearchOS, the app will ask you to pick a folder
on your computer to store research data in. Pick (or create) an empty
folder anywhere you like — Desktop, Documents, a OneDrive/Dropbox folder
if you want sync, or a folder inside a git clone if you want version
control.

The browser will prompt for read/write access to that folder. ResearchOS
keeps everything (projects, tasks, methods, notes, images) inside it as
plain JSON and markdown — no server, no cloud account required.

If multiple people share the folder (e.g. via OneDrive/Dropbox), each
person picks the same folder and selects their own username from the
login screen.

---

## How Data Storage Works

```
+-----------------------------+
|        Your Browser         |
|  (Chrome / Edge / Brave)    |
|                             |
|  ResearchOS app             |
|     |                       |
|     | File System Access    |
|     v                       |
|  Folder on your disk        |
|  - users/{username}/...     |
|  - methods/...              |
|  - results/task-{id}/...    |
+-----------------------------+
```

Everything lives in the folder you picked. To back up, sync, or share
with collaborators, point a tool you already trust (OneDrive, Dropbox,
git, rsync, Time Machine) at that folder.

---

## Project Structure

```
ResearchOS/
├── frontend/               # Next.js React app (all the code)
│   ├── src/
│   │   ├── app/           # Pages
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities, FSA layer, API replacement
│   └── package.json
├── installer/              # Electron-based smart installer
│   ├── src/
│   │   ├── main.js        # Installer logic
│   │   ├── preload.js     # IPC bridge
│   │   └── renderer/      # UI components
│   └── package.json
├── scripts/                # One-off maintenance scripts
├── start.sh                # Start script (macOS/Linux)
└── start.ps1               # Start script (Windows)
```

ResearchOS is now fully client-side: every interaction with your data
goes through the browser's File System Access API, talking to a folder
you pick on your own disk. There is no separate backend process.

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
The start script automatically kills the process on port 3000. If issues persist:

```bash
# macOS/Linux
lsof -ti tcp:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

---

## Development

### Running Tests
```bash
cd frontend
npm test
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Support

If you encounter any issues or have questions, please open an issue on GitHub.
