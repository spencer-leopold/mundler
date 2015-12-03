[![travis-ci status](https://api.travis-ci.org/spencer-leopold/mundler.png)](http://travis-ci.org/#!/spencer-leopold/mundler/builds)
[![Dependency Status](https://david-dm.org/spencer-leopold/mundler.png)](https://david-dm.org/spencer-leopold/mundler)
[![Coverage Status](https://coveralls.io/repos/spencer-leopold/mundler/badge.png)](https://coveralls.io/r/spencer-leopold/mundler)

# Mundler

The main purpose of this module is for quicker browserify builds during development. It automatically pulls out vendor/external modules and bundles them up separately, either creating a separate file for it or prepending it to your main bundle.

## Setup

Configuration can either be added directly into your package.json, or you can create a mundler.config.js file in order to use some of the additional features.

# Install

With [npm](http://npmjs.org) do:

```
npm install mundler
```

# Usage

```
Usage: mundler {OPTIONS}

Options:

    --config, -c  Path to a custom configuration file.

    --watch, -w  A bundle name to watch. You can repeat 
                  this option for each bundle you want to
                  watch.
```

# Example
_using standalone_ 

```
  $ mundler -w my-bundle -w my-other-bundle
```

# Configuration using package.json

```
...
  "mundler": {
    "my-bundle": {
      "src": "src/js/app/main.js",
      "dest": "dist/js/my-bundle.js",
      "concat": true
    },
    "my-other-bundle": {
      "cwd": "src/js/app/modules",
      "src": "**/*.js",
      "dest": "dist/js/my-other-bundle.js",
      "preTasks": [
        "npm run jshint -s",
        "other task here"
      ]
    }
  }
...
  "scripts": {
    "uglify": "uglifyjs dist/js/my-other-bundle.js -o dist/js/my-other-bundle.min.js -c warnings=false -m --stats",
    "jshint": "jshint src/js/app/modules/**/*.js --verbose",
    "watch:scripts": "mundler -w my-bundle -w my-other-bundle",
    "build:scripts": "mundler && npm run uglify",
    "dev": "npm run watch:scripts",
    "prod": "npm run build:scripts"
  }
```

# Example
_using the above package.json_

```
  $ npm run dev
```

# Configuration using mundler.config.js

_(in your project's root)_

```js
module.exports = {
  "my-bundle": {
    src: 'src/js/app/main.js',
    dest: 'dist/js/my-bundle.js',
    vendorDest: 'dist/js/my-vendor-bundle.js',
    preBundle: function(b) {
      b.transform('babelify');
    }
  },
  "my-other-bundle": {
    cwd: 'src/js/app/modules',
    src: '**/*.js',
    dest: 'dist/js/my-other-bundle.js',
    preTasks: [
      'npm run jshint -s',
      'my other task'
    ],
    postTasks: 'npm run uglify -s'
  }
}
```

# Example using nodemon with a postTask callback to restart it.

```js
var nodemon = require('nodemon');
var nodemon_instance;

nodemon_instance = nodemon({
  script: './server.js',
  verbose: true,
  ext: 'js jsx',
  ignore: [
    '.git',
    'app',
    'dist',
    'node_modules'
  ],
  execMap: {
    js: 'iojs'
  }
}).on('restart', function() {
  console.log('~~~ restart server ~~~');
});

module.exports = {
  app: {
    cwd: 'app/',
    src: '**/*.j{s,sx}',
    dest: 'dist/js/bundle-main.js',
    concat: true,
    prefix: 'app/',
    preTasks: [
      'npm run jshint -s'
    ],
    postTasks: function(done) {
      nodemon_instance.emit('restart');
      done();
    },
    useRequire: true,
    transformVendorFiles: true,
    browserifyOpts: {
      ignoreMissing: true
    }
  }
};
```

# All Config Options

```
cwd: 'path/to/cwd'                  optional

src: 'path/to/entry-file'           required, accepts a glob

dest: 'path/to/destination-file'    required

vendorDest: 'path/to/vendor/destination-file'

  optional, defaults to destination file prefixed with "vendor"

concat: Boolean                     optional, defaults to false

watch: Boolean                      optional, defaults to false

ignoreFiles: Array                  
  
  Optional, array of files to ignore - relative to either the
  CWD (if used) or project root

preBundle: function(b)

  Optional, configure the browserify object before bundling.
  Apply transforms, add/require additonal files, etc.

useRequire: Boolean

  Optional, defaults to false. This changes b.add to b.require
  for internal files.  Setting it to TRUE makes your file 
  available to require() in external modules.

browserifyOpts: Object              optional, configures browserify

watchifyOpts: Object                optional, configures watchify options

preTasks: Array/String/Function     optional, commands to run before bundle is created

postTasks: Array/String/Function    optional, commands to run after bundle is created
```
