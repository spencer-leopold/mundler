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

  this.app = options.src;
  this.vendor = options.vendor;
  this.dest = options.output;
  this.watch = options.watch || false;

  console.log(options);

  // Pull out imports from main scss files on load
  this.cwd = options.cwd;
  this.ext = path.extname(this.src);

  var self = this;

  if (this.watch) {
    if (typeof this.src == 'object') {
      this.src = this.src[0];
    }

    glob(this.src, { cwd: this.cwd }, function(err, filesArr) {

      self.buildImportMap(filesArr);

      async.each(Object.keys(self.main_files), function(src) {
        if (self.main_files.hasOwnProperty(src)) {
          self.compileSass(src);
        }
      });

    });
  }
}

module.exports = EstrnBrowserify;
