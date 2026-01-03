const net = require('net');
const dns = require('dns').promises;

(async () => {
    console.log(
        await getMinecraftServerStatus('topsilver.join.sudis.kr')
    );
})();

async function resolveMinecraft(host, port = 25565) {
    let target = host;
    let dnsLog = [];

    dnsLog.push(`${host}:${port}`);

    try {
        const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`);
        if (srv.length) {
            target = srv[0].name;
            port = srv[0].port;
            dnsLog.push(`${target}:${port}`);
        }
    } catch { }

    while (true) {
        try {
            const cname = await dns.resolveCname(target);
            if (!cname.length) break;
            target = cname[0];
            dnsLog.push(`${target}:${port}`);
        } catch {
            break;
        }
    }

    try {
        const ips = await dns.resolve4(target);
        dnsLog.push(`${ips[0]}:${port}`);
        return {
            host: ips[0],
            port,
            logs: dnsLog
        };
    } catch (e) {
        return {
            host: target,
            port,
            logs: dnsLog
        };
    }
}

function getMinecraftServerStatus(host, port = 25565, timeout = 500) {
    return new Promise(async (resolve, reject) => {
        const resolved = await resolveMinecraft(host, port);

        const socket = new net.Socket();
        let chunks = [];
        let ended = false;

        socket.setTimeout(timeout);
        let end = 0;
        const start = Date.now();

        socket.connect({
            host: resolved.host,
            port: resolved.port,
            family: 4
        }, () => {
            try {
                const handshake = [];

                writeVarIntToArray(handshake, 0x00);
                writeVarIntToArray(handshake, 47);
                writeStringToArray(handshake, host);
                handshake.push((resolved.port >> 8) & 0xff);
                handshake.push(resolved.port & 0xff);
                writeVarIntToArray(handshake, 1);

                const handshakePacket = Buffer.from(handshake);
                socket.write(Buffer.concat([
                    writeVarIntBuffer(handshakePacket.length),
                    handshakePacket
                ]));

                const requestPacket = Buffer.from([0x00]);
                socket.write(Buffer.concat([
                    writeVarIntBuffer(requestPacket.length),
                    requestPacket
                ]));
            } catch (e) {
                reject(e);
                socket.destroy();
            }
        });

        socket.on('data', d => {
            chunks.push(d);
            end = Date.now();
        });
        socket.on('end', () => ended = true);

        socket.on('close', () => {
            if (!ended) return;
            try {
                resolve(
                    Object.assign({
                        ping: end - start
                    }, resolved, structChunk(chunks))
                );
            } catch (e) {
                reject(e);
            }
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(
                Object.assign({
                    ping: end - start
                }, resolved, structChunk(chunks))
            );
        });

        socket.on('error', err => reject(err));
    });
}

function structChunk(chunks) {
    const buffer = Buffer.concat(chunks);
    let offset = 0;

    readVarInt(buffer, () => offset++);
    const packetId = readVarInt(buffer, () => offset++);
    if (packetId !== 0x00) throw new Error('Invalid Packet ID');

    const jsonLength = readVarInt(buffer, () => offset++);
    const json = buffer.slice(offset, offset + jsonLength).toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.favicon) {
        parsed.favicon = parseFaviconToBuffer(parsed.favicon);
    }

    return {
        version: parsed.version?.name || "알 수 없음",
        icon: parsed.favicon || null,
        description: getDescription(parsed),
        maxPlayers: parsed.players.max,
        onlinePlayers: parsed.players.online,
        samplePlayers: parsed.players.sample || []
    };
}

function parseFaviconToBuffer(favicon) {
    if (typeof favicon !== 'string') return null;

    const prefix = 'base64,';
    const idx = favicon.indexOf(prefix);
    if (idx === -1) return null;

    const base64 = favicon.slice(idx + prefix.length);
    return Buffer.from(base64, 'base64');
}

function writeVarIntToArray(arr, value) {
    while (true) {
        if ((value & ~0x7f) === 0) {
            arr.push(value);
            return;
        }
        arr.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
}

function writeVarIntBuffer(value) {
    const arr = [];
    writeVarIntToArray(arr, value);
    return Buffer.from(arr);
}

function readVarInt(buffer, incOffset) {
    let numRead = 0;
    let result = 0;
    let read;

    do {
        read = buffer[incOffset()];
        result |= (read & 0x7f) << (7 * numRead);
        numRead++;
        if (numRead > 5) throw new Error("VarInt 초과");
    } while ((read & 0x80) !== 0);

    return result;
}

function writeStringToArray(arr, str) {
    const buf = Buffer.from(str, 'utf8');
    writeVarIntToArray(arr, buf.length);
    for (const b of buf) arr.push(b);
}

function extractExtra(data) {
    let result = data.text || "";
    if (Array.isArray(data.extra)) {
        for (const v of data.extra) {
            result += extractExtra(v);
        }
        result += " ";
    }
    return result;
}

function aliveLine(str) {
    const result = [];
    for (let i = 0; i < str.length; i += 41) {
        result.push(str.slice(i, i + 41));
    }
    return result.join('\n');
}

function getDescription(status) {
    if (!status?.description) return "";
    return aliveLine(extractExtra(status.description));
}
