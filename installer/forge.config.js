module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon',
    appBundleId: 'com.researchos.installer',
    win32metadata: {
      CompanyName: 'ResearchOS',
      OriginalFilename: 'ResearchOS Installer',
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ResearchOSInstaller',
        authors: 'ResearchOS',
        description: 'ResearchOS Smart Installer',
        iconUrl: 'https://raw.githubusercontent.com/example/researchos/main/installer/assets/icon.ico',
        setupIcon: './assets/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
};
