var path = require('path');
var chai = require('chai');
var chaiAsPromised = require("chai-as-promised");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var expect = chai.expect;
var should = chai.should();
var Mundler = require('../index');

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('mundlerInit', function() {
  var testConfig = {
    test: {
      cwd: 'test/',
      src: 'fixtures/**/*.js',
      dest: 'output/test.js'
    }
  };

  it('should accept an object being passed in', function() {
    var m = Mundler(testConfig);
    var defaults = {
      options: testConfig,
      watchAll: false,
      watch: false,
      browserAliasesAndShims: [],
      vendorBundleCache: {}
    };

    for (prop in defaults) {
      m[prop].should.deep.equal(defaults[prop]);
    }
  });

  it('should accept a config file path as a argument', function() {
    var m = Mundler(null, { config: './test/helpers/testConfig.js' });

    var defaults = {
      options: testConfig,
      watchAll: false,
      watch: false,
      browserAliasesAndShims: [],
      vendorBundleCache: {}
    };

    for (prop in defaults) {
      m[prop].should.deep.equal(defaults[prop]);
    }
  });

  it('should throw an error if the first argument is not an object', function() {
    var spy = sinon.spy(Mundler);

    expect(function() {
      var m = Mundler(['test']);
      console.log(m);
    }).to.throw('Mundler options must be an object');
  });

  it('should throw an error if config path argument cannot be found', function() {
    var spy = sinon.spy(Mundler);

    expect(function() {
      Mundler(null, { config: './helpers/testConfig.js' });
    }).to.throw("Cannot find module './helpers/testConfig.js'");
  });

  it('should throw an error if it cannot find a mundler.config.js or a mundler property in package.json', function() {
    var spy = sinon.spy(Mundler);

    expect(function() {
      Mundler(null);
    }).to.throw("Cannot find mundler.config.js configuration");
  });
});
