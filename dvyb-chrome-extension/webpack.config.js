const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const API_BASE = process.env.DVYB_API_BASE || 'http://localhost:3001';
const FRONTEND_URL = process.env.DVYB_FRONTEND_URL || 'http://localhost:3005';

module.exports = {
  entry: {
    background: './src/background.ts',
    content: './src/content.ts',
    popup: './src/popup/popup.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.DVYB_API_BASE': JSON.stringify(API_BASE),
      'process.env.DVYB_FRONTEND_URL': JSON.stringify(FRONTEND_URL),
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.generated.json', to: 'manifest.json' },
        { from: 'src/popup/popup.html', to: 'popup.html' },
        { from: 'assets', to: 'assets', noErrorOnMissing: true },
      ],
    }),
  ],
  devtool: 'cheap-module-source-map',
};
