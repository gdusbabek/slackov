/*
This software is released under the MIT license:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

fork of git://github.com/substack/node-markov.git. 
original author <James Halliday> mail@substack.net
 */


var EventEmitter = require('events').EventEmitter;
var deck = require('deck');
var Lazy = require('lazy');
var Hash = require('hashish');

module.exports = function (order, db) {
    if (!order) order = 2;
    var db = db ? db : {};
    var self = {};
    self['database'] = db;
    
    self.seed = function (seed, cb) {
        if (seed instanceof EventEmitter) {
            Lazy(seed).lines.forEach(self.seed);
            
            if (cb) {
                seed.on('error', cb);
                seed.on('end', cb);
            }
        }
        else {
            var text = (Buffer.isBuffer(seed) ? seed.toString() : seed)
            var words = text.split(/\s+/);
            var links = [];
            
            for (var i = 0; i < words.length; i += order) {
                var link = words.slice(i, i + order).join(' ');
                links.push(link);
            }
            
            if (links.length <= 1) {
                if (cb) cb(null);
                return;
            }
            
            for (var i = 1; i < links.length; i++) {
                var word = links[i-1];
                var cword = clean(word);
                var next = links[i];
                var cnext = clean(next);
                
                var node = Hash.has(db, cword)
                    ? db[cword]
                    : {
                        count : 0,
                        words : {},
                        next : {},
                        prev : {},
                    }
                ;
                db[cword] = node;
                
                node.count ++;
                node.words[word] = (
                    Hash.has(node.words, word) ? node.words[word] : 0
                ) + 1;
                node.next[cnext] = (
                    Hash.has(node.next, cnext) ? node.next[cnext] : 0
                ) + 1
                if (i > 1) {
                    var prev = clean(links[i-2]);
                    node.prev[prev] = (
                        Hash.has(node.prev, prev) ? node.prev[prev] : 0
                    ) + 1;
                }
                else {
                    node.prev[''] = (node.prev[''] || 0) + 1;
                }
            }
            
            if (!Hash.has(db, cnext)) db[cnext] = {
                count : 1,
                words : {},
                next : { '' : 0 },
                prev : {},
            };
            var n = db[cnext];
            n.words[next] = (Hash.has(n.words, next) ? n.words[next] : 0) + 1;
            n.prev[cword] = (Hash.has(n.prev, cword) ? n.prev[cword] : 0) + 1;
            n.next[''] = (n.next[''] || 0) + 1;
            
            if (cb) cb(null);
        }
    };
    
    self.search = function (text) {
        var words = text.split(/\s+/);
        
        // find a starting point...
        var start = null;
        var groups = {};
        for (var i = 0; i < words.length; i += order) {
            var word = clean(words.slice(i, i + order).join(' '));
            if (Hash.has(db, word)) groups[word] = db[word].count;
        }
        
        return deck.pick(groups);
    };
    
    self.pick = function () {
        return deck.pick(Object.keys(db))
    };
    
    self.next = function (cur) {
        if (!cur || !db[cur]) return undefined;
        
        var next = deck.pick(db[cur].next);
        return next && {
            key : next,
            word : deck.pick(db[next].words),
        } || undefined;
    };
    
    self.prev = function (cur) {
        if (!cur || !db[cur]) return undefined;
        
        var prev = deck.pick(db[cur].prev);
        return prev && {
            key : prev,
            word : deck.pick(db[prev].words),
        } || undefined;
    };
    
    self.forward = function (cur, limit) {
        var res = [];
        while (cur && !limit || res.length < limit) {
            var next = self.next(cur);
            if (!next) break;
            cur = next.key;
            res.push(next.word);
        }
        
        return res;
    };
    
    self.backward = function (cur, limit) {
        var res = [];
        while (cur && !limit || res.length < limit) {
            var prev = self.prev(cur);
            if (!prev) break;
            cur = prev.key;
            res.unshift(prev.word);
        }
        
        return res;
    };
    
    self.fill = function (cur, limit) {
        var res = [ deck.pick(db[cur].words) ];
        if (!res[0]) return [];
        if (limit && res.length >= limit) return res;;
        
        var pcur = cur;
        var ncur = cur;
        
        while (pcur || ncur) {
            if (pcur) {
                var prev = self.prev(pcur);
                pcur = null;
                if (prev) {
                    pcur = prev.key;
                    res.unshift(prev.word);
                    if (limit && res.length >= limit) break;
                }
            }
            
            if (ncur) {
                var next = self.next(ncur);
                ncur = null;
                if (next) {
                    ncur = next.key;
                    res.unshift(next.word);
                    if (limit && res.length >= limit) break;
                }
            }
        }
        
        return res;
    };
    
    self.respond = function (text, limit) {
        var cur = self.search(text) || self.pick();
        return self.fill(cur, limit);
    };
    
    self.word = function (cur) {
        return db[cur] && deck.pick(db[cur].words);
    };
    
    return self;
};

function clean (s) {
    return s
        .toLowerCase()
        .replace(/[^a-z\d]+/g, '_')
        .replace(/^_/, '')
        .replace(/_$/, '')
    ;
}
