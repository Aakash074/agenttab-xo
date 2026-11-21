// Shows (and on first run creates) the owner's and provider's XO P2PKH wallet address and balance on chipnet.
// Addresses are public; no secret is printed. One engine per process: usage node --env-file=.env scripts/wallet.ts <owner|provider>
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { createEngine, json } from './lib/engines.ts';

{
    const who = (process.argv[2] ?? 'owner') as 'owner' | 'provider';
    const { engine, walletTemplateIdentifier } = await createEngine(who);
    await engine.setDefaultPolicies({
        address: { templateIdentifier: walletTemplateIdentifier },
        change: { templateIdentifier: walletTemplateIdentifier },
        receive: { templateIdentifier: walletTemplateIdentifier },
    });
    const existing = (await engine.listScriptHashes()).filter((s: any) => s.templateIdentifier === walletTemplateIdentifier);
    let lockingBytecodeHex: string;
    if (existing.length > 0) lockingBytecodeHex = existing[0].lockingBytecode;
    else {
        const generated: any = await engine.generateLockingBytecodeFromDefaultPolicy('address');
        lockingBytecodeHex = typeof generated === 'string' ? generated : Buffer.from(generated.lockingBytecode ?? generated).toString('hex');
    }
    const address = lockingBytecodeToCashAddress({ bytecode: Buffer.from(lockingBytecodeHex, 'hex'), prefix: 'bchtest' });
    const utxos: any[] = await engine.listUnspentOutputs();
    const total = utxos.reduce((sum, u) => sum + BigInt(u.valueSatoshis), 0n);
    console.log(json({ who, address: typeof address === 'string' ? address : address.address, utxos: utxos.length, satoshis: total }));
    await engine.stop().catch(() => undefined);
}
process.exit(0);
