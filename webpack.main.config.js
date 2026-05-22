const path = require('path');

module.exports = {
  mode: 'development',
  target: 'electron-main',
  entry: './src/main/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'main'),
    filename: 'index.js',
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: 'tsconfig.main.json',
          },
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  externals: {
    'electron': 'commonjs electron',
    'sql.js': 'commonjs sql.js',
    'adm-zip': 'commonjs adm-zip',
    'uuid': 'commonjs uuid',
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};
