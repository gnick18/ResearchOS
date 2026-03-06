import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  
  // Dependency checking and installation
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  installDependency: (dep: 'python' | 'node' | 'git') => 
    ipcRenderer.invoke('install-dependency', dep),
  
  // Installation progress listeners
  onInstallProgress: (callback: (data: { dep: string; status: string; percent: number }) => void) => {
    ipcRenderer.on('install-progress', (_event, data) => callback(data));
  },
  onInstallStatus: (callback: (data: { step: string; percent: number }) => void) => {
    ipcRenderer.on('install-status', (_event, data) => callback(data));
  },
  
  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // ResearchOS installation
  installResearchOS: (options: {
    installDir: string;
    githubToken: string;
    githubRepo: string;
    dataRepoPath: string;
  }) => ipcRenderer.invoke('install-researchos', options),
  
  // External links
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  
  // Quit
  quitInstaller: () => ipcRenderer.invoke('quit-installer'),
});

// Type definitions for the exposed API
export interface ElectronAPI {
  getPlatform: () => Promise<{
    platform: string;
    isWindows: boolean;
    isMac: boolean;
    isLinux: boolean;
    homeDir: string;
    defaultInstallDir: string;
  }>;
  checkDependencies: () => Promise<{
    python: { installed: boolean; version: string | null; meetsRequirement: boolean };
    node: { installed: boolean; version: string | null; meetsRequirement: boolean };
    git: { installed: boolean; version: string | null; meetsRequirement: boolean };
  }>;
  installDependency: (dep: 'python' | 'node' | 'git') => Promise<{ success: boolean; error?: string }>;
  onInstallProgress: (callback: (data: { dep: string; status: string; percent: number }) => void) => void;
  onInstallStatus: (callback: (data: { step: string; percent: number }) => void) => void;
  selectDirectory: () => Promise<string | null>;
  installResearchOS: (options: {
    installDir: string;
    githubToken: string;
    githubRepo: string;
    dataRepoPath: string;
  }) => Promise<{ success: boolean; installDir?: string; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  quitInstaller: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
