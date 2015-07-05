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
        return m.getPackageProperty('version').should.eventually.equal('1.2.3');
      });

      it('should return empty object if not found', function() {
        return m.getPackageProperty('nonExistentProperty').should.eventually.deep.equal({});
      });

    });

    describe('#searchForDependencies()', function() {

      it('should remove comments before searching file for requires/imports', function() {
        return m.searchForDependencies('test', [path.resolve('test/fixtures/sample.js')], testConfig.test).should.eventually.not.contain('fakeLatte');
      });

      it('should find all requires/imports', function() {
        var expectedValues = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk', 'chai'];
        return m.searchForDependencies('test', [path.resolve('test/fixtures/sample.js')], testConfig.test).should.eventually.deep.equal(expectedValues);
      });

    });

    describe('#buildDependencyList()', function() {

      it('should return object containing array of external module dependencies', function() {
        var expectedValues = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk', 'chai'];
        return m.buildDependencyList('test', testConfig.test).should.eventually.deep.equal(expectedValues);
      });

      it('should work if no CWD is set', function() {
        var expectedValues = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk', 'chai'];
        return m.buildDependencyList('test', testConfigNoCwd.test).should.eventually.deep.equal(expectedValues);
      });

    });

    describe('#processMatch()', function() {

      it('should return match if it\'s an external module', function() {
        var match = m.processMatch('test', ['fixtures/sample.js'], 'chai', testConfig.test);
        match.should.equal('chai');
      });

      it('should return false if already collected', function() {
        var match = m.processMatch('test', ['fixtures/sample.js'], 'chai', testConfig.test, ['chai']);
        match.should.equal(false);
      });

      it('should recurse if match is internal', function() {
        var expectedmodules = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk'];
        var spy = sinon.spy(m, 'processMatch');
        
        return m.processMatch('test', [path.resolve('test/fixtures/sample.js')], '../../lib/mundler', testConfig.test).then(function(modules) {
          spy.should.have.been.callCount(7); // once for initial call and once for each module found (modules in array above)
          modules.should.deep.equal(expectedmodules);
        });
      });

    });

    describe('#readFile()', function() {

      it('should return a promise with the value of the contents of a file if found', function() {
        return m.readFile(path.resolve('test/helpers/testConfig.js')).should.eventually.deep.equal("module.exports = {\n  test: {\n    cwd: \'test/\',\n    src: \'fixtures/**/*.js\',\n    dest: \'output/test.js\'\n  }\n};\n");
      });

      it('should reject with an error if not found', function() {
        return m.readFile(path.resolve('test/helpers/nonExistent.js')).should.be.rejectedWith("ENOENT");
      });

    });

    describe('#glob()', function() {

      it('should return a promise with an array of files', function() {
        return m.glob(path.resolve('test') + '/**/*.js').should.eventually.have.length(5);
      });

      it('should reject with an error if not found', function() {
        return m.glob(path.resolve('nonExistentTest') + '/**/*.js').should.reject;
      });

    });

    describe('#runTasks()', function() {

      it('should accept an array or a string', function() {
        var spy = sinon.spy(m, 'runTasks');
        return m.runTasks('echo "testing runTasks"').should.eventually.equal(0);
      });

      it('should kill bundle process with promise rejection if task fails', function() {
        var spy = sinon.spy(m, 'runTasks');
        return m.runTasks('nonexistentcommandtorun').should.be.rejectedWith('Task "nonexistentcommandtorun" failed');
      });

    });

    describe('#configureBundle()', function() {

      it('should add external files and call Mundler.configureVendorBundle()', function() {
        var spy = sinon.spy(m, 'configureVendorBundle');
        var modules = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk'];
        m.configureBundle('test', testConfig.test, modules);
        spy.should.have.been.calledOnce;
      });

      it('should configure main bundle and call Mundler.createBundle()', function(done) {
        var spy = sinon.spy(m, 'createBundle');
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

      it('should configure vendor bundle and call Mundler.createBundle()', function() {
        var spy = sinon.spy(m, 'createBundle');
        var modules = ['fs', 'path', 'browserify', 'watchify', 'bluebird', 'chalk'];

        m.configureVendorBundle('vendor-test', { vendorDest: path.resolve('test/output/test.js') }, modules);
        spy.should.have.been.calledOnce;
      });

      it('should not call Mundler.createBundle() if no modules or aliases are passed', function() {
        var spy = sinon.spy(m, 'createBundle');
        m.configureVendorBundle('vendor-test', { vendorDest: path.resolve('test/output/test.js') });
        spy.should.not.have.been.called;
      });

    });

    describe('#bundle()', function() {

      it('should throw error if missing "src" property', function() {
        var m = Mundler(testConfigMissingSrc);
        var spy = sinon.spy(m, 'verifyRequiredProps');

        m.bundle()

        spy.should.have.been.calledOnce;
        return spy.returnValues[0].should.be.rejectedWith('Missing property "src" in Mundler config for bundle: test');
      });

      it('should throw error if missing "dest" property', function() {
        var m = Mundler(testConfigMissingDest);
        var spy = sinon.spy(m, 'verifyRequiredProps');

        m.bundle()

        spy.should.have.been.calledOnce;
        return spy.returnValues[0].should.be.rejectedWith('Missing property "dest" in Mundler config for bundle: test');
      });

      it('should halt execution if missing a require prop', function() {
        var m = Mundler(testConfigMissingDest);
        var bundleSpy = sinon.spy(m, 'createBundle');

        m.bundle()

        bundleSpy.should.not.have.been.called;
      });

    });

  });

});
