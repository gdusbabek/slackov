var fs = require('fs');
var path = require('path');

var argv = require('minimist')(process.argv.slice(2));
var express = require('express');
var cool = require('cool-ascii-faces');

var FsApi = require('./data_api').FsDataApi;
var S3Api = require('./data_api').S3DataApi;
var FallbackDataApi = require('./data_api').FallbackDataApi;
var markov = require('./markov');

var workDir = argv.workDir || process.env.WORK_DIR || './work';
var dataApi = new FallbackDataApi(new S3Api(), new FsApi(workDir));

var cachedMarkovs = {},
    usersById = JSON.parse(fs.readFileSync(path.join(workDir, 'users.json'))),
    usersByName = invert(usersById);

var app = express();

function invert(obj) {
  var newObj = {};
  Object.keys(obj).forEach(function(oldKey) {
    newObj[obj[oldKey]] = oldKey;
  });
  return newObj;
}

function getMarkov(userId, userName, callback) {
  if (cachedMarkovs.hasOwnProperty(userId)) {
    callback(null, cachedMarkovs[userId]);
  } else {
    dataApi.getMarkovData(userId, userName, function(err, obj) {
      if (!obj) {
        obj = {};
      }
      cachedMarkovs[userId] = markov(2, obj);
      callback(err, cachedMarkovs[userId]);
    });
  }
}

function convert(err) {
  return {
    err: err
  };
}

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

app.get('/', function(request, response) {
  response.send(cool());
});

app.get('/better', function(request, response) {
  response.send('Now it\'s better!');
});

app.get('/chat/:user', function(req, res) {
  var userName = req.params.user,
      seed = req.query.hasOwnProperty('seed') ? req.query.seed : '';
  
  getMarkov(usersByName[userName], userName, function(err, m) {
    if (err) {
      res.send(JSON.stringify(convert(err)));
    } else {
      res.json({
        user: userName,
        seed: seed,
        response: m.respond(seed.toString().trim()).join(' ')
      });
    }
  });
  
});

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
