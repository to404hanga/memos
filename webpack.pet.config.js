const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/pet/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist', 'pet'),
    filename: 'bundle.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: [/node_modules/, path.resolve(__dirname, 'src/main')],
        use: 'ts-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/pet/index.html',
    }),
    new CopyPlugin({
      patterns: [
        { from: 'assets/pets', to: 'pets' },
      ],
    }),
  ],
  devServer: {
    port: 3001,
    hot: true,
    static: {
      directory: path.join(__dirname, 'assets'),
      publicPath: '/',
    },
  },
};
