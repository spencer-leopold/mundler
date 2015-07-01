#!/usr/bin/env node

var Mundler = require('./');
var argv = require('yargs')
    .usage('Usage: mundler --app [app] --cwd [cwd] -n [name] --vendor [vendor] -n [name] -o [dest] -c [bool] -w [watch]')
    .describe('app', 'The directory containing application builds')
    .describe('vendor', 'The direcotry containing vendor scripts')
    .describe('cwd', 'Current Working Directory, [required]')
    .alias('n', 'name')
    .describe('n', 'Name of bundle')
    .alias('o', 'output')
    .describe('o', 'Directory to output bundles')
    .alias('c', 'config')
    .describe('c', 'Custom location of config file')
    .alias('w', 'watch')
    .describe('w', 'Whether to watch source directory')
    .argv;

var mundler = Mundler(null, argv);
mundler.start();
