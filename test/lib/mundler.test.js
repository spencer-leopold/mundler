var path = require('path');
var chai = require('chai');
var chaiAsPromised = require("chai-as-promised");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var expect = chai.expect;
var should = chai.should();
var Mundler = require('../../index');

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('lib/mundler', function() {

  var testConfig = {
    test: {
      cwd: 'test/',
      src: 'fixtures/**/*.js',
      dest: 'output/test.js'
    }
  };

  var testConfigNoCwd = {
    test: {
      src: 'test/fixtures/**/*.js',
      dest: 'output/test.js'
    }
  };

  var testConfigMissingSrc = {
    test: {
      dest: 'output/test.js'
    }
  };

  var testConfigMissingDest = {
    test: {
      src: 'test/fixtures/**/*.js',
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
          name: 'test',
          props: testConfig.test,
          modules: ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk', 'chai']
        };

        return m.buildDependencyList('test', testConfig.test).should.eventually.deep.equal(expectedValues);
      });

      it('should work if no CWD is set', function() {
        var expectedValues = {
          name: 'test',
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

    describe('#configureBundle()', function() {
      it('should add external files and call Mundler.configureVendorBundle()', function() {
        var spy = sinon.spy(m, 'configureVendorBundle');
        var modules = ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk'];
        m.configureBundle('test', testConfig.test, modules);
        spy.should.have.been.calledOnce;
      });

      it('should configure main bundle and call Mundler.bundle()', function(done) {
        var spy = sinon.spy(m, 'bundle');
        m.configureBundle('test', testConfig.test);

        // give it enough time to call bundle
        // before checking if it was called or not
        setTimeout(function() {
          spy.should.have.been.calledOnce;
          done();
        }, 1000);
      });
    });

    describe('#configureVendorBundle()', function() {
      it('should configure vendor bundle and call Mundler.bundle()', function() {
        var spy = sinon.spy(m, 'bundle');
        var modules = ['fs', 'path', 'browserify', 'watchify', 'when', 'chalk'];

        m.configureVendorBundle('vendor-test', path.resolve('test/output/test.js'), false, modules);
        spy.should.have.been.calledOnce;
      });

      it('should not call Mundler.bundle() if not modules or aliases are passed', function() {
      });
    });

    describe('#bundle()', function() {
    });

    describe('#start()', function() {
      it('should throw error if missing "src" property', function(done) {
        var m = Mundler(testConfigMissingSrc);
        var spy = sinon.spy(m, 'verifyRequiredProps');

        m.start();

        // give it enough time to call verifyProps
        // before checking if it was called or not
        setTimeout(function() {
          var spyCall = spy.getCall(0);
          spy.should.have.been.calledOnce;
          spyCall.exception.should.deep.equal(new Error('Missing property "src" in Mundler config for bundle: test'));
          done();
        }, 500);
      });

      it('should throw error if missing "dest" property', function(done) {
        var m = Mundler(testConfigMissingSrc);
        var spy = sinon.spy(m, 'verifyRequiredProps');

        m.start();

        // give it enough time to call verifyProps
        // before checking if it was called or not
        setTimeout(function() {
          var spyCall = spy.getCall(0);
          spy.should.have.been.calledOnce;
          spyCall.exception.should.deep.equal(new Error('Missing property "dest" in Mundler config for bundle: test'));
          done();
        }, 500);
      });
    });
  });

});
