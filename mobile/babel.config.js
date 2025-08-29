module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Removed 'module-resolver' to avoid requiring 'babel-plugin-module-resolver'.
  };
};
