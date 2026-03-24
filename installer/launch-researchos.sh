#!/bin/bash
# ResearchOS Launcher Script
# A simple, single-click way to initialize and run ResearchOS
# This avoids the complexity of Electron installer signing issues

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔬 ResearchOS Launcher${NC}"
echo "This script will check dependencies and start ResearchOS"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check operating system
OS="$(uname)"
echo -e "${YELLOW}Checking system: $OS${NC}"

# Check and install dependencies
echo -e "${YELLOW}Checking dependencies...${NC}"

# Check for Homebrew (macOS) or Linux package manager
if [[ "$OS" == "Darwin" ]]; then
    # macOS
    if ! command_exists brew; then
        echo -e "${RED}Homebrew not found. Installing Homebrew...${NC}"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        echo -e "${GREEN}Homebrew installed successfully${NC}"
    else
        echo -e "${GREEN}Homebrew found${NC}"
    fi
    
    # Check and install Python
    if ! command_exists python3; then
        echo -e "${RED}Python 3 not found. Installing via Homebrew...${NC}"
        brew install python
        echo -e "${GREEN}Python installed successfully${NC}"
    else
        echo -e "${GREEN}Python found${NC}"
    fi
    
    # Check and install Node.js
    if ! command_exists node; then
        echo -e "${RED}Node.js not found. Installing via Homebrew...${NC}"
        brew install node
        echo -e "${GREEN}Node.js installed successfully${NC}"
    else
        echo -e "${GREEN}Node.js found${NC}"
    fi
    
    # Check and install Git
    if ! command_exists git; then
        echo -e "${RED}Git not found. Installing via Homebrew...${NC}"
        brew install git
        echo -e "${GREEN}Git installed successfully${NC}"
    else
        echo -e "${GREEN}Git found${NC}"
    fi
    
elif [[ "$OS" == "Linux" ]]; then
    # Linux - assume Ubuntu/Debian for simplicity
    echo -e "${YELLOW}Linux detected. Please ensure you have Python 3, Node.js, and Git installed.${NC}"
    echo -e "${YELLOW}On Ubuntu/Debian, you can run: sudo apt update && sudo apt install -y python3 nodejs git${NC}"
else
    echo -e "${RED}Unsupported operating system: $OS${NC}"
    echo -e "${YELLOW}Please manually install Python 3, Node.js, and Git, then run this script again.${NC}"
    exit 1
fi

# Verify installations
echo -e "${YELLOW}Verifying installations...${NC}"
if ! command_exists python3; then
    echo -e "${RED}Python 3 is required but not found.${NC}"
    exit 1
fi

if ! command_exists node; then
    echo -e "${RED}Node.js is required but not found.${NC}"
    exit 1
fi

if ! command_exists git; then
    echo -e "${RED}Git is required but not found.${NC}"
    exit 1
fi

echo -e "${GREEN}All dependencies verified!${NC}"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESEARCHOS_DIR="$SCRIPT_DIR/../.."  # Go up two levels from installer/ to repo root

# Check if we're in a ResearchOS repository
if [ ! -d "$RESEARCHOS_DIR/backend" ] || [ ! -d "$RESEARCHOS_DIR/frontend" ]; then
    echo -e "${YELLOW}ResearchOS repository not found at $RESEARCHOS_DIR${NC}"
    echo -e "${YELLOW}Cloning ResearchOS repository...${NC}"
    
    # Clone the repository
    git clone https://github.com/yourusername/ResearchOS.git "$RESEARCHOS_DIR"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to clone repository. Please check your internet connection and try again.${NC}"
        exit 1
    fi
    echo -e "${GREEN}Repository cloned successfully${NC}"
else
    echo -e "${GREEN}ResearchOS repository found at $RESEARCHOS_DIR${NC}"
    # Update the repository
    echo -e "${YELLOW}Updating repository...${NC}"
    cd "$RESEARCHOS_DIR"
    git pull
    echo -e "${GREEN}Repository updated${NC}"
fi

# Change to ResearchOS directory
cd "$RESEARCHOS_DIR"

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
if [ -f "backend/requirements.txt" ]; then
    pip install -r backend/requirements.txt
    echo -e "${GREEN}Python dependencies installed${NC}"
else
    echo -e "${YELLOW}Warning: backend/requirements.txt not found${NC}"
fi

# Install Node.js dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
if [ -f "frontend/package.json" ]; then
    cd frontend
    npm install
    cd ..
    echo -e "${GREEN}Node.js dependencies installed${NC}"
else
    echo -e "${YELLOW}Warning: frontend/package.json not found${NC}"
fi

# Start ResearchOS
echo -e "${GREEN}Starting ResearchOS...${NC}"
echo -e "${YELLOW}This may take a moment...${NC}"

# Make start.sh executable if it isn't already
chmod +x start.sh

# Start the application
./start.sh

# Note: This script will block until start.sh exits (when user presses Ctrl+C)
# If you want to run in background, you could modify this to:
# nohup ./start.sh > researchos.log 2>&1 &
# echo $! > researchos.pid