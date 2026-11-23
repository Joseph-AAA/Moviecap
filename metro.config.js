const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Support WebAssembly files required by Expo SQLite
config.resolver.assetExts.push("wasm");

module.exports = config;
