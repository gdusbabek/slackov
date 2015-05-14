
var path = require('path');
var fs = require('fs');
var util = require('util');
var async = require('async');
var request = require('request');
var helpers = require('./helpers');

var tokenReplaceRe = /token=(\w+)-(\w+)-(\w+)-(\w+)-(\w+)/;

// easy way to cache API responses that can be used in a mock API impl.
function maybeSchlep(schlep, url, body) {
  if (schlep) {
    var filePath = getSchleppedPath(schlep, url);
    console.log('saved response to ' + filePath);
    fs.writeFileSync(filePath, body);
  }
}

function getSchleppedPath(prepend, url) {
  return path.join(prepend, helpers.filenameSanitize(url.replace(tokenReplaceRe, 'token=not-a-real-token-yo')) + '.json');
}

// callback(err, res, body)
function getHttpJson(url, callback) {
  var self = this;
  request(url, function(err, res, body) {
    if (err) {
      callback(err, null);
    } else {
      maybeSchlep(self.schlep, url.replace(this.token, ''), body);
      callback(null, body);
    }
  });
}

function getFsJson(url, callback) {
  var fsPath = getSchleppedPath(this.directory, url),
      data = fs.readFileSync(fsPath);
  callback(null, data);
}

function SlackApi(token) {
  this.token = token;
  this.schlep = false;
}

SlackApi.prototype.getJson = getHttpJson;

// returns list of {id, name}
SlackApi.prototype.getChannels = function getChannels(callback) {
  var self = this,
      params = {
        token: self.token,
        exclude_archived: 1
      },
      url = 'https://slack.com/api/channels.list' + helpers.expand(params);
  
  this.getJson(url, function(err, body) {
    if (err) {
      callback(err, null);
    } else {
      var response = JSON.parse(body),
          channels = [];
      if (response.hasOwnProperty('ok') && response.ok) {
        // pull out what we need from channels.
        response.channels.forEach(function(channel) {
          channels.push({
            id: channel.id,
            name: channel.name
          });
        });
        callback(null, channels);
      } else {
        callback(new Error(response.error), null);
      }
    }
  });

};

// returns array of {id, name, fullName}
SlackApi.prototype.getUsers = function getUsers(callback) {
  var self = this,
    params = {
      token: self.token
    },
    url = 'https://slack.com/api/users.list' + helpers.expand(params);
  
  this.getJson(url, function(err, body) {
    if (err) {
      callback(err, null);
    } else {
      var response = JSON.parse(body),
          users = [];
      if (response.hasOwnProperty('ok') && response.ok) {
        response.members.forEach(function(member) {
          if (!member.deleted) {
            users.push({
              id: member.id,
              name: member.name,
              fullName: member.profile.first_name + ' ' + member.profile.last_name
            });
          }
        });
        callback(null, users);
      } else {
        callback(new Error(response.error), null);
      }
    }
  });
};

// from now back until oldest.
// return array of {user, ts, txt}  (user name, timestamp and message text).
SlackApi.prototype.getMessages = function getMessages(channel, from, maxMessages, callback) {
  var self = this,
    msgs = [],
    keepPaging = true,
    newest = 1,
    oldest = from;
  
  async.whilst(
    function test() { return keepPaging && msgs.length < maxMessages; },
    function(callback) {
      var params = {
          token: self.token,
          channel: channel,
          oldest: oldest,
          inclusive: 0,
          count: Math.min(maxMessages, 500)
        },
        url;
      
      url = 'https://slack.com/api/channels.history' + helpers.expand(params);
      
      //console.log(new Date(oldest * 1000) + ' ' + url);
      //console.log('CALLING ' + url);
      
      self.getJson(url, function(err, body) {
        //console.log("RESPONS " + url);
        if (err) {
          callback(err);
        } else {
          var response = JSON.parse(body);
          if (response.hasOwnProperty('ok') && response.ok) {
            // sort message array in descending order.
            response.messages.sort(function(a, b) {
              return parseFloat(a.ts) - parseFloat(b.ts);
            });
            response.messages.forEach(function(msg) {
              if (msg.hasOwnProperty('user') && msgs.length < maxMessages) {
                msgs.push({
                  user: msg.user,
                  ts: parseFloat(msg.ts),
                  txt: msg.hasOwnProperty('text') ? msg.text : ''
                });
                
                newest = Math.max(newest, parseFloat(msg.ts));
              }
            });
            //console.log(new Date(maxInNextBatch * 1000));
            keepPaging = response.hasOwnProperty('has_more') && response.has_more && msgs.length < maxMessages;
            callback(null);
          } else {
            callback(new Error(response.error));
          }
        }
      });
    },
    function(err) {
      callback(err, {
        messages: msgs,
        newest: newest
      });
    }
  );
};

// FakeSlackApi just reads and returns schlepped responses from the file system. Good for mocking while on an airplane.
function FakeSlackApi(token, directory) {
  SlackApi.call(this, token);
  this.schlep = false; // make sure!
  this.directory = directory;
}

util.inherits(FakeSlackApi, SlackApi);

FakeSlackApi.prototype.getJson = getFsJson;

exports.SlackApi = SlackApi;
exports.FakeSlackApi = FakeSlackApi;