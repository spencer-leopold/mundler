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
    // function(callback) {
    //   self.buildVendorBundle(self.watch);
    //   callback();
    // }
    // function(callback) {
    //   self.buildMainBundles(self.watch);
    //   callback();
    // }
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
  var dir = this.vendor + '/*.jsx';

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var module = path.basename(file, '.jsx');
      self.vendorRequires.push({ file: './'+file, expose: module});
      self.externalModules.push(module);
      next();
    });

    callback();
  });
}

EstrnBrowserify.prototype.getMainFiles = function(callback) {
  var self = this;
  var dir = this.app + '/**/*.jsx';

  if (!this.watch) {
    var b = browserify();
  }
  else {
    var b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  glob(dir, {}, function(err, filesArr) {
    async.each(filesArr, function(file, next) {
      var name = path.basename(file, '.jsx');
      var appName = 'app/dashboard/app/';
      var replaceWith = 'app/';
      var expose = file.replace(appName, replaceWith).replace('.jsx', '').replace('.js', '');
      var fileObj = { file: './'+file, expose: expose };

      self.files.push(fileObj);
      b.require('./'+file, { expose: expose });

      next();
    });

    b.require('reaction/shared/router');
    self.buildNewBundle(b);
    callback();
  });
}

EstrnBrowserify.prototype.buildNewBundle = function(b) {
  b.bundle(function(err, buf) {
    fs.writeFile('./dist/js/scripts.js', buf);
  });

  b.on('update', function (ids) {
    b.bundle(function(err, buf) {
      fs.writeFile('./dist/js/scripts.js', buf);
    });
  });

  // b.on('file', function (file, id, parent) {
  //   console.log("file: %s", file);
  // });

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

  if (!external.length && options.file) {
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
