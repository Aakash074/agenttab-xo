// Offline checks: the XO template's CashASM reproduces the cashc covenant byte for byte,
// and its P2SH32 address equals the one the original CashScript SDK derives for the same keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    createCompilerBch, generatePrivateKey, secp256k1, binToHex, bigIntToVmNumber, hexToBin, cashAddressToLockingBytecode,
} from '@bitauth/libauth';
import { Contract, MockNetworkProvider } from 'cashscript';
import { agentTabTemplate } from '../src/agenttab-template.ts';

const artifact = JSON.parse(readFileSync(new URL('../contracts/AgentTab.json', import.meta.url), 'utf8'));

const compilerFor = () => createCompilerBch({
    scripts: agentTabTemplate.scripts,
    variables: {
        ownerKey: { type: 'Key' }, providerKey: { type: 'Key' },
        agentPublicKey: { type: 'WalletData' }, timeoutBlockHeight: { type: 'WalletData' },
    },
    lockingScriptTypes: { agentTabRedeemBytecode: 'p2sh32' },
});

test('CashASM body compiles to the exact cashc 0.14.0 bytecode', () => {
    const result = compilerFor().generateBytecode({ scriptId: 'agentTabContract', data: {} });
    assert.equal(result.success, true);
    // cashc artifact bytecode is ASM; build the reference bytes with the cashscript SDK's own encoder.
    const contract = new Contract(artifact, [
        secp256k1.derivePublicKeyCompressed(generatePrivateKey()) as Uint8Array,
        secp256k1.derivePublicKeyCompressed(generatePrivateKey()) as Uint8Array,
        secp256k1.derivePublicKeyCompressed(generatePrivateKey()) as Uint8Array,
        1000n,
    ], { provider: new MockNetworkProvider() });
    // contract.bytecode is the full redeem script: 4 constructor pushes (<timeout=1000> 3 pubkeys) + body.
    assert.equal(contract.bytecode.endsWith(binToHex((result as any).bytecode)), true);
    assert.equal(contract.bytecode.length - binToHex((result as any).bytecode).length, (3 + 3 * 34) * 2, 'only the constructor pushes differ');
});

test('template P2SH32 locking bytecode equals the CashScript SDK address for the same keys', () => {
    for (const timeout of [1n, 16n, 17n, 300_000n, 1_800_000_000n]) {
        const ownerPriv = generatePrivateKey(), providerPriv = generatePrivateKey(), agentPriv = generatePrivateKey();
        const owner = secp256k1.derivePublicKeyCompressed(ownerPriv) as Uint8Array;
        const provider = secp256k1.derivePublicKeyCompressed(providerPriv) as Uint8Array;
        const agent = secp256k1.derivePublicKeyCompressed(agentPriv) as Uint8Array;
        const result = compilerFor().generateBytecode({
            scriptId: 'agentTabRedeemBytecode',
            data: {
                keys: { privateKeys: { ownerKey: ownerPriv, providerKey: providerPriv } },
                bytecode: { agentPublicKey: agent, timeoutBlockHeight: bigIntToVmNumber(timeout) },
            },
        });
        assert.equal(result.success, true, JSON.stringify((result as any).errors));
        const contract = new Contract(artifact, [owner, agent, provider, timeout], { provider: new MockNetworkProvider(), addressType: 'p2sh32' });
        const expected = cashAddressToLockingBytecode(contract.address);
        if (typeof expected === 'string') throw new Error(expected);
        assert.equal(binToHex((result as any).bytecode), binToHex(expected.bytecode), `timeout ${timeout}`);
    }
});
