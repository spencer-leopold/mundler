var chai = require('chai');
var chaiAsPromised = require("chai-as-promised");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var should = chai.should();
var Mundler = require('../../index');

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('lib/mundler', function() {

  var testConfig = {
    test: {
      cwd: 'test/',
      src: 'fixtures/**/*.js',
      dest: '../test_output/testOutput.js'
    }
  };

  var testConfigNoCwd = {
    test: {
      src: 'test/fixtures/**/*.js',
      dest: '../test_output/testOutput.js'
    }
  };

  describe('Mundler', function() {
    var m;

    beforeEach(function() {
      m = Mundler(testConfig);
    });

    describe('#getPackageProperty()', function() {
      it('should return a property if it exists in package.json', function() {
        return m.getPackageProperty('version').should.eventually.equal('1.0.0');
      });

      it('should return empty object if not found', function() {
        return m.getPackageProperty('nonExistentProperty').should.eventually.deep.equal({});
      });
    });

    describe('#buildDependencyList()', function() {

      it('should return object containing array of external module dependencies', function() {
        var expectedValues = {
          bundle: 'test',
          props: testConfig.test,
          modules: ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk', 'chai']
        };

        return m.buildDependencyList('test', testConfig.test).should.eventually.deep.equal(expectedValues);
      });

      it('should work if no CWD is set', function() {
        var expectedValues = {
          bundle: 'test',
          props: testConfigNoCwd.test,
          modules: ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk', 'chai']
        };

        return m.buildDependencyList('test', testConfigNoCwd.test).should.eventually.deep.equal(expectedValues);
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
