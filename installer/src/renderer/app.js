// ResearchOS Installer - Renderer Application

// State management
const state = {
  currentScreen: 'welcome',
  platform: null,
  dependencies: null,
  installDir: '',
  githubToken: '',
  githubRepo: '',
  dataRepoPath: '',
  installing: false,
  installProgress: {},
  overallProgress: 0,
  currentStep: '',
  error: null,
};

// DOM Elements
const app = document.getElementById('app');

// Initialize the app
async function init() {
  // Get platform info
  state.platform = await window.electronAPI.getPlatform();
  state.installDir = state.platform.defaultInstallDir;
  
  // Set up event listeners
  window.electronAPI.onInstallProgress((data) => {
    state.installProgress[data.dep] = data;
    render();
  });
  
  window.electronAPI.onInstallStatus((data) => {
    state.currentStep = data.step;
    state.overallProgress = data.percent;
    render();
  });
  
  // Render initial screen
  render();
}

// Render the app
function render() {
  app.innerHTML = `
    <div class="header">
      <div class="header-icon">🔬</div>
      <div class="header-content">
        <h1>ResearchOS Installer</h1>
        <p>Research project management made simple</p>
      </div>
    </div>
    
    <div class="main-content">
      ${renderScreen()}
    </div>
    
    <div class="footer">
      <span class="footer-text">ResearchOS v1.0.5</span>
      <span class="footer-text">${state.platform ? capitalizeFirst(state.platform.platform) : 'Detecting...'}</span>
    </div>
  `;
  
  // Attach event listeners after render
  attachEventListeners();
}

// Render current screen
function renderScreen() {
  switch (state.currentScreen) {
    case 'welcome':
      return renderWelcomeScreen();
    case 'dependencies':
      return renderDependenciesScreen();
    case 'config':
      return renderConfigScreen();
    case 'installing':
      return renderInstallingScreen();
    case 'success':
      return renderSuccessScreen();
    case 'error':
      return renderErrorScreen();
    default:
      return renderWelcomeScreen();
  }
}

// Welcome Screen
function renderWelcomeScreen() {
  return `
    <div class="screen active fade-in">
      <div class="welcome-content">
        <div class="welcome-icon">🚀</div>
        <h2>Welcome to ResearchOS!</h2>
        <p>This installer will set up ResearchOS on your computer. It only takes a few minutes.</p>
        
        <div class="feature-list">
          <div class="feature-item">
            <div class="icon">✓</div>
            <span>Check and install required dependencies (Python, Node.js, Git)</span>
          </div>
          <div class="feature-item">
            <div class="icon">✓</div>
            <span>Set up ResearchOS in your preferred location</span>
          </div>
          <div class="feature-item">
            <div class="icon">✓</div>
            <span>Configure GitHub integration for data storage</span>
          </div>
          <div class="feature-item">
            <div class="icon">✓</div>
            <span>Create a desktop shortcut for easy access</span>
          </div>
        </div>
        
        <div class="button-group">
          <button class="btn btn-primary" id="btn-get-started">
            Get Started →
          </button>
        </div>
      </div>
    </div>
  `;
}

// Dependencies Screen
function renderDependenciesScreen() {
  const deps = state.dependencies;
  
  if (!deps) {
    return `
      <div class="screen active fade-in">
        <div class="installation-progress">
          <div class="spinner"></div>
          <h2>Checking Dependencies</h2>
          <p class="current-step">Scanning your system for required software...</p>
        </div>
      </div>
    `;
  }
  
  const allGood = deps.python.meetsRequirement && deps.node.meetsRequirement && deps.git.installed;
  const needsInstall = !allGood;
  
  return `
    <div class="screen active fade-in">
      <h2 style="text-align: center; margin-bottom: 24px;">System Requirements</h2>
      
      <div class="dependency-grid">
        ${renderDependencyCard('python', 'Python', '3.10+', deps.python, '🐍')}
        ${renderDependencyCard('node', 'Node.js', '18+', deps.node, '💚')}
        ${renderDependencyCard('git', 'Git', 'Any', deps.git, '📦')}
      </div>
      
      <div class="button-group">
        <button class="btn btn-secondary" id="btn-back-welcome">
          ← Back
        </button>
        ${needsInstall ? `
          <button class="btn btn-primary" id="btn-install-deps">
            Install Missing Dependencies
          </button>
        ` : `
          <button class="btn btn-primary" id="btn-continue-config">
            Continue →
          </button>
        `}
      </div>
    </div>
  `;
}

function renderDependencyCard(key, name, version, status, icon) {
  const isInstalling = state.installProgress[key]?.status;
  const progress = state.installProgress[key]?.percent || 0;
  
  let statusClass = '';
  let statusText = '';
  
  if (isInstalling) {
    statusClass = 'installing';
    statusText = 'Installing...';
  } else if (status.installed && status.meetsRequirement) {
    statusClass = 'found';
    statusText = `✓ Found (${status.version || 'installed'})`;
  } else if (status.installed && !status.meetsRequirement) {
    statusClass = 'not-found';
    statusText = `⚠ Version ${status.version} (need ${version}+)`;
  } else {
    statusClass = 'not-found';
    statusText = '✗ Not found';
  }
  
  return `
    <div class="dependency-card">
      <div class="dependency-icon ${statusClass === 'found' ? 'success' : statusClass === 'not-found' ? 'warning' : ''}">
        ${icon}
      </div>
      <div class="dependency-info">
        <h3>${name}</h3>
        <p>Required: version ${version}</p>
        ${isInstalling ? `
          <div class="progress-container">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">${isInstalling} ${progress}%</div>
          </div>
        ` : ''}
      </div>
      <span class="dependency-status ${statusClass}">${statusText}</span>
    </div>
  `;
}

// Config Screen
function renderConfigScreen() {
  return `
    <div class="screen active fade-in">
      <h2 style="text-align: center; margin-bottom: 24px;">Configuration</h2>
      
      <div class="config-form">
        <div class="form-group">
          <label>Installation Directory</label>
          <div class="path-input-group">
            <input type="text" id="install-dir" value="${state.installDir}" placeholder="Choose installation location">
            <button class="btn btn-secondary btn-small" id="btn-browse">Browse</button>
          </div>
          <p class="hint">ResearchOS will be installed to this directory.</p>
        </div>
        
        <div class="form-group">
          <label>GitHub Personal Access Token</label>
          <input type="password" id="github-token" value="${state.githubToken}" placeholder="ghp_xxxxxxxxxxxx">
          <p class="hint">
            <a href="#" id="link-token-help">How do I create a token?</a>
          </p>
        </div>
        
        <div class="form-group">
          <label>Data Repository</label>
          <input type="text" id="github-repo" value="${state.githubRepo}" placeholder="username/ResearchOS">
          <p class="hint">Your research data will be stored in this GitHub repository.</p>
        </div>
        
        <div class="form-group">
          <label>Local Data Path</label>
          <div class="path-input-group">
            <input type="text" id="data-repo-path" value="${state.dataRepoPath}" placeholder="Path to clone your data repository">
            <button class="btn btn-secondary btn-small" id="btn-browse-data">Browse</button>
          </div>
          <p class="hint">Local directory where your data repository will be cloned.</p>
        </div>
      </div>
      
      <div class="button-group">
        <button class="btn btn-secondary" id="btn-back-deps">
          ← Back
        </button>
        <button class="btn btn-primary" id="btn-start-install" ${!isConfigValid() ? 'disabled' : ''}>
          Install ResearchOS
        </button>
      </div>
    </div>
  `;
}

function isConfigValid() {
  return state.installDir && state.githubToken && state.githubRepo && state.dataRepoPath;
}

// Installing Screen
function renderInstallingScreen() {
  return `
    <div class="screen active fade-in">
      <div class="installation-progress">
        <div class="spinner"></div>
        <h2>Installing ResearchOS</h2>
        <p class="current-step">${state.currentStep || 'Preparing installation...'}</p>
        
        <div class="overall-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${state.overallProgress}%"></div>
          </div>
          <div class="progress-text">${state.overallProgress}% Complete</div>
        </div>
      </div>
    </div>
  `;
}

// Success Screen
function renderSuccessScreen() {
  return `
    <div class="screen active fade-in">
      <div class="success-content">
        <div class="success-icon">✓</div>
        <h2>Installation Complete!</h2>
        <p>ResearchOS has been installed successfully on your computer.</p>
        
        <div class="install-info">
          <h4>Installation Location</h4>
          <code>${state.installDir}</code>
        </div>
        
        <div class="next-steps">
          <h4>Next Steps:</h4>
          <ol>
            <li>A desktop shortcut has been created - look for "ResearchOS" on your desktop</li>
            <li>Double-click the shortcut to launch ResearchOS</li>
            <li>The app will open in your browser at <code>http://localhost:3000</code></li>
          </ol>
        </div>
        
        <div class="button-group">
          <button class="btn btn-success" id="btn-finish">
            Finish
          </button>
        </div>
      </div>
    </div>
  `;
}

// Error Screen
function renderErrorScreen() {
  return `
    <div class="screen active fade-in">
      <div class="error-content">
        <div class="error-icon">✗</div>
        <h2>Installation Failed</h2>
        <p>Something went wrong during the installation process.</p>
        
        <div class="error-details">
          ${state.error || 'An unknown error occurred.'}
        </div>
        
        <div class="button-group">
          <button class="btn btn-secondary" id="btn-back-welcome">
            Start Over
          </button>
          <button class="btn btn-primary" id="btn-quit">
            Quit Installer
          </button>
        </div>
      </div>
    </div>
  `;
}

// Event Listeners
function attachEventListeners() {
  // Welcome screen
  document.getElementById('btn-get-started')?.addEventListener('click', async () => {
    state.currentScreen = 'dependencies';
    render();
    state.dependencies = await window.electronAPI.checkDependencies();
    render();
  });
  
  // Dependencies screen
  document.getElementById('btn-back-welcome')?.addEventListener('click', () => {
    state.currentScreen = 'welcome';
    state.dependencies = null;
    state.installProgress = {};
    state.error = null;
    render();
  });
  
  document.getElementById('btn-install-deps')?.addEventListener('click', async () => {
    await installMissingDependencies();
  });
  
  document.getElementById('btn-continue-config')?.addEventListener('click', () => {
    state.currentScreen = 'config';
    render();
  });
  
  // Config screen
  document.getElementById('btn-back-deps')?.addEventListener('click', () => {
    state.currentScreen = 'dependencies';
    render();
  });
  
  document.getElementById('btn-browse')?.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      state.installDir = dir;
      document.getElementById('install-dir').value = dir;
    }
  });
  
  document.getElementById('btn-browse-data')?.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      state.dataRepoPath = dir;
      document.getElementById('data-repo-path').value = dir;
    }
  });
  
  document.getElementById('link-token-help')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openExternal('https://github.com/settings/tokens');
  });
  
  // Form inputs
  document.getElementById('install-dir')?.addEventListener('input', (e) => {
    state.installDir = e.target.value;
    updateInstallButton();
  });
  
  document.getElementById('github-token')?.addEventListener('input', (e) => {
    state.githubToken = e.target.value;
    updateInstallButton();
  });
  
  document.getElementById('github-repo')?.addEventListener('input', (e) => {
    state.githubRepo = e.target.value;
    updateInstallButton();
  });
  
  document.getElementById('data-repo-path')?.addEventListener('input', (e) => {
    state.dataRepoPath = e.target.value;
    updateInstallButton();
  });
  
  // Start installation
  document.getElementById('btn-start-install')?.addEventListener('click', async () => {
    state.currentScreen = 'installing';
    state.currentStep = 'Starting installation...';
    state.overallProgress = 0;
    render();
    
    const result = await window.electronAPI.installResearchOS({
      installDir: state.installDir,
      githubToken: state.githubToken,
      githubRepo: state.githubRepo,
      dataRepoPath: state.dataRepoPath,
    });
    
    if (result.success) {
      state.currentScreen = 'success';
    } else {
      state.error = result.error;
      state.currentScreen = 'error';
    }
    render();
  });
  
  // Success screen
  document.getElementById('btn-finish')?.addEventListener('click', () => {
    window.electronAPI.quitInstaller();
  });
  
  // Error screen
  document.getElementById('btn-quit')?.addEventListener('click', () => {
    window.electronAPI.quitInstaller();
  });
}

function updateInstallButton() {
  const btn = document.getElementById('btn-start-install');
  if (btn) {
    btn.disabled = !isConfigValid();
  }
}

async function installMissingDependencies() {
  const deps = state.dependencies;
  
  // Install Python if needed
  if (!deps.python.meetsRequirement) {
    state.installProgress.python = { status: 'Starting...', percent: 0 };
    render();
    await window.electronAPI.installDependency('python');
    delete state.installProgress.python;
  }
  
  // Install Node.js if needed
  if (!deps.node.meetsRequirement) {
    state.installProgress.node = { status: 'Starting...', percent: 0 };
    render();
    await window.electronAPI.installDependency('node');
    delete state.installProgress.node;
  }
  
  // Install Git if needed
  if (!deps.git.installed) {
    state.installProgress.git = { status: 'Starting...', percent: 0 };
    render();
    await window.electronAPI.installDependency('git');
    delete state.installProgress.git;
  }
  
  // Re-check dependencies
  state.dependencies = await window.electronAPI.checkDependencies();
  render();
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Start the app
init();
