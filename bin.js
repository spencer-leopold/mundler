#!/usr/bin/env node

var EstrnBrowserify = require('./');
var argv = require('yargs')
    .usage('Usage: estrn-browserify --app [app] --cwd [cwd] -n [name] --vendor [vendor] -n [name] -o [dest] -c [bool] -w [bool]')
    .describe('app', 'The directory containing application builds')
    .describe('vendor', 'The direcotry containing vendor scripts')
    .describe('cwd', 'Current Working Directory, [required]')
    .alias('n', 'name')
    .describe('n', 'Name of bundle')
    .alias('o', 'output')
    .describe('o', 'Directory to output bundles')
    .alias('c', 'concat')
    .describe('c', 'Concatenate vendor and app bundles')
    .alias('w', 'watch')
    .describe('w', 'Whether to watch source directory')
    .argv;

new EstrnBrowserify(null, argv);
