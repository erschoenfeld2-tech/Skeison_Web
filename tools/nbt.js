// Minimaler NBT-Parser (gzip oder roh). Gibt normale JS-Objekte zurueck.
const zlib = require('zlib');
function parse(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  let p = 0;
  const rd = {
    b() { return buf.readInt8(p++); },
    s() { const v = buf.readInt16BE(p); p += 2; return v; },
    i() { const v = buf.readInt32BE(p); p += 4; return v; },
    l() { const v = buf.readBigInt64BE(p); p += 8; return Number(v); },
    f() { const v = buf.readFloatBE(p); p += 4; return v; },
    d() { const v = buf.readDoubleBE(p); p += 8; return v; },
    str() { const n = buf.readUInt16BE(p); p += 2; const t = buf.toString('utf8', p, p + n); p += n; return t; },
  };
  function payload(t) {
    switch (t) {
      case 1: return rd.b();
      case 2: return rd.s();
      case 3: return rd.i();
      case 4: return rd.l();
      case 5: return rd.f();
      case 6: return rd.d();
      case 7: { const n = rd.i(); const a = Array.from(buf.subarray(p, p + n)); p += n; return a; }
      case 8: return rd.str();
      case 9: { const it = rd.b(); const n = rd.i(); const a = []; for (let k = 0; k < n; k++) a.push(payload(it)); return a; }
      case 10: { const o = {}; for (;;) { const tt = rd.b(); if (tt === 0) break; const name = rd.str(); o[name] = payload(tt); } return o; }
      case 11: { const n = rd.i(); const a = []; for (let k = 0; k < n; k++) a.push(rd.i()); return a; }
      case 12: { const n = rd.i(); const a = []; for (let k = 0; k < n; k++) a.push(rd.l()); return a; }
      default: throw new Error('NBT-Tag ' + t);
    }
  }
  const t = rd.b();
  if (t !== 10) throw new Error('Root ist kein Compound');
  rd.str();
  return payload(10);
}
module.exports = { parse };
