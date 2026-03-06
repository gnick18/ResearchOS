const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  
  // Dependency checking and installation
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  installDependency: (dep) => ipcRenderer.invoke('install-dependency', dep),
  
  // Installation progress listeners
  onInstallProgress: (callback) => {
    ipcRenderer.on('install-progress', (_event, data) => callback(data));
  },
  onInstallStatus: (callback) => {
    ipcRenderer.on('install-status', (_event, data) => callback(data));
  },
  
  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // ResearchOS installation
  installResearchOS: (options) => ipcRenderer.invoke('install-researchos', options),
  
  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Quit
  quitInstaller: () => ipcRenderer.invoke('quit-installer'),
});
