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
    }
  ]);
}

EstrnBrowserify.prototype.getDeps = function() {
  var deps = require(process.cwd() + '/package.json').dependencies;

  if (deps) {
    return Object.keys(deps);
  }

  return [];
}

EstrnBrowserify.prototype.getBrowserNames = function() {
  var browserNames = require(process.cwd() + '/package.json').browser;

  if (browserNames) {
    var obj = {};

    for (var prop in browserNames) {
      if (browserNames.hasOwnProperty(prop)) {
        obj[browserNames[prop]] = prop;
      }
    }

    return obj;
  }

  return false;
}

EstrnBrowserify.prototype.getMainFiles = function(callback) {
  var self = this;
  var dir = this.app;
  var processCwd = process.cwd();
  var cwd = this.cwd || processCwd;
  var b;

  if (!this.watch) {
    b = browserify();
  }
  else {
    b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  if (this.externalModules) {
    b.external(this.externalModules);
  }

  glob(dir, { cwd: cwd }, function(err, filesArr) {
    async.each(filesArr, function(file, next) {

      var filepath;

      if (cwd === processCwd) {
        filePath = cwd + '/' + file;
      }
      else {
        filePath = processCwd + '/' + cwd + '/' + file;
      }

      b.add(filePath, { expose: file });

      next();
    });

    self.buildNewBundle(b, 'bundle-main');
    callback();
  });
}


EstrnBrowserify.prototype.getVendorFiles = function(callback) {
  if (!this.vendor) {
    return callback();
  }

  var self = this;
  var dir = this.vendor;
  var b;

  if (!this.watch) {
    b = browserify();
  }
  else {
    b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  // Check for custom browser expose names in package.json
  var browserFiles = false;
  var browserNames = this.getBrowserNames();

  if (browserNames) {
    browserFiles = Object.keys(browserNames);
  }

  // Check for any dependencies installed through node
  var deps = this.getDeps();
  depsTotal = deps.length;

  // If we have some node deps, require them into the 
  // vendor bundle and add it as and external dependency
  // for out main bundles. Common use case is for LoDash
  // and other front end packages availabe in npm
  for (var i = 0; i < depsTotal; i++) {
    var dep = deps[i];

    b.require(dep);
    this.externalModules.push(dep);
  }

  glob(dir+'/**/*.js', {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var name = path.basename(file, '.js');

      // If a custom expose name is defined in package.json
      // use that instead of filename sans extension
      if (browserFiles) {
        var idx = browserFiles.indexOf(file);
        if (idx !== -1) {
          name = browserNames[browserFiles[idx]];
        }
      }

      self.externalModules.push(name);
      b.require(file, { expose: name });

      next();
    });

    self.buildNewBundle(b, 'bundle-vendor');
    callback();
  });
}

EstrnBrowserify.prototype.buildNewBundle = function(b, name) {

  console.time('Browserify '+name+' written in');
  b.bundle(function(err, buf) {
    fs.writeFile('./dist/js/'+name+'.js', buf, function(err) {
      if (err) {
        return console.log("write error: %s", err);
      }

      console.timeEnd('Browserify '+name+' written in');
    });
  });

  b.on('update', function (ids) {
    b.bundle(function(err, buf) {
      fs.writeFile('./dist/js/'+name+'.js', buf);
    });
  });

  b.on('error', function (err) {
    console.log(err);
  });

  b.on('log', function (msg) {
    console.log(chalk.yellow('Bundle dist') + ': ' + msg);
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

module.exports = EstrnBrowserify;
