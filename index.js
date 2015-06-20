var browserify = require('browserify');
var watchify = require('watchify');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var async = require('async');
var glob = require('glob')
var chalk = require('chalk');
var cache = {};
chalk.enabled = true;

function Mundler(options, args) {
  var self = this;

  if (!options) {
    var package = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    if (package.mundler) {
      options = package.mundler;
    }
    else {
      try {
        options = require(process.cwd()+'/mundler.config');
      }
      catch (e) {
        throw new Error('Cannot find mundler.config.js configuration');
      }
    }
  }

  var watchAll = args.watch === 'all';
  this.files = [];
  this.externalModules = [];
  this.vendorRequires = [];
  this.browserFiles = [];

  var browserNames = this.getBrowserDeps();
  var browserShims = this.getBrowserDeps(true);
  var self = this;

  browserNames.then(function(names) {
    browserShims.then(function(shims) {
      self.browserFiles = names.concat(shims);

      async.series([
        function(callback) {
          for (var bundle in options) {
            if (options.hasOwnProperty(bundle) && bundle !== 'vendor') {
              var bundleProps = options[bundle];
              self.getExternalDeps(bundle, bundleProps, callback);
            }
          }
        },
        function(callback) {
          if (!options.vendor) {
            callback();
          }
          else {
            var bundleProps = options.vendor;
            if (watchAll || ~args.watch.indexOf('vendor')) {
              bundleProps.watch = true;
            }
            self.getVendorFiles(bundleProps, callback);
          }
        },
        function(callback) {
          for (var bundle in options) {
            if (options.hasOwnProperty(bundle) && bundle !== 'vendor') {
              var bundleProps = options[bundle];
              if (watchAll || ~args.watch.indexOf(bundle)) {
                bundleProps.watch = true;
              }
              self.getMainFiles(bundle, bundleProps, callback);
            }
          }
        }
      ]);
    })
  });
}

Mundler.prototype.getBrowserNames = function() {
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

Mundler.prototype.getBrowserDeps = function(shims) {
  var browserNames;

  if (shims) {
    browserNames = require(process.cwd() + '/package.json')['browserify-shim'] || {};
  }
  else {
    browserNames = require(process.cwd() + '/package.json').browser || {};
  }

  return Promise.all(Object.keys(browserNames)
    .map(function(key) {
      return key;
    })
  ).then(function(names) {
    return names;
  });
}

Mundler.prototype.readFile = function(file) {
  return new Promise(function(resolve, reject) {
    fs.readFile(file, 'utf8', function(err, data) {
      if (err) {
        reject(err);
      }
      else {
        resolve(data);
      }
    });
  });
}

Mundler.prototype.findExternalDependencies = function(files, props) {
  var self = this;
  var regex = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?;/g;
  var m = [];

  return Promise.all(files
    .map(function(file) {
      return self.readFile(file).then(function(data) {
        var matches = [];
        for (var m = null; m = regex.exec(data); matches.push(m[1]));

        return Promise.all(matches
          .map(function(match) {
            return self.processMatch(file, match, props);
          })
        );
      });
    })
  ).then(function(matches) {
    return self.externalModules;
  });
}

Mundler.prototype.processMatch = function(file, match, props) {
  var self = this;
  var processCwd = process.cwd();
  var cwd = props.cwd || processCwd;

  // vendor require
  if (match.charAt(0) !== '.') {
    if (self.browserFiles.indexOf(match) === -1) {
      self.externalModules.push(match);
      return match;
    }
  }
  else {
    // Recurse through all application files to check for other
    // external dependencies
    var pathToFile = processCwd + '/' + cwd;

    if (cwd === processCwd) {
      pathToFile = processCwd + '/' + file.substring(0, file.lastIndexOf('/'));
    }

    var filePath = path.resolve(pathToFile, match) + '.js';

    // remove cwd from path so everything is relative
    filePath = filePath.replace(processCwd + '/', '');
    return self.findExternalDependencies([filePath], props);
  }
}

Mundler.prototype.getExternalDeps = function(bundleKey, props, callback) {
  var self = this;
  var src = props.src;
  var processCwd = process.cwd();
  var cwd = props.cwd || processCwd;

  glob(src, { cwd: cwd }, function(err, filesArr) {
    self.findExternalDependencies(filesArr, props).then(function(modules) {
      self.externalModules = modules;
      callback();
    });
  });
}

Mundler.prototype.getMainFiles = function(bundleKey, props, callback) {
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

  if (this.externalModules.length) {
    b.external(this.externalModules);
  }

  glob(src, { cwd: cwd }, function(err, filesArr) {
    if (err) {
      console.log(err);
      return false;
    }

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

    self.buildBundle(b, bundleKey, dest, props);
    callback();
  });
}


Mundler.prototype.getVendorFiles = function(props, callback) {
  var self = this;
  var processCwd = process.cwd();
  var src = props.src;
  var dest = props.dest;
  var cwd = props.cwd || processCwd;
  var browserFiles = false;
  var b;

  if (!props.watch) {
    b = browserify();
  }
  else {
    b = browserify({ cache: {}, packageCache: {} });
    b = watchify(b);
  }

  // Check for custom browser expose names in package.json
  var browserNames = this.getBrowserNames();

  if (browserNames) {
    browserFiles = Object.keys(browserNames);
  }

  if (this.externalModules.length) {
    b.require(this.externalModules);
  }

  glob(src, { cwd: cwd }, function(err, filesArr) {
    if (err) {
      console.log(err);
      return false;
    }

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

    self.buildBundle(b, 'vendor', dest, props);
    callback();
  });
}

Mundler.prototype.buildBundle = function(b, name, dest, props) {

  if (!props.watch) {
    console.time(chalk.yellow('Bundle '+name) + ' written in');
  }

  if (props.preBundle) {
    if (typeof props.preBundle !== 'function') {
      throw new Error('preBundle must be a function');
    }

    b = props.preBundle(b);
  }

  b.bundle(function(err, buf) {
    fs.writeFile(dest, buf, function(err) {
      if (err) {
        return console.log("write error: %s", err);
      }

      if (!props.watch) {
        console.timeEnd(chalk.yellow('Bundle '+name) + ' written in');
      }
    });
  });

  b.on('update', function (ids) {
    if (props.preBundle) {
      if (typeof props.preBundle !== 'function') {
        throw new Error('preBundle must be a function');
      }

      b = props.preBundle(b);
    }

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

module.exports = Mundler;
