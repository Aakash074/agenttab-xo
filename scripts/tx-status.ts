// Prints confirmation status and outputs of chipnet transactions via a public Electrum server.
// Usage: node scripts/tx-status.ts <txid> [txid...]
import { ElectrumClient } from '@electrum-cash/network';
import { decodeTransaction, hexToBin, binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';

const client = new ElectrumClient('agenttab-xo', '1.5.3', 'chipnet.imaginary.cash');
await client.connect();
for (const txid of process.argv.slice(2)) {
    const verbose: any = await client.request('blockchain.transaction.get', txid, true);
    if (verbose instanceof Error) { console.log(txid, 'ERROR', verbose.message); continue; }
    const tx = decodeTransaction(hexToBin(verbose.hex));
    if (typeof tx === 'string') throw new Error(tx);
    console.log(JSON.stringify({
        txid, confirmations: verbose.confirmations ?? 0, blockhash: verbose.blockhash, bytes: verbose.size,
        locktime: tx.locktime, sequences: tx.inputs.map((i) => i.sequenceNumber),
        outputs: tx.outputs.map((o) => {
            const a = lockingBytecodeToCashAddress({ bytecode: o.lockingBytecode, prefix: 'bchtest' });
            return { sats: o.valueSatoshis.toString(), to: typeof a === 'string' ? binToHex(o.lockingBytecode) : a.address };
        }),
    }));
}
await client.disconnect();
