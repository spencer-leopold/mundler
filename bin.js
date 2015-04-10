#!/usr/bin/env node

var EstrnBrowserify = require('./');
var argv = require('yargs')
    .usage('Usage: estrn-browserify --app [app] --vendor [vendor] -o [dest] --cwd [str] -c [bool] -w [bool]')
    .describe('app', 'The directory containing application builds')
    .describe('vendor', 'The direcotry containing vendor scripts')
    .describe('cwd', 'Current Working Directory, [required]')
    .alias('o', 'output')
    .describe('o', 'Directory to output bundles')
    .alias('c', 'concat')
    .describe('c', 'Concatenate vendor and app bundles')
    .alias('w', 'watch')
    .describe('w', 'Whether to watch source directory')
    .argv;

new EstrnBrowserify(argv);
