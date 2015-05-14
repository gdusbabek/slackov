var fs = require('fs');
var path = require('path');

var async = require('async');
var argv = require('minimist')(process.argv.slice(2));
var markov = require('./markov');

var SlackApi = require('./slack_api').SlackApi;
var FakeSlackApi = require('./slack_api').FakeSlackApi;
var DataApi = require('./data_api').DataApi;
var FsApi = require('./data_api').FsDataApi;
var S3Api = require('./data_api').S3DataApi;
var FallbackDataApi = require('./data_api').FallbackDataApi;

var token = argv.token || process.env.SLACK_TOKEN;
var workDir = argv.workDir || process.env.WORK_DIR || './work';
var s3Concurrency = argv.s3Concurrency || process.env.S3_CONCURRENCY || 1;
var slackConcurrency = argv.slackConcurrency || process.env.SLACK_CONCURRENCY || 1;
var maxMessages = argv.maxMessages || process.env.MAX_MESSAGES || 500;
var maxChannels = argv.maxChannels || process.env.MAX_CHANNELS || 500;

if (!token) {
  console.log('Token has not been supplied as SLACK_TOKEN in env or via --token=${token}');
  process.exit(-1);
  return;
}

//var slackApi = new FakeSlackApi(token, '/Users/gary/codes/github/slack_stats/schlep');
var slackApi = new SlackApi(token, '/Users/gary/codes/github/slack_stats/schlep');
var dataApi = new FallbackDataApi(new S3Api(), new FsApi(workDir));

// format a date in a peacable way.
function formatDate(date) {
  return date.getFullYear() + '-' + (date.getMonth()+1) + '-' + date.getDate() + ' ' + date.getHours() + ':' + date.getMinutes();
}

// get a channel listing. dict of id->name
// callback(error, array containing {id, name}
function fetchChannels(callback) {
  console.log('fetching channels');
  slackApi.getChannels(function(err, channels) {
    var channelDict = {},
        count = 0;
    if (channels) {
      channels.forEach(function(channel) {
        if (count < maxChannels) {
          channelDict[channel.id] = channel.name;
        }
        count += 1;
      });
    }
    console.log('DONE fetching channels ' + channels.length + ' kept ' + Object.keys(channelDict).length);
    callback(err, channelDict);
  });
}

// get a user listing. dicto fo id->name
// callback(error, array containing {id, name}
function fetchUsers(callback) {
  console.log('fetching users');
  slackApi.getUsers(function(err, users) {
    var userDict = {};
    if (users) {
      users.forEach(function(user) {
        userDict[user.id] = user.name;
      });
    }
    console.log('DONE fetching users');
    callback(err, userDict);
  });
}

// load markov databases from storage.
// callback(err, filePath)
function fetchMarkov(userId, userName, callback) {
  var filePath = path.join(workDir, 'markov_' + userId + '_' + userName + '.json');
  async.auto({
    exists: function(callback) {
      fs.exists(filePath, function(fileExists) {
        callback(null, fileExists);
      });
    },
    
    fetch: ['exists', function(callback, results) {
      if (results.exists) {
        callback(null, 'not fetched');
      } else {
        dataApi.getMarkovData(userId, serName, function(err, obj) {
          if (!obj) {
            obj = {};
          }
          callback(err, obj);
        });
      }
    }],
    
    save: ['exists', 'fetch', function(callback, results) {
      if (results.exists) {
        callback(null, 'not saved');
      } else {
        fs.writeFile(filePath, JSON.stringify(results.fetch, null, 2), function(err) {
          callback(err, err ? 'not saved' : 'saved');
        })
      }
    }]
  }, function(err, results) {
    callback(err, filePath);
  });
}

// fetch new messages for a given channel
// callback(err, { newest, msgCount, channelId, channelName, messagesByUser:{id:[]} })
function fetchNewMessages(channelId, channelName, since, max, callback) {
  slackApi.getMessages(channelId, since, max, function(err, data) {
    var newest = 1,
        messagesByUser = {},
        msgCount = 0;
    if (data && data.hasOwnProperty('messages') && data.messages.length > 0) {
      // we have stuff!
      newest = Math.max(newest, data.newest);
      msgCount = data.messages.length;
      data.messages.forEach(function(msg) {
        if (!messagesByUser[msg.user]) {
          messagesByUser[msg.user] = [];
        }
        messagesByUser[msg.user].push(msg.txt);
      });
      if (msgCount > 0) {
        console.log('fetched ' + msgCount + ' messages for channel ' + channelName + ' (' + channelId + ') ' + formatDate(new Date(since * 1000)) + ' thru ' + formatDate(new Date(newest * 1000)));
      }
    }
    
    callback(err, {
      newest: newest,
      msgCount: msgCount,
      channelId: channelId,
      channelName: channelName,
      messagesByUser: messagesByUser
    });
  });
}

// use a big auto to do everything.

async.auto({
  // fetch + save channel listing.
  // object of channelId -> name
  channels: fetchChannels,
  saveChannels: ['channels', function(callback, results) {
    fs.writeFile.call(fs, path.join(workDir, 'channels.json'), JSON.stringify(results.channels, null, 2), callback);
  }],
  
  // fetch + save user listing.
  // object of userId -> name
  users: fetchUsers,
  saveUsers: ['users', function(callback, results) {
    fs.writeFile.call(fs, path.join(workDir, 'users.json'), JSON.stringify(results.users, null, 2), callback);
  }],
  
  // stub in empty arrays of messages for each user.
  emptyUserData: ['users', function(callback, results) {
    async.each(Object.keys(results.users), function(userId, callback) {
      fs.writeFile(path.join(workDir, 'user_messages_' + userId + '_' + results.users[userId] + '.json'), '[]', callback);
    }, callback);
  }],
  
  // fetch + save state.
  state: dataApi.getState.bind(dataApi),
  saveState: ['state', function(callback, results) {
    fs.writeFile.call(fs, path.join(workDir, 'state.json'), JSON.stringify(results.state, null, 2), callback);
  }],
  
  // populate default states for [possibly new] channels.
  defaultStates: ['state', 'channels', function(callback, results) {
    Object.keys(results.channels).forEach(function(channelId) {
      if (!results.state.channelFetchTimes[channelId]) {
        results.state.channelFetchTimes[channelId] = 1;
      }
    });
    callback(null, results.state);
  }],
  
  // fetch + save markov databases.
  // array of file paths
  fetchMarkovs: ['users', function(callback, results) {
    var paths = [];
    async.eachLimit(Object.keys(results.users), s3Concurrency, function(userId, callback) {
      fetchMarkov(userId, results.users[userId], function(err, filePath) {
        if (filePath) {
          paths.push(filePath);
        }
        callback(err, filePath);
      });
    }, function(err) {
      console.log('DONE fetching markovs');
      callback(err, paths);
    });
  }],
  
  // iterate over channels and fetch new messages.
  // array of file paths.
  fetchChannelData: ['channels', 'state', 'defaultStates', function(callback, results) {
    var paths = [],
        channels = results.channels,
        state = results.state;
    // for each channel...
    async.eachLimit(Object.keys(results.channels), slackConcurrency, function(channelId, callback) {
      async.auto({
        // get messages
        messages: fetchNewMessages.bind(null, channelId, results.channels[channelId],  results.state.channelFetchTimes[channelId], maxMessages),
        
        // save messages locally
        saveMessages: ['messages', function(callback, results) {
          var filePath = path.join(workDir, 'messages_' + channelId + '_' + channels[channelId] + '.json');
          paths.push(filePath);
          fs.writeFile(filePath, JSON.stringify(results.messages, null, 2), callback);
        }],
        
        // update state to time of newest message.
        updateState: ['messages', function(callback, results) {
          state.channelFetchTimes[channelId] = Math.max(state.channelFetchTimes[channelId], results.messages.newest);
          callback(null);
        }]
      }, function(err, results) {
        callback(err, paths);
      });
    }, function(err) {
      callback(err, paths);
    });
  }],
  
  // iterate over fetched message paths and append to user-message lists.
  // array of file paths.
  coalesceChannelData: ['channels', 'users', 'fetchChannelData', 'emptyUserData', function(callback, results) {
    console.log('coalescing channel data into user files..');
    var paths = [],
        users = results.users;
    async.eachSeries(results.fetchChannelData, function(channelFilePath, callback) {
      fs.readFile(channelFilePath, function(err, data) {
        if (err) {
          callback(err);
          return;
        }
        var channelMsgs = JSON.parse(data),
            actualUserIds = Object.keys(channelMsgs.messagesByUser).filter(function(userId) {
          return results.users.hasOwnProperty(userId);
        });
        async.eachSeries(actualUserIds, function(userId, callback) {
          async.auto({
            filePath: function(callback) {
              callback(null, path.join(workDir, 'user_messages_' + userId + '_' + users[userId] + '.json'));
            },
            
            load: ['filePath', function(callback, results) {
              fs.readFile(results.filePath, function(err, data) {
                callback(err, err ? [] : JSON.parse(data));
              });
            }],
            
            append: ['load', function(callback, results) {
              channelMsgs.messagesByUser[userId].forEach(function(msg) {
                results.load.push(msg);
              });
              callback(null, results.load);
            }],
            
            save: ['filePath', 'append', function(callback, results) {
              paths.push(results.filePath);
              fs.writeFile(results.filePath, JSON.stringify(results.append, null, 2), callback);
            }]
          }, function(err, results) {
            callback(err);
          });
        }, function(err) {
          callback(err);
        });
      });
    }, function(err) {
      callback(err, paths);
    });
  }],
  
  // delete the local channel data (cached responses of channel history)
  deleteLocalChannelData: ['coalesceChannelData', 'fetchChannelData', function(callback, results) {
    async.eachSeries(results.fetchChannelData, function(channelFilePath, callback) {
      fs.unlink(channelFilePath, function(err) { callback(err ? err : null); });
    });
  }],
  
  // iterate over the user-message paths, load them and append messages to user markovs.
  updateMarkovs: ['users', 'coalesceChannelData', 'fetchMarkovs', function(callback, results) {
    console.log('updating markov data...')
    var paths = [],
        users = results.users;
    async.eachSeries(Object.keys(results.users), function(userId, callback) {
      async.auto({
        messagePath: function(callback) { callback(null, path.join(workDir, 'user_messages_' + userId + '_' + users[userId] + '.json')); },
        markovPath: function(callback) { callback(null, path.join(workDir, 'markov_' + userId + '_' + users[userId] + '.json')); },
        loadMarkov: ['markovPath', function(callback, results) {
          fs.readFile(results.markovPath, function(err, data) {
            callback(err, data ? markov(2, JSON.parse(data)) : null);
          });
        }],
        loadMessages: ['messagePath', function(callback, results) {
          fs.readFile(results.messagePath, function(err, data) {
            callback(err, data ? JSON.parse(data) : []);
          });
        }],
        appendMarkov: ['loadMarkov', 'loadMessages', function(callback, results) {
          results.loadMessages.forEach(function(txt) {
            results.loadMarkov.seed(txt);
          });
          callback(null, results.loadMarkov);
        }],
        save: ['markovPath', 'appendMarkov', function(callback, results) {
          paths.push(results.markovPath);
          fs.writeFile(results.markovPath, JSON.stringify(results.appendMarkov.database, null, 2), callback);
        }]
      }, function(err, results) {
        callback(err);
      });
    }, function(err) {
      callback(err, paths);
    });
  }],
  
  // delete local user-message files.
  deleteLocalUserMessages: ['updateMarkovs', 'users', function(callback, results) {
    async.each(Object.keys(results.users), function(userId, callback) {
      fs.unlink(path.join(workDir, 'user_messages_' + userId + '_' + results.users[userId] + '.json'), callback);
    }, callback);
  }],
  
  // save the state.
  updateState: ['state', 'fetchChannelData', 'updateMarkovs', function(callback, results) {
    console.log('updating state...');
    fs.writeFile(path.join(workDir, 'state.json'), JSON.stringify(results.state, null, 2), callback);
  }],
  
  // push everything to storage.
  publish: ['updateState', 'updateMarkovs', function(callback, results) {
    // todo: implement this.
    callback(null);
  }]
  
}, function(err, results) {
  console.log('AT THE END');
  if (err) {
    console.log('There was a problem');
    console.log(err);
  } else {
    console.log('Completed without error');
  }
});