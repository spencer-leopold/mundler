var chai = require('chai');
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var Events = require('../../shared/events');
var should = chai.should();

chai.use(sinonChai);

describe('lib/mundler', function() {

  describe('Mundler', function() {

    describe('#initOptions()', function() {
      it('should return an object of configuration options', function() {
      });

      it('should look for in package.json if no custom path is passed in', function() {
      });

      it('should look for a mundler.config file if not set in package.json', function() {
      });
    });

    describe('#browserAliasCheck()', function() {
      it('should look for a browser json object in package.json', function() {
      });

      it('should return false if not found', function() {
      });
    });

    describe('#loadBrowserConfig()', function() {
      it('should look for browser object if TRUE is not first argument', function() {
      });

      it('should look for browserify-shims object if TRUE is first argument', function() {
      });

      it('should return a promise', function() {
      });

      it('should return a promise that resolves to an empty object if nothing found', function() {
      });
    });

    describe('#searchForDependencies()', function() {
      it('should search file for any external imports', function() {
      });

      it('should search file for any external requires', function() {
      });

      it('should recurse through internal dependencies, looking for other external dependencies', function() {
      });
    });

    describe('#processMatch()', function() {
      it('should return match if it\'s an external module', function() {
      });

      it('should return false if already collected', function() {
      });

      it('should recurse if match is internal', function() {
      });
    });

    describe('#checkFilesForDependencies()', function() {
      it('should call searchForDependencies once for each file if src is a glob', function() {
      });

      it('should return a promise', function() {
      });

      it('should resolve to an object that contains all external dependencies found', function() {
      });
    });

    describe('#buildBundle()', function() {
    });

    describe('#buildVendorBundle()', function() {
    });

    describe('#bundle()', function() {
    });
  });

});
