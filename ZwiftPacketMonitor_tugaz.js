const EventEmitter = require('events')
const Cap = require('cap').Cap, decoders=require('cap').decoders, PROTOCOL=decoders.PROTOCOL
const zwiftProtoRoot = require('zwift-mobile-api/src/zwiftProtoBuf')
const buffer = new Buffer(65535)
const clientToServerPacket = zwiftProtoRoot.lookup('ClientToServer')
const serverToClientPacket = zwiftProtoRoot.lookup('ServerToClient')

class ZwiftPacketMonitor extends EventEmitter {
  constructor (interfaceName) {
    super()
    this._cap = new Cap()
    this._linkType = null
    this._sequence = 0
    if (interfaceName.match(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)) {
      this._interfaceName = Cap.findDevice(interfaceName)
    } else {
      this._interfaceName = interfaceName
    }
  }

  start () {
    this._linkType = this._cap.open(this._interfaceName, 'port 3022', 10 * 1024 * 1024, buffer)
    this._cap.setMinBytes && this._cap.setMinBytes(0)
    this._cap.on('packet', this.processPacket.bind(this))
  }

  stop () {
    this._cap.close()
  }

  static deviceList () {
    return  Cap.deviceList()
  }

  processPacket () {
    if (this._linkType === 'ETHERNET') {
      let ret = decoders.Ethernet(buffer)

      if (ret.info.type === PROTOCOL.ETHERNET.IPV4) {
        ret = decoders.IPV4(buffer, ret.offset)
        if (ret.info.protocol === PROTOCOL.IP.UDP) {
          ret = decoders.UDP(buffer, ret.offset)
          try {
            if (ret.info.srcport === 3022) {
              let packet = serverToClientPacket.decode(buffer.slice(ret.offset, ret.offset + ret.info.length))
			  
              /*
              if (this._sequence) {
                if (packet.seqno > this._sequence + 1) {
                  console.warn(`Missing packets - expecting ${this._sequence + 1}, got ${packet.seqno}`)
                } else if (packet.seqno < this._squence) {
                  console.warn(`Delayed packet - expecting ${this._sequence + 1}, got ${packet.seqno}`)
                  return
                }
              }
              this._sequence = packet.seqno
              */
              for (let player_state of packet.player_states) {
                this.emit('incomingPlayerState', player_state, packet.world_time, ret.info.dstport, ret.info.dstaddr)
              }
              if (packet.num_msgs === packet.msgnum) {
                this.emit('endOfBatch')
              }
            } else if (ret.info.dstport === 3022) {
                // 2020-11-14 extra handling added to handle what seems to be extra information preceeding the protobuf, added by Zwift since a few days ago
                let skip = 5; // uncertain if this number should be fixed or if the first byte (so far only seen with value 0x06) really is the offset where protobuf starts, so add some extra checks just in case:
                if (buffer.slice(ret.offset + ret.offset + skip, ret.offset + skip + 1).equals(Buffer.from([0x08]))) {
                  // protobuf does seem to start after skip bytes
                } else if (buffer.slice(ret.offset, ret.offset + 1).equals(Buffer.from([0x08]))) {
                  // old format apparently, starting directly with protobuf instead of new header
                  skip = 0
                } else {
                  // use the first byte to determine how many bytes to skip
                  skip = buffer.slice(ret.offset, ret.offset + 1).readUIntBE(0, 1) - 1
                }  
                let packet = clientToServerPacket.decode(buffer.slice(ret.offset + skip, ret.offset + ret.info.length - 4))
                if (packet && packet.state) {
                  this.emit('outgoingPlayerState', packet.state, packet.world_time, ret.info.srcport, ret.info.srcaddr)
                }
              
              
            }
          } catch (ex) {
  console.error(ex instanceof SyntaxError); 
  console.error(ex.message);                
  console.error(ex.name);                   
  console.error(ex.fileName);               
  console.error(ex.lineNumber);             
  console.error(ex.columnNumber);           
  console.error(ex.stack);                  

          }
        }
      }
    }
  }
}

module.exports = ZwiftPacketMonitor