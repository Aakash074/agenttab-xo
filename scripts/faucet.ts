// Requests chipnet test sats from the public proof-of-work faucet at chipnet.bch.ninja.
// Usage: node scripts/faucet.ts <bchtest:address> <sats>
import { createHash } from 'node:crypto';

const [ address, sats = '100000' ] = process.argv.slice(2);
if (!address?.startsWith('bchtest:')) throw new Error('usage: node scripts/faucet.ts <bchtest:address> [sats]');
const api = async (path: string, body?: unknown) => {
    const res = await fetch(`https://chipnet.bch.ninja/api/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data: any = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
};
const challenge = await api('challenge', { address, sats });
const target = BigInt(`0x${challenge.target}`);
let nonce = 0n;
for (;; nonce++) {
    const digest = createHash('sha256').update(`${challenge.payload}:${nonce}`).digest('hex');
    if (BigInt(`0x${digest}`) <= target) break;
}
const result = await api('claim', { payload: challenge.payload, signature: challenge.signature, nonce: nonce.toString() });
console.log(JSON.stringify({ txid: result.txid, fee: result.fee, sats }));
