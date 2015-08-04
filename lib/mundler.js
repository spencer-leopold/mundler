'use strict';

var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var assign = require('object-assign');
var browserify = require('browserify');
var watchify = require('watchify');
var Promise = require('bluebird');
var glob = require('glob');
var chalk = require('chalk');
var processCwd = process.cwd();
chalk.enabled = true;

function catchError(e) {
  console.log(e);
}

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
  this.filesCache = {};
  this.moduleCache = {};
  this.fullModuleList = {};
}

/**
* Start Mundler, configuration has already
 * been set during initialization
 */
Mundler.prototype.bundle = function() {
  this.start = new Date().getTime();

  var self = this;
  var bundles = {};
  var options = this.options;
  var browserAliases = this.getPackageProperty('browser');
  var browserShims = this.getPackageProperty('browserify-shim');

  console.log(chalk.bold(
    'Starting Mundler...\n'
  ));

  return Promise.join(browserAliases, browserShims, function(aliases, shims) {

    self.browserAliases = aliases;
    self.browserShims = shims;
    self.browserAliasesAndShims = Object.keys(aliases).concat(Object.keys(shims));

    return Promise.all(Object.keys(options)
      .filter(function(bundle) {
        return options.hasOwnProperty(bundle);
      })
      .map(function(bundle) {
        var bundleProps = options[bundle];

        return self.verifyRequiredProps(bundle, bundleProps).spread(function(name, props) {

          if (self.watchAll || (self.watch && ~self.watch.indexOf(name))) {
            props.watch = true;
          }

          if (!!props.watch) {
            console.log('Watching "'+name+'" for changes...\n');
          }

          return self.buildDependencyList(name, props).then(function(modules) {
            return self.configureBundle(name, props, modules, aliases).then(function(buf) {
              bundles[name] = buf;
              return buf;
            });
          }).catch(catchError);
        }).catch(catchError);
      })
    ).then(function() {
      return bundles;
    }).catch(catchError);
  });

};

/**
 * Verify required properties
 * @param {String} bundleName
 * @param {Object} props
 * @param {Function} callback
 */
Mundler.prototype.verifyRequiredProps = function(bundleName, props, callback) {
  return new Promise(function(resolve, reject) {
    if (!props.hasOwnProperty('src')) {
      reject(new Error('Missing property "src" in Mundler config for bundle: '+bundleName));
    }
    else if (!props.hasOwnProperty('dest')) {
      reject(new Error('Missing property "dest" in Mundler config for bundle: '+bundleName));
    }
    else {
      resolve([ bundleName, props ]);
    }
  });
};

/**
 * Tries to read a package.json property
 * @param {String} property
 */
Mundler.prototype.getPackageProperty = function(property) {
  return new Promise(function(resolve, reject) {
    try {
      var prop = require(path.resolve('package.json'))[property] || {};
      resolve(prop);
    }
    catch (e) {
      reject(e);
    }
  });
};

/**
 * Promisified readFile
 * @param {String} file
 */
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
};

Mundler.prototype.glob = function(src) {
  return new Promise(function(resolve, reject) {
    glob(src, function(err, filesArr) {
      if (err) {
        reject(err);
      }
      else {
        resolve(filesArr);
      }
    });
  });
};

/**
 * Reads each file in array and returns an array
 * of external dependencies
 * @param {String} bundleName
 * @param {Array} files
 * @param {Object} props
 * @param {Array} moduleList
 */
Mundler.prototype.searchForDependencies = function(bundleName, files, props, moduleList) {
  var self = this;
  var requireRe = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?/g;
  var commentsRe = /(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm;
  var modules = moduleList || [];
  var basePath = (!!props.cwd) ? path.resolve(props.cwd) : processCwd;

  // Create a fileCache for this bundle
  if (!this.filesCache.hasOwnProperty(bundleName)) {
    this.filesCache[bundleName] = [];
  }

  return Promise.all(files
    .filter(function(file) {
      // prevent adding modules from ignored files
      var baseFile = file.replace(basePath + '/', '');

      if (!!props.ignoreFiles && ~props.ignoreFiles.indexOf(baseFile)) {
        return false;
      }

      if (~self.filesCache[bundleName].indexOf(file)) {
        return false;
      }

      return true;
    })
    .map(function(file) {
      return self.readFile(file).then(function(data) {
        // Add file to cache, so we know it was already
        // read and processed
        self.filesCache[bundleName].push(file);

        data = data.replace(commentsRe, '');

        var matches = [];
        for (var m = null; m = requireRe.exec(data); matches.push(m[1]));

        return Promise.all(matches.map(function(match) {
          return self.processMatch(bundleName, file, match, props, modules);
        })).then(function(matchList) {
          return matchList
            .filter(function(module) {
              return (typeof module === 'string' && modules.indexOf(module) === -1);
            })
            .map(function(module) {
              modules.push(module);
              return module;
            });
        }).catch(catchError);
      }).catch(catchError);
    })
  ).then(function() {
    return modules;
  }).catch(catchError);
};

/**
 * WARNING: RECURSION
 *
 * Checks whether an import or require is for an external module.
 * If it is, it returns the match, if not it reads the internal
 * module looking for other external modules.
 * @param {String} bundleName
 * @param {String} file
 * @param {String} match
 * @param {Object} props
 * @param {Array} modules
 */
Mundler.prototype.processMatch = function(bundleName, file, match, props, modules) {
  // vendor require
  if (match.charAt(0) !== '.') {
    // Add module to the full cached list
    this.fullModuleList[bundleName] = this.fullModuleList[bundleName] || {};
    this.fullModuleList[bundleName][match] = this.fullModuleList[bundleName][match] || 0;
    this.fullModuleList[bundleName][match]++;

    this.moduleCache[bundleName] = this.moduleCache[bundleName] || {};
    this.moduleCache[bundleName][file] = this.moduleCache[bundleName][file] || [];

    // Add module to the file's module cache
    if (this.moduleCache[bundleName][file].indexOf(match) === -1) {
      this.moduleCache[bundleName][file].push(match);
    }

    if (~this.browserAliasesAndShims.indexOf(match) || (modules && ~modules.indexOf(match))) {
      return false;
    }

    return match;
  }
  else {
    var suffix = '.js';
    if (~match.indexOf('.js')) {
      suffix = '';
    }
    var fileDir = path.dirname(file);
    var filePath = path.resolve(fileDir, match) + suffix;

    // Create bundleCache if doesn't exist, mainly an issue when
    // calling the method directly
    if (!this.filesCache.hasOwnProperty(bundleName)) {
      this.filesCache[bundleName] = [];
    }

    // Prevent searching a file again
    if (~this.filesCache[bundleName].indexOf(filePath)) {
      return false;
    }
    else {
      return this.searchForDependencies(bundleName, [filePath], props, modules);
    }
  }
};

/**
 * Returns an array of a bundle's external dependencies.
 * @param {String} bundleName
 * @param {Object} props
 */
Mundler.prototype.buildDependencyList = function(bundleName, props) {
  var src, self = this;
  var cwd = props.cwd || processCwd;

  if (props.src.charAt(0) === '/') {
    src = props.src;
  }
  else {
    src = path.resolve(cwd, props.src);
  }

  return new Promise(function(resolve, reject) {
    glob(src, function(err, filesArr) {
      self.searchForDependencies(bundleName, filesArr, props).then(function(modules) {
        resolve(modules);
      });
    });
  });
};

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

  return self.configureVendorBundle('vendor-'+bundleName, props, modules, aliases).then(function() {
    return self.glob(src).then(function(filesArr) {
      return Promise.all(filesArr
        .filter(function(file) {
          var expose = file.replace(basePath + '/', '');

          if (!!props.ignoreFiles && ~props.ignoreFiles.indexOf(expose)) {
            b.ignore(file);
            return false;
          }

          return true;
        })
        .map(function(file) {
          var expose = file.replace(basePath + '/', '');

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
        })
      ).then(function() {

        if (!props.watch) {
          console.log('Building "'+ bundleName +'" bundle...');
        }

        return self.createBundle(b, bundleName, dest, props)
          .catch(catchError);

      }).catch(catchError);
    }).catch(catchError);
  });
};

/**
 * Sets up browserify bundle for external modules
 * @param {String} bundleName
 * @param {Object} props
 * @param {Array} modules
 * @param {Object} aliases 
 */
Mundler.prototype.configureVendorBundle = function(bundleName, props, modules, aliases) {
  var dest, self = this;
  var vprops = assign({}, props);
  var b = browserify(props.browserifyOpts || {});
  vprops.watch = false;
  vprops.vendor = true;
  vprops.preTasks = false;
  vprops.postTasks = false;

  if (!!vprops.vendorDest) {
    if (vprops.vendorDest.charAt(0) === '/') {
      dest = vprops.vendorDest;
    }
    else {
      dest = path.resolve(vprops.vendorDest);
    }
  }
  else {
    dest = path.dirname(vprops.dest) + '/' + bundleName + '.js';
  }

  return new Promise(function(resolve, reject) {
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
      resolve(false);
    }
    else {
      if (!props.watch) {
        console.log('Building "'+ bundleName +'" bundle...');
      }

      self.createBundle(b, bundleName, dest, vprops)
        .then(resolve)
        .catch(catchError);
    }
  });
};


Mundler.prototype.taskFunctionCallback = function(resolve, reject) {
  return function(err) {
    if (err) {
      console.log(chalk.red('Function task failed'));
      return reject(err);
    }
    
    return resolve();
  }
};

Mundler.prototype.taskRunCommand = function(task) {
  return new Promise(function(resolve, reject) {
    console.log('Running task "'+task+'"');

    var run = exec(task);
    run.stdout.pipe(process.stdout);
    run.on('close', function(code) {
      if (code !== 0) {
        console.log(chalk.red('Task "'+task+'" failed'));
        reject('');
      }
      else {
        console.log('Task "'+task+'" completed successfully\n');
        resolve();
      }
    });
  });
};

Mundler.prototype.taskRunFunction = function(task) {
  var _this = this;
  return new Promise(function(resolve, reject) {
    var callback = _this.taskFunctionCallback(resolve, reject);
    return task(callback);
  });
};


/**
 * Executes a command
 * @param {Array/String} tasks
 */
Mundler.prototype.runTasks = function(tasks) {
  var _this = this;

  if (!tasks || !tasks.length) {
    // If no tasks, return an empty Promise
    return Promise.resolve();
  }
  else if (typeof tasks === 'string') {
    // If task is a string, it's some type of command.
    // Execute it and return resolved Promise if it
    // exits with a code of 0. If the code is anything
    // else, return a rejected Promise.
    return this.taskRunCommand(tasks);
  }
  else if (typeof tasks === 'function') {
    // If tasks is a function, run it and pass in
    // a callback to resolve the Promise.
    return this.taskRunFunction(tasks);
  }
  else {
    return Promise.all(tasks
      .filter(function(task) {
        return (typeof task === 'string' || typeof task === 'function');
      })
      .map(function(task) {
        if (typeof task === 'string') {
          return _this.taskRunCommand(task);
        }

        return _this.taskRunFunction(task);
      })
    );
  }
};

/**
 * Bundles either the browserify or watchify bundle
 * @param {Object} b
 * @param {String} name
 * @param {String} dest
 * @param {Object} props
 * @param {Object} modules
 * @param {aliases} aliases
 */
Mundler.prototype.createBundle = function(b, name, dest, props) {
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

  // @TODO: This needs some refactoring... way to much
  // crammed in here - need to split up for reuse
  b.on('update', function(ids) {
    // reevaluate module list
    var file = ids[0];
    var requireRe = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?/g;
    var commentsRe = /(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm;

    self.moduleCache[name][file] = self.moduleCache[name][file] || [];
    var moduleCache = self.moduleCache[name][file];

    self.readFile(file).then(function(data) {
      data = data.replace(commentsRe, '');

      var matches = [];
      for (var m = null; m = requireRe.exec(data); matches.push(m[1]));

      return Promise.all(matches
        .filter(function(match) {
          return (match && match.charAt(0) !== '.');
        })
        .map(function(match) {
          return match;
        })
      ).then(function(tempMatches) {

        matches = [];
        var diffedModuleCache = moduleCache.slice(0);
        var addedModuleCache = [];

        // Remove any duplicates, can be caused by requiring module objects
        // instead of requiring the module once and using the variable name
        // to import each method/property.
        //   example:
        //     var React = require('reaction').React;
        //     var Route = require('reaction').Route;
        //     var DefaultRoute = require('reaction').DefaultRoute;
        tempMatches.forEach(function(match) {
          if (match && match.charAt(0) !== '.' && matches.indexOf(match) === -1) {
            matches.push(match);

            // If the module is a new require, add it 
            // to the addedModuleCache
            if (moduleCache.indexOf(match) === -1) {
              addedModuleCache.push(match);
            }

            // remove module from diffedModuleCache since it's
            // still required in the file
            var mIdx = diffedModuleCache.indexOf(match);

            if (mIdx >= 0) {
              diffedModuleCache.splice(mIdx, 1);
            }
          }
        });

        // dependency removed
        if (matches.length < moduleCache.length) {
          var trueRemoval = false;
          var removed = [];

          diffedModuleCache.forEach(function(match) {
            var matchCount = self.fullModuleList[name][match] || 0;

            if (matchCount) {
              matchCount--;
            }

            if (matchCount <= 0) {
              matchCount = 0;
              trueRemoval = true;
              removed.push(match);
            }

            self.fullModuleList[name][match] = matchCount;
          });

          self.moduleCache[name][file] = matches;

          if (trueRemoval) {
            return 'REMOVAL of "' + removed.join('", "');
          }

          return false;
        }

        // dependency added
        if (matches.length > moduleCache.length) {
          var trueAddition = false;
          var added = [];

          addedModuleCache.forEach(function(match) {
            var matchCount = self.fullModuleList[name][match] || 0;

            matchCount++;

            if (matchCount === 1) {
              trueAddition = true;
              added.push(match);
            }

            self.fullModuleList[name][match] = matchCount;
          });

          self.moduleCache[name][file] = matches;

          if (trueAddition && added.length) {
            return 'ADDITION of "' + added.join('", "');
          }

          return false;
        }

        return false;
      }).catch(catchError);

    }).then(function(change) {

      if (!change) {
        return false;
      }
      else {
        console.log(chalk.green('Detected '+change+'"... rebuilding before bundling "'+name+'"'));

        //
        // rebuild new module list and bundle
        //
        self.start = new Date().getTime();

        var tempModuleList = [];
        var modulesList = [];
        var aliases = self.browserAliases || {};
        var shims = self.browserShims || {};

        return Promise.all(Object.keys(self.moduleCache[name])
          .map(function(filename) {
            tempModuleList = tempModuleList.concat(self.moduleCache[name][filename]);
          })
        ).then(function() {

          return Promise.all(tempModuleList
            .filter(function(m) {
              return (modulesList.indexOf(m) === -1 && Object.keys(shims).indexOf(m) === -1);
            })
            .map(function(m) {
              modulesList.push(m);
              return m;
            })
          ).catch(function(e) {
            b.bundle(); // called again to prevent watchify from dying
            catchError(e)
          });

        }).then(function(modules) {

          return self.configureVendorBundle('vendor-'+name, props, modules, aliases);

        }).catch(function(e) {
          b.bundle(); // called again to prevent watchify from dying
          catchError(e)
        });
      }

    }).then(function() {

      if (!!props.preBundle) {
        if (typeof props.preBundle !== 'function') {
          throw new Error('preBundle must be a function');
        }

        props.preBundle(b);
      }

      var start = new Date().getTime(), end;
      self.runTasks(preTasks).then(function() {
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
            console.log(chalk.yellow('Bundle "'+name+'"') + ': written in %s seconds\n', (end - start) / 1000);

            self.runTasks(postTasks)
              .catch(function(e) {
                b.bundle(); // called again to prevent watchify from dying
                catchError(e)
              });
          });
        });
      }).catch(function(e) {
        b.bundle(); // called again to prevent watchify from dying
        catchError(e)
      });

    }).catch(function(e) {
      b.bundle(); // called again to prevent watchify from dying
      catchError(e)
    });
  });

  b.on('error', function (err) {
    console.log(err);
    b.bundle(); // called again to prevent watchify from dying
  });

  return new Promise(function(resolve, reject) {

    if (!!props.watch && !props.vendor) {
      b.bundle();
      return resolve();
    }

    self.runTasks(preTasks).then(function() {
      b.bundle(function(err, buf) {
        if (err) {
          return reject(err);
        }

        if (!!props.concat) {
          if (props.vendor) {
            self.vendorBundleCache[name] = buf;
            writeToFile = false;
          }
          else {
            buf = self.vendorBundleCache['vendor-'+name] + buf;
          }
        }

        if (!writeToFile) {
          var end = new Date().getTime();
          console.log(chalk.yellow('Bundle "'+name+'"') + ': created in %s seconds and cached for concatenation\n', (end - self.start) / 1000);
          return resolve(buf);
        }

        fs.writeFile(dest, buf, function(err) {
          if (err) {
            return reject(err);
          }

          var end = new Date().getTime();
          console.log(chalk.yellow('Bundle "'+name+'"') + ': written in %s seconds\n', (end - self.start) / 1000);
          self.runTasks(postTasks).catch(function() {});
          resolve(buf);
        });
      });
    }).catch(function() {
      b.bundle(); // called again to prevent watchify from dying
    });
  });
};

module.exports = Mundler;
