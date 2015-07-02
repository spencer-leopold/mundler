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

/**
 * Initialize and set props
 * @param {Object} options
 * @param {Object} args
 */
function Mundler(options, args) {
  this.options = options || {};
  this.watchAll = (args && args.watch && args.watch === 'all') || false;
  this.watch = (args && args.watch) ? args.watch : false;
  this.browserAliasesAndShims = [];
  this.vendorBundleCache = {};
}

/**
 * Start Mundler, configuration has already
 * been set during initialization
 */
Mundler.prototype.start = function() {
  this.start = new Date().getTime();

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
            if (self.watchAll || (self.watch && ~self.watch.indexOf(name))) {
              props.watch = true;
            }

            self.buildDependencyList(name, props).then(function(config) {
              self.configureBundle(config.name, config.props, config.modules, aliases);
            }).catch(console.log.bind(console));
          });
        }
      }
    }).catch(console.log.bind(console));
  }).catch(console.log.bind(console));
}

/**
 * Verify required properties
 * @param {String} bundleName
 * @param {Object} props
 * @param {Function} callback
 */
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

/**
 * Tries to read a package.json property
 * @param {String} property
 */
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

/**
 * Promisified readFile
 * @param {String} file
 */
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

/**
 * Reads each file in array and returns an array
 * of external dependencies
 * @param {Array} files
 * @param {Object} props
 * @param {Array} moduleList
 */
Mundler.prototype.searchForDependencies = function(files, props, moduleList) {
  // @TODO: create tally of already read files, to prevent reading multiple times
  // if the file is required in another file
  var self = this;
  var regex = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?;/g;
  var modules = moduleList || [];
  var basePath = (!!props.cwd) ? path.resolve(props.cwd) : processCwd;

  return Promise.all(files.map(function(file) {
    // prevent adding modules from ignored files
    var baseFile = file.replace(basePath + '/', '');
    if (!!props.ignoreFiles && ~props.ignoreFiles.indexOf(baseFile)) {
      return false;
    }
    else {
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
        }).catch(console.log.bind(console));
      }).catch(console.log.bind(console));
    }
  })).then(function() {
    return modules;
  }).catch(console.log.bind(console));
}

/**
 * WARNING: RECURSION
 *
 * Checks whether an import or require is for an external module.
 * If it is, it returns the match, if not it reads the internal
 * module looking for other external modules.
 * @param {String} file
 * @param {String} match
 * @param {Object} props
 * @param {Array} modules
 */
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

    return this.searchForDependencies([filePath], props, modules);
  }
}

/**
 * Returns an array of a bundle's external dependencies.
 * @param {String} bundleName
 * @param {Object} props
 */
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

/**
 * Sets up browserify bundle for internal and external files
 * @param {String} bundleName
 * @param {Object} props
 * @param {Array} modules
 * @param {Object} aliases
 */
Mundler.prototype.configureBundle = function(bundleName, props, modules, aliases) {
  var b, dest, self = this;
  var src = (!!props.cwd) ? path.resolve(props.cwd, props.src) : path.resolve(props.src);
  var basePath = (!!props.cwd) ? path.resolve(props.cwd) : processCwd;
  var bMethod = (!!props.useRequire) ? 'require' : 'add';
  var prefix = props.prefix || false;
  var preTasks = props.preTasks || false;
  var postTasks = props.postTasks || false;

  if (props.dest.charAt(0) === '/') {
    dest = props.dest;
  }
  else {
    dest = path.resolve(props.dest);
  }

  if (!props.watch) {
    b = browserify(props.browserifyOpts || {});
  }
  else {
    var wOpts = props.watchifyOpts || {};
    wOpts.cache = wOpts.cache || {};
    wOpts.packageCache = wOpts.packageCache || {};
    b = browserify(wOpts);
    b = watchify(b);
  }

  if (modules && modules.length) {
    b.external(modules);

    if (aliases) {
      b.external(Object.keys(aliases));
    }
  }

  self.configureVendorBundle('vendor-'+bundleName, props, modules, aliases).then(function() {
    glob(src, function(err, filesArr) {
      if (err) {
        console.log(err);
        return false;
      }

      Promise.all(filesArr.map(function(file) {
        var expose = file.replace(basePath + '/', '');

        if (!!props.ignoreFiles && ~props.ignoreFiles.indexOf(expose)) {
          b.ignore(file);
          return file;
        }

        if (!!prefix) {
          if (prefix.slice(-1) !== '/') {
            prefix += '/';
          }

          expose = prefix + expose;
        }

        // remove file extensions
        expose = expose.substr(0, expose.lastIndexOf('.'));

        b[bMethod](file, { expose: expose });

        return file;
      })).then(function() {
        self.bundle(b, bundleName, dest, props).catch(console.log.bind(console))
      });
    });
  });
}

/**
 * Sets up browserify bundle for external modules
 * @param {String} bundleName
 * @param {Object} props
 * @param {Array} modules
 * @param {Object} aliases 
 */
Mundler.prototype.configureVendorBundle = function(bundleName, props, modules, aliases) {
  var self = this;
  var b = browserify(props.browserifyOpts || {});
  var dest;

  if (!!props.vendorDest) {
    if (props.vendorDest.charAt(0) === '/') {
      dest = props.vendorDest;
    }
    else {
      dest = path.resolve(props.vendorDest);
    }
  }
  else {
    dest = path.dirname(props.dest) + '/' + bundleName + '.js';
  }

  return Promise.promise(function(resolve, reject) {
    if (modules && modules.length) {
      b.require(modules);
    }

    if (aliases) {
      for (var alias in aliases) {
        if (aliases.hasOwnProperty(alias)) {
          var filePath = path.resolve(aliases[alias]);
          b.require(filePath, { expose: alias });
        }
      }
    }

    // Check if we even need to build a vendor bundle
    if ((!modules || !modules.length) && (!aliases || !Object.keys(aliases).length)) {
      resolve();
    }
    else {
      self.bundle(b, bundleName, dest, props).then(function() {
        resolve();
      }).catch(console.log.bind(console));
    }
  });
}

/**
 * Executes a command
 * @param {Array/String} tasks
 */
Mundler.prototype.runTasks = function(tasks) {
  return Promise.promise(function(resolve, reject) {
    if (!tasks || !tasks.length) {
      return resolve();
    }

    if (typeof tasks === 'string') {
      var run = exec(tasks);
      run.stdout.pipe(process.stdout)
      run.on('close', function(code) {
        if (code === 0) {
          resolve(code);
        }
        else {
          reject(new Error('Task "'+tasks+'" failed'));
        }
      });
    }
    else {
      for (var i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        var run = exec(task);
        run.stdout.pipe(process.stdout)
        run.on('close', function(code) {
          if (code === 0) {
            resolve(code);
          }
          else {
            reject(new Error('Task "'+task+'" failed'));
          }
        });
      }
    }

  });
}

/**
 * Bundles either the browserify or watchify bundle
 * @param {Object} b
 * @param {String} name
 * @param {String} dest
 * @param {Object} props
 */
Mundler.prototype.bundle = function(b, name, dest, props) {
  var self = this;
  var writeToFile = true;
  var preTasks = props.preTasks || false;
  var postTasks = props.postTasks || false;

  if (!!props.preBundle) {
    if (typeof props.preBundle !== 'function') {
      throw new Error('preBundle must be a function');
    }

    props.preBundle(b);
  }

  b.on('update', function (ids) {
    if (!!props.preBundle) {
      if (typeof props.preBundle !== 'function') {
        throw new Error('preBundle must be a function');
      }

      props.preBundle(b);
    }

    self.runTasks(preTasks).then(function() {
      var start = new Date().getTime(), end;

      b.bundle(function(err, buf) {
        if (!!props.concat) {
          if (name.indexOf('vendor') === -1) {
            buf = self.vendorBundleCache['vendor-'+name] + buf;
          }
        }

        fs.writeFile(dest, buf, function(err) {
          if (err) {
            console.log(err);
            return;
          }

          end = new Date().getTime();
          console.log(chalk.yellow('Bundle '+name) + ': written in %s seconds', (end - start) / 1000);
          self.runTasks(postTasks).catch(function() {});
        });
      });
    }).catch(function() {
      b.bundle() // called again to prevent watchify from dying
    });
  });

  b.on('error', function (err) {
    console.log(err);
  });

  return Promise.promise(function(resolve, reject) {

    self.runTasks(preTasks).then(function() {
      b.bundle(function(err, buf) {
        if (err) {
          return reject(err);
        }

        if (!!props.concat) {
          if (~name.indexOf('vendor')) {
            self.vendorBundleCache[name] = buf;
            writeToFile = false;
          }
          else {
            buf = self.vendorBundleCache['vendor-'+name] + buf;
          }
        }

        if (!writeToFile) {
          return resolve();
        }

        fs.writeFile(dest, buf, function(err) {
          if (err) {
            return reject(err);
          }

          var end = new Date().getTime();
          console.log(chalk.yellow('Bundle '+name) + ': written in %s seconds', (end - self.start) / 1000);
          self.runTasks(postTasks).catch(function() {});
          resolve();
        });
      });
    }).catch(function() {
      b.bundle() // called again to prevent watchify from dying
    });
  });
}

module.exports = Mundler;
