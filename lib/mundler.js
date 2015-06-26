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

          self.verifyRequiredProps(bundle, bundleProps, function(name, props) {
            if (self.watchAll || self.watch && ~self.watch.indexOf(name)) {
              props.watch = true;
            }

            self.buildDependencyList(name, props).then(function(config) {
              self.buildBundle(config.name, config.props, config.modules, aliases);
            });
          });
        }
      }
    }).catch(console.log.bind(console));
  }).catch(console.log.bind(console));
}

Mundler.prototype.verifyRequiredProps = function(bundleName, props, callback) {
  if (!props.hasOwnProperty('src')) {
    throw new Error('Missing property "src" in Mundler config for bundle: '+bundleName);
  }
  else if (!props.hasOwnProperty('dest')) {
    throw new Error('Missing property "dest" in Mundler config for bundle: '+bundleName);
  }
  else {
    callback(bundleName, props);
  }
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
  var cwd = props.cwd || processCwd;

  // vendor require
  if (match.charAt(0) !== '.') {
    if (~this.browserAliasesAndShims.indexOf(match) || (modules && ~modules.indexOf(match))) {
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
    return this.searchForDependencies([filePath], props, modules);
  }
}

Mundler.prototype.buildDependencyList = function(bundleName, props) {
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
        resolve({ name: bundleName, props: props, modules: modules });
      });
    });
  });
}

Mundler.prototype.buildBundle = function(bundleName, props, modules, aliases) {
  var b, dest, self = this;
  var src = (!!props.cwd) ? path.resolve(props.cwd, props.src) : path.resolve(props.src);
  var basePath = (!!props.cwd) ? processCwd + '/' + props.cwd : processCwd;
  var prefix = props.prefix || false;

  if (props.dest.charAt(0) === '/') {
    dest = props.dest;
  }
  else {
    dest = path.resolve(props.dest);
  }

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

    this.buildVendorBundle('vendor-'+bundleName, dest, modules, aliases);
  }

  glob(src, function(err, filesArr) {
    if (err) {
      console.log(err);
      return false;
    }

    Promise.all(filesArr
      .map(function(file) {
        var expose = file.replace(basePath + '/', '');

        if (!!prefix) {
          if (prefix.slice(-1) !== '/') {
            prefix += '/';
          }

          expose = prefix + expose;
        }

        b.add(file, { expose: expose });
        return file;
      })
    ).then(function() {
      self.bundle(b, bundleName, dest, props);
    });
  });
}


Mundler.prototype.buildVendorBundle = function(bundleName, mainDest, modules, aliases) {
  var dest = path.dirname(mainDest) + '/' + bundleName + '.js';
  var b = browserify();

  if (modules && modules.length) {
    b.require(modules);
  }

  if (aliases) {
    for (var alias in aliases) {
      var filePath = path.resolve(aliases[alias]);
      b.require(filePath, { expose: alias });
    }
  }

  this.bundle(b, bundleName, dest, {});
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
