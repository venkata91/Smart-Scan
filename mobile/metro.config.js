// Extend Expo's default Metro config and layer our customizations.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

/** @type {import('metro-config').ConfigT} */
const config = getDefaultConfig(__dirname);

// Keep existing workspace-friendly settings
config.projectRoot = __dirname;
config.watchFolders = [path.resolve(__dirname, '..', 'src')];

// Preserve our block list while using Expo defaults
// Note: Do NOT exclude generic `dist/` globally, as many packages
// (e.g., react-native-web) resolve files from their `dist/` folder.
config.resolver = {
  ...config.resolver,
  blockList: exclusionList([
    /(^|\/)output\/.*$/,
    /(^|\/)\.git\/.*$/,
  ]),
};

module.exports = config;
