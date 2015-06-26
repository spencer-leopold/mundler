var path = require('path');
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
        var match = m.processMatch(['fixtures/sample.js'], 'chai', testConfig.test);
        match.should.equal('chai');
      });

      it('should return false if already collected', function() {
        var match = m.processMatch(['fixtures/sample.js'], 'chai', testConfig.test, ['chai']);
        match.should.equal(false);
      });

      it('should recurse if match is internal', function() {
        var expectedmodules = ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk'];
        var spy = sinon.spy(m, 'processMatch');
        
        return m.processMatch([path.resolve('test/fixtures/sample.js')], '../../lib/mundler', testConfig.test).then(function(modules) {
          spy.should.have.been.callCount(7); // once for initial call and once for each module found (modules in array above)
          modules.should.deep.equal(expectedmodules);
        });
      });
    });

    describe('#buildBundle()', function() {
      it('should add all internal dependencies to browserify', function() {
      });

      it('should call buildVendorBundle if any file contains external modules', function() {
      });

      it('should require all external modules to browserify', function() {
      });
    });

    describe('#buildVendorBundle()', function() {
      it('should add all external dependencies to browserify', function() {
      });
    });

    describe('#bundle()', function() {
    });
  });

});
