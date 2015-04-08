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
  this.externalFiles = [];
  this.vendorRequires = [];

  this.cwd = options.cwd;
  this.app = options.app;
  this.vendor = options.vendor;
  this.dest = options.output;
  this.watch = options.watch || false;

  var self = this;

  async.series([
    function(callback) {
      self.getVendorFiles();
      callback();
    },
    function(callback) {
      self.getMainFiles();
      callback();
    },
    function(callback) {
      self.buildVendorBundle(self.watch);
      callback();
    },
    function(callback) {
      self.buildMainBundles(self.watch);
      callback();
    }
  ]);
}

EstrnBrowserify.prototype.constructor = EstrnBrowserify;

EstrnBrowserify.prototype.getVendorFiles = function() {
  var self = this;
  var dir = this.vendor + '/*.js';

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var module = path.basename(file, '.js');
      self.vendorRequires.push({ file: './'+file, expose: module});
      self.externalFiles.push('./'+file);
      next();
    });
  });
}

EstrnBrowserify.prototype.getMainFiles = function() {
  var self = this;
  var dir = this.app + '/*.js';

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var name = path.basename(file, '.js');
      self.files.push({ file: './'+file, name: name });
      next();
    });
  });
}

EstrnBrowserify.prototype.buildVendorBundle = function(watch) {
  var self = this;

  setTimeout(function() {
    new EstrnBundler(false, self.vendorRequires, false, self.watch);
  }, 1000);
}


EstrnBrowserify.prototype.buildMainBundles = function(watch) {
  var self = this;

  setTimeout(function() {
    async.each(self.files, function(fileObj, next) {
      new EstrnBundler(fileObj, false, self.externalFiles, self.watch);
    });
  }, 1000);
}

function EstrnBundler(options, requires, external, watch) {
  if (!watch) {
    var b = browserify();
  }
  else {
    var b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  if (requires.length) {
    async.series([
      function(callback) {
        async.each(requires, function(required, next) {
          b.require(required.file, { expose: required.expose });
          next();
        })
        callback();
      },
      function(callback) {
        b.bundle(function(err, buf) {
          fs.writeFile('./test.js', buf);
          console.log('wrote vendor bundle');
        });
        callback();
      }
    ]);
  }

  if (external.length) {
    b.external(external);
    b.add(options.file);

    b.bundle(function(err, buf) {
      fs.writeFile(process.cwd() + '/bundle-'+options.name+'.js', buf);
      console.log('wrote %s bundle', options.name);
    });

    b.on('update', function (ids) {
      console.log(ids);
      b.bundle();
      // b.bundle(function(err, buf) {
      //   fs.writeFile('./bundle-'+options.name+'.js', buf);
      //   console.log('wrote %s bundle', options.name);
      // });
    });
  }

  b.on('error', function (err) {
    console.log(err);
  });

  b.on('time', function (time) {
    console.log(time);
  });
}

module.exports = EstrnBrowserify;
