var browserify = require('browserify');
var watchify = require('watchify');
var fs = require('fs');
var path = require('path');
var async = require('async');
var chokidar = require('chokidar');
var glob = require('glob')
var assign = require('object-assign');
var chalk = require('chalk');
var cache = {};
chalk.enabled = true;

function EstrnBrowserify(options) {
  this.dependencies = this.getDeps();
  this.files = [];
  this.externalModules = [];
  this.vendorRequires = [];

  this.cwd = options.cwd;
  this.app = options.app;
  this.vendor = options.vendor;
  this.dest = options.output;
  this.concat = options.concat || false;
  this.watch = options.watch || false;

  var self = this;

  async.series([
    function(callback) {
      self.getVendorFiles(callback);
    },
    function(callback) {
      self.getMainFiles(callback);
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

EstrnBrowserify.prototype.getDeps = function() {
  var deps = require(process.cwd() + '/package.json').dependencies;
  if (deps) {
    return Object.keys(deps);
  }
  else {
    return [];
  }
}

EstrnBrowserify.prototype.getVendorFiles = function(callback) {
  var self = this;
  var dir = this.vendor + '/*.js';

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var module = path.basename(file, '.js');
      self.vendorRequires.push({ file: './'+file, expose: module});
      self.externalModules.push(module);
      next();
    });

    callback();
  });
}

EstrnBrowserify.prototype.getMainFiles = function(callback) {
  var self = this;
  var dir = this.app + '/*.js';

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var name = path.basename(file, '.js');
      self.files.push({ file: './'+file, name: name });
      next();
    });

    callback();
  });
}

EstrnBrowserify.prototype.buildVendorBundle = function(watch) {
  bundle({ name: 'vendor', concat: this.concat, dest: this.dest, deps: this.dependencies }, this.vendorRequires, false, this.watch);
}


EstrnBrowserify.prototype.buildMainBundles = function(watch) {
  async.each(this.files, function(fileObj, next) {
    fileObj.concat = this.concat;
    fileObj.dest = this.dest;
    fileObj.deps = this.dependencies;
    bundle(fileObj, false, this.externalModules, this.watch);
  }.bind(this));
}

function bundle(options, requires, external, watch) {
  if (!watch) {
    var b = browserify();
  }
  else {
    var b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  if (requires.length) {
    b.require(requires);

    b.bundle(function(err, buf) {
      fs.writeFile(options.dest + '/bundle-'+options.name+'.js', buf);
      cache.vendorBundle = buf;
    });
  }

  if (external.length) {
    b.external(external);
    b.add(options.file);

    b.bundle(function(err, buf) {
      fs.writeFile(options.dest + '/bundle-'+options.name+'.js', buf);
    });

    b.on('update', function (ids) {
      b.bundle(function(err, buf) {
        if (options.concat) {
          buf = cache.vendorBuffer + buf;
        }
        fs.writeFile(options.dest + '/bundle-'+options.name+'.js', buf);
      });
    });
  }

  b.on('error', function (err) {
    console.log(err);
  });

  b.on('log', function (msg) {
    console.log(chalk.yellow('Bundle ' + options.name) + ': ' + msg);
  });
}

module.exports = EstrnBrowserify;
