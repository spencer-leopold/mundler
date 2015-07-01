#!/usr/bin/env node

var Mundler = require('./');
var argv = require('yargs')
    .usage('Usage: mundler -c [config] -w [watch]')
    .alias('c', 'config')
    .describe('c', 'Path to custom config file')
    .alias('w', 'watch')
    .describe('w', 'Name of bundle to watch; can use multiple times')
    .help('h')
    .alias('h', 'help')
    .argv;

var mundler = Mundler(null, argv);
mundler.start();
