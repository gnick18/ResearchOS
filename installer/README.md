# ResearchOS Installer

This is the Electron-based installer for ResearchOS. It provides a user-friendly GUI for installing ResearchOS and all its dependencies.

## Development

### Prerequisites
- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Building

```bash
# Build for current platform
npm run build

# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for all platforms
npm run build:all
```

## Project Structure

```
installer/
├── package.json           # NPM configuration
├── tsconfig.json          # TypeScript configuration
├── src/
│   ├── main.ts           # Electron main process
│   ├── preload.ts        # Preload script for IPC
│   └── renderer/         # UI files
│       ├── index.html    # Main HTML
│       ├── styles.css    # CSS styles
│       └── app.js        # JavaScript UI logic
├── assets/               # App icons
│   ├── icon.icns        # macOS icon
│   ├── icon.ico         # Windows icon
│   └── icon.png         # Generic icon
└── release/             # Built installers (created by build)
```

## How It Works

1. **Welcome Screen**: Introduces the installer and what it will do
2. **Dependencies Screen**: Checks for Python, Node.js, and Git; installs missing ones
3. **Configuration Screen**: Prompts for installation directory and GitHub settings
4. **Installation Screen**: Installs ResearchOS and creates desktop shortcut
5. **Success Screen**: Shows completion and next steps

## Customizing Icons

Replace the placeholder icons in `assets/` with your own:

- **macOS**: Use a 1024x1024 PNG and convert to `.icns` using `iconutil` or online tools
- **Windows**: Use a 256x256 PNG and convert to `.ico` using online tools
- **Generic**: A 512x512 PNG for Linux and other platforms

## Notes

- The installer downloads Python, Node.js, and Git from official sources when needed
- On macOS, Homebrew is preferred for installing dependencies if available
- The installer creates a desktop shortcut/app bundle for easy launching
