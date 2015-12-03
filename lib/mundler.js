'use strict';

var fs = require('fs');
var path = require('path');
var util = require('util');
var events = require('events');
var exec = require('child_process').exec;
var Readable = require('stream').Readable;
var File = require('vinyl');
var assign = require('object-assign');
var browserify = require('browserify');
var watchify = require('watchify');
var Promise = require('bluebird');
var glob = require('glob');
var minimatch = require('minimatch');
var chalk = require('chalk');
var processCwd = process.cwd();
chalk.enabled = true;

/**
* Initialize and set props
* @param {Object} config
* @param {Object} args
*/
function Mundler(config, args) {
  this.options = config.options || {};
  this.bundles = config.bundles || config || {};

  this.streams = this.options.streams || false;
  this.watchAll = (args && args.watch && (args.watch === 'all' || args.watch === true)) || false;
  this.watch = (args && args.watch) ? args.watch : false;
  this.vendorBundleCache = {};
  this.filesCache = {};
  this.moduleCache = {};
  this.fullModuleList = {};
  this.logger = this.options.logger || console;
}

Mundler.prototype = new events.EventEmitter;

/**
* Start Mundler, configuration has already
 * been set during initialization
 */
Mundler.prototype.bundle = function() {
  this.start = new Date().getTime();

  var self = this;
  var bundles = this.bundles;
  var browserAliases = this.getPackageProperty('browser');
  var browserShims = this.getPackageProperty('browserify-shim');

  if (this.logger === console) {
    this.logger.log(chalk.bold(
      'Starting Mundler...\n'
    ));
  }

  return Promise.join(browserAliases, browserShims, function(aliases, shims) {

    self.browserAliases = aliases;
    self.browserShims = shims;

    return Promise.all(Object.keys(bundles)
      .filter(function(bundle) {
        return bundles.hasOwnProperty(bundle);
      })
      .map(function(bundle) {
        var bundleProps = bundles[bundle];

        return self.verifyRequiredProps(bundle, bundleProps).spread(function(name, props) {

          props.watch = self.options.watch || false;
          props.concat = props.concat || self.options.concat || false;
          props.browserifyOpts = props.browserifyOpts || self.options.browserifyOpts || {};
          props.watchifyOpts = props.watchifyOpts || self.options.watchifyOpts || {};

          if (self.watchAll || (self.watch && ~self.watch.indexOf(name))) {
            props.watch = true;
          }

          if (!!props.watch) {
            self.logger.log('Watching "'+name+'" for changes...\n');
          }

          if (self.streams) {
            props.dest = name;
          }

          return self.buildDependencyList(name, props).then(function(modules) {
            return self.configureBundle(name, props, modules, aliases).then(function(buf) {
              return buf;
            });
          }).catch(self.logger.log);
        }).catch(self.logger.log);
      })
    ).then(function(outputBundles) {
      return outputBundles;
    }).catch(self.logger.log);
  });

};

/**
 * Verify required properties
 * @param {String} bundleName
 * @param {Object} props
 * @param {Function} callback
 */
Mundler.prototype.verifyRequiredProps = function(bundleName, props, callback) {
  var self = this;

  return new Promise(function(resolve, reject) {
    if (!props.hasOwnProperty('src')) {
      reject(new Error('Missing property "src" in Mundler config for bundle: '+bundleName));
    }
    else if (!props.hasOwnProperty('dest') && !self.streams) {
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
    // if src isn't a string, then an array of
    // filepaths was passed in already so we don't
    // need to expand the glob.
    if (typeof src !== 'string') {
      return resolve(src);
    }

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
      // prevent trying to read a directory
      if (!path.extname(file)) {
        return false;
      }

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
        }).catch(self.logger.log);
      }).catch(self.logger.log);
    })
  ).then(function() {
    return modules;
  }).catch(self.logger.log);
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

    // If module is part of browserify-shims, or we already matched it, return false
    if ((!!this.browserShims && !!this.browserShims[match]) || (modules && ~modules.indexOf(match))) {
      return false;
    }

    return match;
  }
  else {
    var filePath, suffix, stats, fileDir = path.dirname(file);

    // try .jsx files first
    try {
      suffix = '.jsx';
      if (~match.indexOf('.jsx')) {
        suffix = '';
      }
      filePath = path.resolve(fileDir, match) + suffix;
      stats = fs.statSync(filePath);
    }
    catch (e) {
      try {
        suffix = '.js';
        if (~match.indexOf('.js')) {
          suffix = '';
        }
        filePath = path.resolve(fileDir, match) + suffix;
        stats = fs.statSync(filePath);
      }
      catch (ex) {
        this.logger.log(ex);
      }
    }

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
  var self = this;
  var src = props.src;
  var cwd = props.cwd || processCwd;

  if (typeof src === 'string') {
    if (src.charAt(0) !== '/') {
      src = path.resolve(cwd, src);
    }
  }

  return new Promise(function(resolve, reject) {
    self.glob(src).then(function(filesArr) {
      self.searchForDependencies(bundleName, filesArr, props).then(function(modules) {
        resolve(modules);
      });
    }).catch(self.logger.log);
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
  var b, src, dest, self = this;
  var basePath = (!!props.cwd) ? path.resolve(props.cwd) : processCwd;
  var bMethod = (!!props.useRequire) ? 'require' : 'add';
  var prefix = props.prefix || false;

  if (this.streams) {
    src = props.src;
    dest = props.dest;
  }
  else {
    src = (!!props.cwd) ? path.resolve(props.cwd, props.src) : path.resolve(props.src);

    if (props.dest.charAt(0) === '/') {
      dest = props.dest;
    }
    else {
      dest = path.resolve(props.dest);
    }
  }

  if (!props.watch) {
    b = browserify(props.browserifyOpts || {});
  }
  else {
    var wOpts = assign({}, props.watchifyOpts, props.browserifyOpts);
    wOpts.cache = wOpts.cache || {};
    wOpts.packageCache = wOpts.packageCache || {};
    b = browserify(wOpts);
    b = watchify(b);
  }

  var vendorBundle = Promise.resolve();

  if (!modules || !modules.length) {
    vendorBundle = self.configureVendorBundle('vendor-'+bundleName, props, bundleName, aliases);
  }
  else {
    if (!props.watch) {
      if (!props.browserifyOpts || !props.browserifyOpts.standalone) {
        b.external(modules);
        vendorBundle = self.configureVendorBundle('vendor-'+bundleName, props, bundleName, aliases);
      }
    }
    else {
      if (!props.watchifyOpts || !props.watchifyOpts.standalone) {
        b.external(modules);
        vendorBundle = self.configureVendorBundle('vendor-'+bundleName, props, bundleName, aliases);
      }
    }
  }

  return vendorBundle.then(function() {
    return self.glob(src).then(function(filesArr) {
      return Promise.all(filesArr
        .filter(function(file) {
          // prevent trying to add a directory
          // to the bundle.
          if (!path.extname(file)) {
            return false;
          }

          var expose = file.replace(basePath + '/', '');

          if (!!props.ignoreFiles && ~props.ignoreFiles.indexOf(expose)) {
            b.ignore(file);
            return false;
          }

          return true;
        })
        .map(function(file) {
          var src;
          var minimatchOpts = { matchBase: true };
          var isMatch = false;
          var expose = file.replace(basePath + '/', '');

          // clone expose path to use in
          // matching functionality when prefix
          // is an object
          var mutableExpose = expose;

          if (!!prefix) {

            if (typeof prefix === 'string') {

              // If the prefix is a string it
              // should be prepended to all expose
              // paths
              if (prefix.slice(-1) !== '/') {
                prefix += '/';
              }

              expose = prefix + expose;
            }
            else {

              // If the prefix is an object, it contains at least
              // a src and dest in which case we need to match the
              // filepath to check if it should be rewritten in the 
              // expose
              if (prefix.options) {
                minimatchOpts = prefix.options;
              }

              // update expose to be relative to prefix.cwd
              if (prefix.cwd) {
                mutableExpose = path.relative(prefix.cwd, mutableExpose);
              }

              // if the path start with a .. it means the pattern didn't
              // match since the expose path is at least one directory lower
              // than it should be
              if (mutableExpose.charAt(0) !== '.') {
                if (typeof prefix.src === 'string') {
                  isMatch = minimatch(mutableExpose, prefix.src, minimatchOpts);
                }
                else {
                  for (var i = 0; i < prefix.src.length; i++) {
                    src = prefix.src[i];

                    if (isMatch = minimatch(mutableExpose, src, minimatchOpts)) {
                      break;
                    }
                  }
                }

                // If the expose path matches the pattern,
                // prepend it with the prefix.dest
                if (isMatch) {

                  if (prefix.dest.slice(-1) !== '/') {
                    prefix.dest += '/';
                  }

                  expose = prefix.dest + mutableExpose;
                }
              }
            }
          }

          // remove file extensions
          expose = expose.substr(0, expose.lastIndexOf('.'));

          b[bMethod](file, { expose: expose });

          return file;
        })
      ).then(function() {

        if (!props.watch) {
          self.logger.log('Building "'+ bundleName +'" bundle...');
        }

        return self.createBundle(b, bundleName, dest, props).catch(self.logger.log);

      }).catch(self.logger.log);
    }).catch(self.logger.log);
  });
};


Mundler.prototype.addVendorTransforms = function(b, transforms) {
  if (!!transforms) {
    transforms.forEach(function(transform) {
      if (typeof transform === 'string') {
        b.transform(transform, { global: true });
      }
      else {
        var transformLib = transform[0];
        var transformOpts = transform[1];
        transformOpts.global = true;
        b.transform(transformLib, transformOpts);
      }
    });
  }
}

/**
 * Sets up browserify bundle for external modules
 * @param {String} bundleName
 * @param {Object} props
 * @param {String} parentBundle
 * @param {Object} aliases 
 */
Mundler.prototype.configureVendorBundle = function(bundleName, props, parentBundle, aliases, file) {
  var filePath, moduleList, dest;
  var self = this;
  var modules = [];
  var moduleCache = this.moduleCache[parentBundle] || {};
  var vprops = assign({}, props);
  var b = browserify(props.browserifyOpts || {});
  vprops.watch = false;
  vprops.vendor = true;
  vprops.preTasks = false;
  vprops.postTasks = false;

  if (!!this.streams) {
    dest = bundleName;
  }
  else {
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
  }


  //
  // Add transforms, if any, to vendor files
  //
  if (!!props.transformVendorFiles) {
    if (typeof props.transformVendorFiles === 'object') {
      this.addVendorTransforms(b, props.transformVendorFiles);
    }
    else {
      this.getPackageProperty('browserify').then(function(prop) {
        self.addVendorTransforms(b, prop.transform);
      });
    }
  }

  // since vendor bundles aren't watched, this method is
  // only called the first time mundler is run, or when an
  // external dependency is added or removed. So everytime
  // it's called we want to reset the cache.
  this.vendorBundleCache[bundleName] = '';

  return new Promise(function(resolve, reject) {
    Object.keys(moduleCache).forEach(function(filename) {
      moduleList = moduleCache[filename];

      moduleList.forEach(function(module) {
        if (modules.indexOf(module) === -1) {
          modules.push(module);
        }
      });
    });

    if (!modules || !modules.length) {
      // reset the vendor bundle's cache
      return resolve(false);
    }

    modules.forEach(function(module) {
      // Ignore browserShims
      if (!self.browserShims[module]) {
        // If we have defined aliases, expose it in the bundle
        if (!!aliases && !!aliases[module]) {
          filePath = path.resolve(aliases[module]);
          b.require(filePath, { expose: module });
        }
        else {
          b.require(module);
        }
      }
    });

    // If we're not watching this bundle, log that
    // we're about to build it.
    if (!props.watch && !props.concat) {
      self.logger.log('Building "'+ bundleName +'" bundle...');
    }

    self.writeToFileOrStream(b, bundleName, dest, vprops).then(resolve).catch(self.logger.log);
  });
};


Mundler.prototype.taskFunctionCallback = function(resolve, reject) {
  var self = this;

  return function(err) {
    if (err) {
      self.logger.log(chalk.red('Function task failed'));
      return reject(err);
    }
    
    return resolve();
  }
};

Mundler.prototype.taskRunCommand = function(task, file) {
  var self = this;

  return new Promise(function(resolve, reject) {
    self.logger.log('Running task "'+task+'"');

    var run = exec('export MUNDLER_MODIFIED_FILE='+file+'; '+task);
    run.stdout.pipe(process.stdout);
    run.on('close', function(code) {
      if (code !== 0) {
        self.logger.log(chalk.red('Task "'+task+'" failed'));
        reject('');
      }
      else {
        self.logger.log('Task "'+task+'" completed successfully\n');
        resolve();
      }
    });
  });
};

Mundler.prototype.taskRunFunction = function(task, file) {
  var _this = this;
  return new Promise(function(resolve, reject) {
    var callback = _this.taskFunctionCallback(resolve, reject);
    return task(file, callback);
  });
};


/**
 * Executes a command
 * @param {Array/String} tasks
 */
Mundler.prototype.runTasks = function(tasks, file) {
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
    return this.taskRunCommand(tasks, file);
  }
  else if (typeof tasks === 'function') {
    // If tasks is a function, run it and pass in
    // a callback to resolve the Promise.
    return this.taskRunFunction(tasks, file);
  }
  else {
    return Promise.all(tasks
      .filter(function(task) {
        return (typeof task === 'string' || typeof task === 'function');
      })
      .map(function(task) {
        if (typeof task === 'string') {
          return _this.taskRunCommand(task, file);
        }

        return _this.taskRunFunction(task, file);
      })
    );
  }
};

Mundler.prototype.checkFileForChanges = function(file, name) {
  var self = this;
  var requireRe = /(?:require\(|import(?:\s.*\sfrom)?\s)(?:'|")(.*?)(?:'|")(\))?/g;
  var commentsRe = /(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm;
  var moduleCache = this.moduleCache[name][file];

  return this.readFile(file).then(function(data) {

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
    }).catch(self.logger.log);
  }).catch(self.logger.log);
}

Mundler.prototype.reconfigureBundle = function(changed, file, name, props, b) {
  var self = this;

  if (!changed) {
    return Promise.resolve(false);
  }
  else {
    this.logger.log(chalk.green('Detected '+changed+'"... rebuilding before bundling "'+name+'"'));

    //
    // rebuild new module list and bundle
    //
    this.start = new Date().getTime();

    var tempModuleList = [];
    var modulesList = [];
    var aliases = this.browserAliases || {};
    var shims = this.browserShims || {};

    return Promise.all(Object.keys(self.moduleCache[name])
      .map(function(filename) {
        tempModuleList = tempModuleList.concat(self.moduleCache[name][filename]);
      })
    ).then(function() {

      return Promise.all(tempModuleList
        .filter(function(m) {
          return (modulesList.indexOf(m) === -1 && !shims[m]);
        })
        .map(function(m) {
          modulesList.push(m);
          return m;
        })
      ).catch(function(e) {
        b.bundle(); // called again to prevent watchify from dying
        self.logger.log(e)
      });

    }).then(function(modules) {

      return self.configureVendorBundle('vendor-'+name, props, name, aliases, file);

    }).catch(function(e) {

      b.bundle(); // called again to prevent watchify from dying
      self.logger.log(e)
    });
  }
}

Mundler.prototype.writeToFileOrStream = function(b, name, dest, props, changedFile) {
  var self = this;
  var end, bundleStream, bundleStreamFile, streamObj, bundlePath;
  var writeToFile = true;
  var preTasks = false;
  var postTasks = false;

  if (!props.vendor) {
    preTasks = props.preTasks || this.options.preTasks || false;
    postTasks = props.postTasks || this.options.postTasks ||  false;
  }

  return new Promise(function(resolve, reject) {

    self.runTasks(preTasks, changedFile).then(function() {
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
          end = new Date().getTime();
          self.logger.log(chalk.yellow('Bundle "'+name+'"') + ': created in %s seconds and cached for concatenation\n', (end - self.start) / 1000);
          return resolve(buf);
        }

        if (!!self.streams) {

          if (~dest.indexOf('.js')) {
            bundlePath = dest;
          }
          else {
            bundlePath = dest + '.js';
          }

          bundleStream = new Readable({ objectMode: true });
          bundleStreamFile = new File({
            path: bundlePath,
            contents: new Buffer(buf)
          });
          bundleStream.push(bundleStreamFile);
          bundleStream.push(null);

          end = new Date().getTime();

          streamObj = {
            filename: path.basename(dest),
            bundle: bundleStream,
            time: (end - self.start) / 1000
          };

          self.emit('update', streamObj);

          self.runTasks(postTasks, changedFile).catch(self.logger.log);

          return resolve(streamObj);
        }

        fs.writeFile(dest, buf, function(err) {
          if (err) {
            return reject(err);
          }

          end = new Date().getTime();
          self.logger.log(chalk.yellow('Bundle "'+name+'"') + ': written in %s seconds\n', (end - self.start) / 1000);

          self.runTasks(postTasks, changedFile).catch(self.logger.log);

          return resolve(buf);
        });
      });
    }).catch(function(e) {
      b.bundle().on('error', function(err) {
        self.logger.log(chalk.red('[Error]: ') + err.message);
      });

      self.logger.log(e);
    });
  });
}

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
  var preBundle = props.preBundle || this.options.preBundle || false;

  if (!!preBundle) {
    if (typeof preBundle !== 'function') {
      throw new Error('preBundle must be a function');
    }

    preBundle(b);
  }

  b.on('update', function(ids) {
    self.start = new Date().getTime();

    // reevaluate module list
    var file = ids[0];

    self.moduleCache[name] = self.moduleCache[name] || {};
    self.moduleCache[name][file] = self.moduleCache[name][file] || [];
    self.fullModuleList[name] = self.fullModuleList[name] || {};

    self.checkFileForChanges(file, name)
      .then(function(changed) {

        return self.reconfigureBundle(changed, file, name, props, b);
      })
      .then(function() {

        return self.writeToFileOrStream(b, name, props.dest, props, file);
      }).catch(function(e) {

        b.bundle().on('error', function(err) {
          self.logger.log(chalk.red('[Error]: ') + err.message);
        });

        self.logger.log(e);
      });
  });

  return new Promise(function(resolve, reject) {

    // If we're watching this bundle, don't write
    // to file/stream the first time (except if it's
    // a vendor bundle)
    if (!!props.watch) {

      b.bundle().on('error', function(err) {
        self.logger.log(chalk.red('[Error]: ') + err.message);
      });

      return resolve(true);
    }

    return self.writeToFileOrStream(b, name, dest, props).then(resolve).catch(function(e) {

      b.bundle().on('error', function(err) {
        self.logger.log(chalk.red('[Error]: ') + err.message);
      });

      self.logger.log(e);
    });
  });
};

module.exports = Mundler;
