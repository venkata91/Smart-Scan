module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Needed for pdfjs-dist (class static blocks in .mjs)
      '@babel/plugin-transform-class-static-block',
    ],
  };
};
