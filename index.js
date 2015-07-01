var path = require('path');
var fs = require('fs');
var Mundler = require('./lib/mundler');

module.exports = function mundlerInit(o, args) {
  var options;

  if (!!o) {
    if (typeof o !== 'object' || Array.isArray(o)) {
      throw new Error('Mundler options must be an object');
    }

    options = o;
  }
  else if (args && !!args.config) {
    try {
      options = require(args.config);
    }
    catch (e) {
      throw e;
    }
  }
  else {
    try {
      var package = require(path.resolve('package.json'));

      if (!!package.mundler) {
        options = package.mundler;
      }
      else {
        var config = path.resolve('mundler.config.js');

        if (fs.existsSync(config)) {
          options = require(config);
        }
        else {
          throw new Error('Cannot find mundler.config.js configuration');
        }
      }
    }
    catch (e) {
      throw e;
    }
  }

  return new Mundler(options, args);
}
