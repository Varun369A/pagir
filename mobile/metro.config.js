const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

// In npm workspaces, node_modules are hoisted to the repo root
const repoRoot = path.resolve(__dirname, '..');

/**
 * PAGIR 2 Metro configuration
 * Configures Metro to find hoisted npm workspace packages in the repo root
 */
const config = {
  watchFolders: [repoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(repoRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
