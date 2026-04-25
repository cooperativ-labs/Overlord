/** @type {import('@babel/core').TransformOptions} */
module.exports = {
  presets: [
    ['@babel/preset-typescript', { allowDeclareFields: true, onlyRemoveTypeImports: true }]
  ],
  plugins: ['@babel/plugin-transform-modules-commonjs']
};
