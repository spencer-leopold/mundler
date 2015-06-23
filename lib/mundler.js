var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var browserify = require('browserify');
var watchify = require('watchify');
var Promise = require('when');
var glob = require('glob')
var chalk = require('chalk');
chalk.enabled = true;

function Mundler(o, args) {
  var self = this;
  var options = this._initOptions(o, args);
  var watchAll = (args.watch && args.watch === 'all');

  this.files = [];
  this.externalModules = [];
  this.vendorRequires = [];
  this.browserFiles = [];

  var browserNames = this.loadBrowserConfig();
  var browserShims = this.loadBrowserConfig(true);

  browserNames.then(function(names) {
    browserShims.then(function(shims) {
      self.browserFiles = names.concat(shims);

      for (var bundle in options) {
        if (options.hasOwnProperty(bundle)) {

          var bundleProps = options[bundle];

          if (watchAll || args.watch && ~args.watch.indexOf(bundle)) {
            bundleProps.watch = true;
          }

          self.checkFilesForDependencies(bundle, bundleProps).then(function(config) {
            self.buildBundle(config.bundle, config.props, config.modules, names, shims);
          });
        }
      }
    });
  });
}

Mundler.prototype._initOptions = function(options, args) {
  if (!options) {
    if (args.config) {
      try {
        options = require(args.config);
      }
      catch (e) {
        throw e;
      }
    }
    else {
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
  }

  return options;
}

Mundler.prototype.browserAliasCheck = function() {
  var browserNames = require(process.cwd() + '/package.json').browser || false;

  return browserNames;
}

Mundler.prototype.loadBrowserConfig = function(shims) {
  var browserNames;

  if (shims) {
    browserNames = require(process.cwd() + '/package.json')['browserify-shim'] || {};
  }
  else {
    browserNames = this.browserAliasCheck() || {};
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
  return Promise.promise(function(resolve, reject) {
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

Mundler.prototype.searchForDependencies = function(files, props, moduleArr) {
  var self = this;
  var regex = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?;/g;
  var modules = moduleArr || [];

  return Promise.all(files
    .map(function(file) {
      return self.readFile(file).then(function(data) {
        var matches = [];
        for (var m = null; m = regex.exec(data); matches.push(m[1]));

        return Promise.all(matches
          .map(function(match) {
            return self.processMatch(file, match, props, modules);
          })
        ).then(function(matchList) {
          return matchList
            .filter(function(module) {
              return (typeof module === 'string');
            })
            .map(function(module) {
              modules.push(module);
              return module;
            });
        });
      }).catch(console.log);
    })
  ).then(function() {
    return modules;
  });
}

Mundler.prototype.processMatch = function(file, match, props, modules) {
  var self = this;
  var processCwd = process.cwd();
  var cwd = props.cwd || processCwd;

  // vendor require
  if (match.charAt(0) !== '.') {
    if (self.browserFiles.indexOf(match) === -1) {
      return match;
    }
    else {
      return false;
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
    return self.searchForDependencies([filePath], props, modules);
  }
}

Mundler.prototype.checkFilesForDependencies = function(bundleKey, props) {
  var self = this;
  var src = props.src;
  var processCwd = process.cwd();
  var cwd = props.cwd || processCwd;

  return Promise.promise(function(resolve, reject) {
    glob(src, { cwd: cwd }, function(err, filesArr) {
      self.searchForDependencies(filesArr, props).then(function(modules) {
        resolve({ bundle: bundleKey, props: props, modules: modules });
      });
    });
  });
}

Mundler.prototype.buildBundle = function(bundleKey, props, externalModules, names, shims) {
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

  if (externalModules && externalModules.length) {
    b.external(externalModules);

    if (names && names.length) {
      b.external(names);
    }

    self.buildVendorBundle('vendor-'+bundleKey, props, externalModules, names);
  }

  glob(src, { cwd: cwd }, function(err, filesArr) {
    if (err) {
      console.log(err);
      return false;
    }

    Promise.all(filesArr
      .map(function(file) {
        var filepath;

        if (cwd === processCwd) {
          filePath = cwd + '/' + file;
        }
        else {
          filePath = processCwd + '/' + cwd + '/' + file;
        }

        b.add(filePath, { expose: file });

        return file;
      })
    ).then(function() {
      self.bundle(b, bundleKey, dest, props);
    });

  });
}


Mundler.prototype.buildVendorBundle = function(bundleKey, props, externalModules, names) {
  var self = this;
  var processCwd = process.cwd();
  var src = props.src;
  var dest = (~props.dest.indexOf('.js')) ? props.dest.substring(0, props.dest.lastIndexOf('/')) + '/' + bundleKey + '.js' : props.dest;
  var cwd = props.cwd || processCwd;
  var b = browserify();

  if (externalModules && externalModules.length) {
    b.require(externalModules);
  }

  if (names && names.length) {
    // Check for custom browser expose names in package.json
    var browserNames = this.browserAliasCheck();

    for (var i in names) {
      var name = names[i];
      var file = path.resolve(processCwd, browserNames[names]);
      b.require(file, { expose: name });
    }
  }

  self.bundle(b, bundleKey, dest, {});
}

Mundler.prototype.bundle = function(b, name, dest, props) {

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
