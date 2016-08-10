# PAC HTTPS Leak Demos

## Intro

This is the code for the demos from our DEF CON 24 talk, 
[Toxic Proxies - Bypassing HTTPS and VPNs to Pwn Your Online Identity] (https://defcon.org/html/defcon-24/dc-24-speakers.html#Chapman)
The demos use the [PAC HTTPS leak] (http://www.contextis.com/resources/blog/leaking-https-urls-20-year-old-vulnerability/) 
to steal data and do various fun things. Our demos worked in Chrome on Windows
with default settings, until the issue was fixed in Chrome 52. You can use
Chrome 52+ to try out these demos if you launch it with the --unsafe-pac-url flag.

* Slides: https://speakerdeck.com/noxrnet/toxic-proxies-bypassing-https-and-vpns-to-pwn-your-online-identity
* Video of demo: https://www.youtube.com/watch?v=z1XOCYV9jMQ

## Prequisites

The Python server has been tested Linux with Python 2. Run:
  pip install -r requirements.txt 
to fetch the required Python libraries.

## How to run this

The PACServer.py script will start up a DNS server (port 53 UDP) and a web
server (port 8081). It will serve a 'malicious' PAC script from /wpad.data.

You'll need two browsers - a 'victim' browser configured to use the malicious
PAC script and DNS server and a 'master' browser that receives the leaked data.
For the OAuth demo to work, the master browser will need to use the malicious
DNS server too.

Server:
* Run the Python script like so (sudo is necessary so it can bind to port 53):
  sudo python PACLeak.py

Victim side:
* Configure DNS to point to {serverip}
* Configure proxy settings to point to http://{serverip}:8081/wpad.dat
* If you're using Chrome 52 or later, you'll
need to add the --unsafe-pac-url command line flag when launching Chrome. 
* Browse to http://{serverip}:8081/static/victim.html

Master side:
* (Optional for OAuth functionality) Configure DNS to point to {serverip}
* Browse to http://{serverip}:8081/static/pacmaster.html

If you want to be fancy, you can set up a proper gateway server that will run
the Python script and do the WPAD injection via DHCP or DNS etc... but you'll
have to figure that out yourself.

If everything is working correctly, when your victim browser fetches the PAC
script, you'll see something like the following in the script output:

```
DEBUG in PACServer [PACServer.py:181]:
Sent PAC script for UA: Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, 
like Gecko) Chrome/52.0.2743.116 Safari/537.36 SID: 2
--------------------------------------------------------------------------------
192.168.8.193 - - [2016-08-09 15:52:49] "GET /wpad.dat HTTP/1.1" 200 6317 0.002341
```

You should then start to see leaked URLs being received by the DNS server:

```
Request: [192.168.8.193:49318] (udp) / '14pl2qy2ii0ie1ootzl815ru6po7zb168vdhvkod0mop9grupb.1.279.0.1.u.' (A)
{'data': 'https://mtalk.google.com:5228/', 'pac_sid': '1', 'type': 'url'}
Request: [192.168.8.193:52374] (udp) / '14pl2qy2ii0ie1rgu9f214ba2a93l10i2v6v3rl7000000001b.1.280.0.1.u.' (A)
{'data': 'https://www.google.co.uk/', 'pac_sid': '1', 'type': 'url'}
```


## How it works:

### PAC script

By default the PAC script will leak every URL it is asked to resolve. It encodes
URLs in a base-36 encoding and appends the fake .u domain. Some URLs are too
long to fit inside a single hostname, so it will encode them in multiple domain
requests.

We set up 2-way communication between the browser and the PAC script. The
browser encodes JavaScript code inside base-36 hostnames endiing in .e. The PAC
script decodes these and eval's the JavaScript code. It then encodes the result
with a .r domain. The Python DNS server decodes the .u and .e these and sends
the result to the browser.

The PAC script has a list of 'leak' regexes and a list of 'block' regexes. These
lists are set up via the eval mechanism described above. If the 'leak' list is
non-empty, then the PAC script will only leak URLs that match one of the regexes
in the list. The 'block' list is similar - if the PAC script is asked about a
URLs that matches a block regex, it will tell the browser to use a non-existant
proxy, preventing the browser from loading that URL.

The Python server gives each PAC script it serves a unique session ID. Every
leaked URL or eval response that is encoded also contains this ID.

### The Python Server

The Python server script does a few things. It hands out the malicious PAC
scripts, it decodes DNS-encoded data from the PAC scripts. It also facilitates
communication between the 'victim' browsers and the 'master' browser. Events are
streamed from the server to web pages via HTML5 server-sent events channels.
Each event stream has a unique ID. The server tries to link each PAC session ID
with an event stream so it can route data received from each PAC script back to
the corrent event stream.

### Attack scripts

The majority of the logic behind the demos is done by JavaScript in the victim
browser (deanonymise.js, googlesteal.js and oauth.js). These all use the
PACServer class in pacserver.js to do their stuff. PACServer is used to
communicate with the PAC script, with the web server, and to communicate between
the victim and master webpages.

The demos all work by triggering 302 redirects and page prerenders. They then
register to receive URLs leaked from their PAC script, and send the relevant
bits to the master page. The master page recieves and displays all URLs leaked
by all PAC scripts, as well as messages received from the victims.
