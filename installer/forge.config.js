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
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
};
