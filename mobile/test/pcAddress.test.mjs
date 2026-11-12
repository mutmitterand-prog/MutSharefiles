import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parseServerAddress, isPrivateHost, candidateOrigins } = createRequire(import.meta.url)('../www/pcAddress.js');
assert.deepEqual(parseServerAddress('http://192.168.1.20:8787/?pair=AbC_-1'), { origin: 'http://192.168.1.20:8787', pair: 'AbC_-1', url: 'http://192.168.1.20:8787/?pair=AbC_-1' });
assert.deepEqual(candidateOrigins('http://192.168.1.20:9000'), ['http://192.168.1.20:9000']);
assert.equal(candidateOrigins('http://192.168.1.20:8787')[0], 'http://192.168.1.20:8787');
assert.equal(candidateOrigins('http://192.168.1.20:8787')[1], 'http://192.168.1.20:8788');
assert.equal(candidateOrigins('http://mon-pc.local:8787').length, 21);
assert.equal(parseServerAddress('192.168.1.20').origin, 'http://192.168.1.20:8787');
assert.equal(parseServerAddress('  10.0.0.5:9000 ').origin, 'http://10.0.0.5:9000');
assert.equal(parseServerAddress('http://DESKTOP-ABC:8787').origin, 'http://desktop-abc:8787');
assert.equal(parseServerAddress('mon-pc.local').origin, 'http://mon-pc.local:8787');
assert.equal(parseServerAddress('http://172.20.1.1:8787/?pair=a b').pair, 'a b');
for (const bad of ['', '   ', 'https://evil.example.com', 'http://8.8.8.8:8787', 'ftp://192.168.1.2', 'javascript:alert(1)', 'http://172.32.0.1', 'http://[::1', 'http://google.com?pair=x'])
  assert.throws(() => parseServerAddress(bad), Error, bad);
assert.ok(isPrivateHost('172.31.255.255')); assert.ok(!isPrivateHost('172.15.0.1')); assert.ok(!isPrivateHost('1.1.1.1'));
console.log('pcAddress : OK');
