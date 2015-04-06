var browserify = require('browserify');
var watchify = require('watchify');
var fs = require('fs');
var path = require('path');
var async = require('async');
var gaze = require('gaze');
var glob = require('glob')
var assign = require('object-assign');
var chalk = require('chalk');
chalk.enabled = true;

function EstrnBrowserify(options) {
  this.files = [];

  this.cwd = options.cwd;
  this.app = options.app;
  this.vendor = options.vendor;
  this.dest = options.output;
  this.watch = options.watch || false;

  var self = this;

  this.getVendorFiles(this.vendor);
  console.log(vendorRequires);
  if (this.watch) {
  }
}

EstrnBrowserify.prototype.constructor = EstrnBrowserify;

EstrnBrowserify.prototype.getVendorFiles = function(dir) {
  var vendorRequires = [];
  var self = this;
  dir = dir + '/*.js';

  glob(dir, {}, function(err, filesArr) {
    var module = path.basename(filesArr[0], '.js');
    console.log(module);
    self.vendorRequires.push('./'+filesArr[0]+':'+module);
  });
}

module.exports = EstrnBrowserify;
