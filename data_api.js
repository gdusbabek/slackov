var fs = require('fs');
var path = require('path');
var util = require('util');

var async = require('async');
var argv = require('minimist')(process.argv.slice(2));

var workDir = argv.workDir || process.env.WORK_DIR || './work';

function DataApi() {
  this.name = 'default';
}

DataApi.prototype.getState = function(callback) {
  var stub = 
  callback(null, {
    lastUpdate: 1, // if you use 0, the slack API gets confused (because a falsey).
    channelFetchTimes: {}
  }); 
}

DataApi.prototype.getMarkovData = function(userId, userName, callback) {
  callback(null, {});
}

DataApi.prototype.saveRaw = function(rawPath, txt, callback) {
  callback(null);
}

DataApi.prototype.getRaw = function(rawPath, callback) {
  callback(null, '');
}

function S3DataApi(container) {
  DataApi.call(this, arguments);
  this.name = 's3';
  this.container = container;
}

util.inherits(S3DataApi, DataApi);

S3DataApi.prototype.getState = function(callback) {
  callback(new Error('Not implemented'), null);
}

S3DataApi.prototype.getMarkovData = function(userId, userName, callback) {
  callback(new Error('not implemented'), null);
}

S3DataApi.prototype.getRaw = function(rawPath, callback) {
  callback(new Error('not implemented'));
}

S3DataApi.prototype.saveRaw = function(rawPath, txt, callback) {
  callback(new Error('not implemented'));
}

function FsDataApi(dataDir) {
  DataApi.call(this, arguments);
  this.workDir = dataDir || workDir; 
  this.name = 'fs';
}

util.inherits(FsDataApi, DataApi);

FsDataApi.prototype.getState = function(callback) {
  this.getRaw('state.json', callback);
};

FsDataApi.prototype.getMarkovData = function(userId, userName, callback) {
  this.getRaw('markov_' + userId + '_' + userName + '.json', callback);
}

FsDataApi.prototype.getRaw = function(rawPath, callback) {
  
  var filePath = path.join(this.workDir, rawPath),
      exists = fs.existsSync(filePath),
      json = exists ? fs.readFileSync(filePath) : null;
  if (!exists) {
    callback(new Error('cannot fetch path ' + rawPath));
  } else {
    callback(null, JSON.parse(json));
  }
}

FsDataApi.prototype.writeRaw = function(rawPath, txt, callback) {
  var filePath = path.join(this.workDir, rawPath);
  fs.writeFileSync(filePath, txt);
  callback(null);
}

function FallbackDataApi() {
  this.name = 'fallback';
  var apis = [],
      i = 0;
  for (i = 0; i < arguments.length; i += 1) {
    apis.push(arguments[i]);
  }
  apis.push(new DataApi());
  this.apis = apis;
}

FallbackDataApi.prototype.getState = function(callback) {
  var got = false;
  async.eachSeries(this.apis, function getState(api, callback) {
    if (got) {
      callback(null, got);
    } else {
      api.getState(function(err, result) {
        if (!err) {
          got = result;
        }
        callback(null, got); // swallow err.
      });
    }
  }, function(err) {
    callback(err, got);
  });
};

FallbackDataApi.prototype.getMarkovData = function(userId, userName, callback) {
  var got = false;
  async.eachSeries(this.apis, function getMarkovData(api, callback) {
    if (got) {
      callback(null, got);
    } else {
      api.getMarkovData(userId, userName, function(err, result) {
        if (!err) {
          got = result;
        }
        callback(null, got)
      });
    }
  }, function(err) {
    callback(err, got);
  })
}

exports.DataApi = DataApi;
exports.S3DataApi = S3DataApi;
exports.FsDataApi = FsDataApi;
exports.FallbackDataApi = FallbackDataApi;