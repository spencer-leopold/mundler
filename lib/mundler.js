var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var browserify = require('browserify');
var watchify = require('watchify');
var Promise = require('when');
var glob = require('glob')
var chalk = require('chalk');
var processCwd = process.cwd();
chalk.enabled = true;

function Mundler(options, args) {
  var self = this;
  this.options = options || {};
  this.watchAll = (args && args.watch && args.watch === 'all');
  this.watch = (args && args.watch) ? args.watch : false;
  this.browserAliasesAndShims = [];
}

Mundler.prototype.run = function() {
  var self = this;
  var options = this.options;
  var browserAliases = this.getPackageProperty('browser');
  var browserShims = this.getPackageProperty('browserify-shim');

  browserAliases.then(function(aliases) {
    browserShims.then(function(shims) {
      self.browserAliasesAndShims = Object.keys(aliases).concat(Object.keys(shims));

      for (var bundle in options) {
        if (options.hasOwnProperty(bundle)) {

          var bundleProps = options[bundle];

          if (self.watchAll || self.watch && ~self.watch.indexOf(bundle)) {
            bundleProps.watch = true;
          }

          self.buildDependencyList(bundle, bundleProps).then(function(config) {
            self.buildBundle(config.bundle, config.props, config.modules, aliases, shims);
          });
        }
      }
    });
  });
}

Mundler.prototype.getPackageProperty = function(property) {
  return Promise.promise(function(resolve, reject) {
    try {
      var prop = require(path.resolve('package.json'))[property] || {};
      resolve(prop);
    }
    catch (e) {
      reject(e);
    }
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

  return Promise.all(files.map(function(file) {
    return self.readFile(file).then(function(data) {
      var matches = [];
      for (var m = null; m = regex.exec(data); matches.push(m[1]));

      return Promise.all(matches.map(function(match) {
        return self.processMatch(file, match, props, modules);
      })).then(function(matchList) {
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
  })).then(function() {
    return modules;
  });
}

Mundler.prototype.processMatch = function(file, match, props, modules) {
  var src;
  var self = this;
  var cwd = props.cwd || processCwd;

  // vendor require
  if (match.charAt(0) !== '.') {
    if (~self.browserAliasesAndShims.indexOf(match) || (modules && ~modules.indexOf(match))) {
      return false;
    }
    else {
      return match;
    }
  }
  else {
    var suffix = '.js';
    if (~match.indexOf('.js')) {
      suffix = '';
    }
    var fileDir = path.dirname(file);
    var filePath = path.resolve(fileDir, match) + suffix;

    // remove cwd from path so everything is relative
    // filePath = filePath.replace(processCwd + '/', '');
    return self.searchForDependencies([filePath], props, modules);
  }
}

Mundler.prototype.buildDependencyList = function(bundleKey, props) {
  var src;
  var self = this;
  var cwd = props.cwd || processCwd;

  if (props.src.charAt(0) === '/') {
    src = props.src;
  }
  else {
    src = path.resolve(cwd, props.src);
  }

  return Promise.promise(function(resolve, reject) {
    glob(src, function(err, filesArr) {
      self.searchForDependencies(filesArr, props).then(function(modules) {
        resolve({ bundle: bundleKey, props: props, modules: modules });
      });
    });
  });
}

Mundler.prototype.buildBundle = function(bundleKey, props, modules, aliases, shims) {
  var self = this;
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

  if (modules && modules.length) {
    b.external(modules);

    if (aliases) {
      b.external(Object.keys(aliases));
    }

    self.buildVendorBundle('vendor-'+bundleKey, props, modules, aliases);
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


Mundler.prototype.buildVendorBundle = function(bundleKey, props, modules, aliases) {
  var self = this;
  var src = props.src;
  var dest = path.dirname(props.dest) + '/' + bundleKey + '.js';
  var cwd = props.cwd || processCwd;
  var b = browserify();

  if (modules && modules.length) {
    b.require(modules);
  }

  if (aliases) {
    for (var alias in aliases) {
      var filePath = path.resolve(processCwd, aliases[alias]);
      b.require(filePath, { expose: alias });
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
