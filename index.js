var browserify = require('browserify');
var watchify = require('watchify');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var async = require('async');
var chokidar = require('chokidar');
var glob = require('glob')
var assign = require('object-assign');
var chalk = require('chalk');
var cache = {};
chalk.enabled = true;

function EstrnBrowserify(options) {
  var self = this;
  var watchAll = ~process.argv.indexOf('watch-all')
  this.files = [];
  this.externalModules = [];
  this.vendorRequires = [];

  async.series([
    function(callback) {
      if (!options.vendor) {
        callback();
      }
      else {
        var bundleProps = options.vendor;
        if (watchAll || ~process.argv.indexOf('watch-vendor')) {
          bundleProps.watch = true;
        }
        self.getVendorFiles(bundleProps, callback);
      }
    },
    function(callback) {
      for (var bundle in options) {
        if (options.hasOwnProperty(bundle) && bundle !== 'vendor') {
          var bundleProps = options[bundle];
          if (watchAll || ~process.argv.indexOf('watch-'+bundle)) {
            bundleProps.watch = true;
          }
          self.getMainFiles(bundle, bundleProps, callback);
        }
      }
    }
  ]);
}

EstrnBrowserify.prototype.getVendorRequires = function() {
  var deps = require(process.cwd() + '/package.json').vendorDependencies;
  return deps || [];
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

EstrnBrowserify.prototype.getMainFiles = function(bundleKey, props, callback) {
  var self = this;
  var processCwd = process.cwd();
  var src = props.src;
  var dest = props.dest;
  var cwd = props.cwd || processCwd;
  var b;

  if (!props.watch) {
    b = browserify();
  }
  else {
    b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  if (this.externalModules) {
    b.external(this.externalModules);
  }

  glob(src, { cwd: cwd }, function(err, filesArr) {
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

    self.buildNewBundle(b, bundleKey, dest, props.watch);
    callback();
  });
}


EstrnBrowserify.prototype.getVendorFiles = function(props, callback) {
  var self = this;
  var processCwd = process.cwd();
  var src = props.src;
  var dest = props.dest;
  var cwd = props.cwd || processCwd;
  var b;

  if (!props.watch) {
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

  // // Check for any dependencies installed through node
  // var deps = this.getVendorRequires();
  // depsTotal = deps.length;
  //
  // // If we have some node deps, require them into the 
  // // vendor bundle and add it as and external dependency
  // // for out main bundles. Common use case is for LoDash
  // // and other front end packages availabe in npm
  // for (var i = 0; i < depsTotal; i++) {
  //   var dep = deps[i];
  //
  //   b.require(dep);
  //   this.externalModules.push(dep);
  // }

  if (props.requires) {
    var deps = props.requires;
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
  }

  glob(src, { cwd: cwd }, function(err, filesArr) {
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

      if (file.charAt(0) !== '/') {
        if (cwd === processCwd) {
          file = cwd + '/' + file;
        }
        else {
          file = processCwd + '/' + cwd + '/' + file;
        }
      }

      b.require(file, { expose: name });

      next();
    });

    self.buildNewBundle(b, 'vendor', dest, props.watch);
    callback();
  });
}

EstrnBrowserify.prototype.buildNewBundle = function(b, name, dest, watched) {

  if (!watched) {
    console.time(chalk.yellow('Bundle '+name) + ' written in');
  }

  var run = exec('npm run jshint -s');
  run.on('exit', function(code) {
    if (code !== 0) {
      console.log('FAILURE for %s', name);
    }
  });
  run.stdout.pipe(process.stdout)

  b.bundle(function(err, buf) {
    fs.writeFile(dest, buf, function(err) {
      if (err) {
        return console.log("write error: %s", err);
      }

      if (!watched) {
        console.timeEnd(chalk.yellow('Bundle '+name) + ' written in');
      }
    });
  });

  b.on('update', function (ids) {
    b.bundle(function(err, buf) {
      fs.writeFile(dest, buf);
    });
  });

  b.on('error', function (err) {
    console.log(err);
  });

  b.on('log', function (msg) {
    console.log(chalk.yellow('Bundle ' + name) + ': ' + msg);
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
