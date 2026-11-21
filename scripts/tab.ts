// AgentTab over XO on chipnet. Each step runs as its own process for ONE party (owner or provider), because
// two XO engines cannot run in one Node process (the Electrum cache is a module-level singleton).
// Parties exchange invitations as files in invitations/ (serializeInvitation / deserializeInvitation).
//
//   node --env-file=.env scripts/tab.ts owner    open-create  <name> <budgetSats> <timeoutLockBlocksFromNow>
//   node --env-file=.env scripts/tab.ts provider open-accept  <name>
//   node --env-file=.env scripts/tab.ts owner    open-fund    <name>
//   node --env-file=.env scripts/tab.ts provider sync         <name>
//   node --env-file=.env scripts/tab.ts agent    voucher      <name> <amountSats>
//   node --env-file=.env scripts/tab.ts provider settle       <name>
//   node --env-file=.env scripts/tab.ts provider cancel       <name>
//   node --env-file=.env scripts/tab.ts owner    refund       <name>
//   node --env-file=.env scripts/tab.ts owner    observe      <name> settle|cancel
//   node --env-file=.env scripts/tab.ts <owner|provider> status
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
    binToHex, hexToBin, secp256k1, sha256, bigIntToVmNumber, utf8ToBin, flattenBinArray,
} from '@bitauth/libauth';
import { serializeInvitation, deserializeInvitation } from '@xo-cash/utils';
import { createEngine, env, json } from './lib/engines.ts';

const INVITATIONS = 'invitations';
mkdirSync(INVITATIONS, { recursive: true });

const [ who, command, name, ...rest ] = process.argv.slice(2);
const file = (suffix: string) => `${INVITATIONS}/${name}.${suffix}.json`;
const save = (suffix: string, invitation: unknown) => {
    writeFileSync(file(suffix), serializeInvitation(invitation as any));
    console.log(`saved ${file(suffix)}`);
};
const load = (suffix: string) => deserializeInvitation(readFileSync(file(suffix), 'utf8'));
const log = (label: string, value: unknown) => console.log(`--- ${label}\n${json(value)}`);
const notes = (suffix: string, value: unknown) => writeFileSync(`${INVITATIONS}/${name}.${suffix}.json`, json(value));

const agentPublicKey = () => binToHex(secp256k1.derivePublicKeyCompressed(hexToBin(env('AGENT_PRIVKEY'))) as Uint8Array);

// voucher = schnorr datasig(agent, sha256("AGENTTAB" ++ outpointTxHash ++ outpointIndex(4 LE) ++ amount(8 LE)))
// outpointTxHash is in the byte order OP_OUTPOINTTXHASH returns (the reverse of the displayed txid).
function signVoucher(txid: string, vout: number, amount: bigint) {
    const index = new Uint8Array(4); new DataView(index.buffer).setUint32(0, vout, true);
    const amountBytes = new Uint8Array(8); new DataView(amountBytes.buffer).setBigUint64(0, amount, true);
    const message = flattenBinArray([ utf8ToBin('AGENTTAB'), hexToBin(txid).reverse(), index, amountBytes ]);
    const sig = secp256k1.signMessageHashSchnorr(hexToBin(env('AGENT_PRIVKEY')), sha256.hash(message));
    if (typeof sig === 'string') throw new Error(sig);
    return binToHex(sig);
}

if (who === 'agent') {
    // The agent is not an XO party. It only needs the tab outpoint (public) to sign a voucher.
    if (command !== 'voucher') throw new Error('agent only signs vouchers');
    const tab = JSON.parse(readFileSync(`${INVITATIONS}/${name}.tab.json`, 'utf8'));
    const amount = BigInt(rest[0]);
    const voucher = signVoucher(tab.txid, tab.vout, amount);
    writeFileSync(`${INVITATIONS}/${name}.voucher.json`, json({ txid: tab.txid, vout: tab.vout, amount, voucher, agentPublicKey: agentPublicKey() }));
    console.log(`voucher for ${amount} sats on ${tab.txid}:${tab.vout} saved`);
    process.exit(0);
}

const { engine, templateIdentifier, walletTemplateIdentifier } = await createEngine(who as 'owner' | 'provider');
await engine.setDefaultPolicies({
    address: { templateIdentifier: walletTemplateIdentifier },
    change: { templateIdentifier: walletTemplateIdentifier },
    receive: { templateIdentifier: walletTemplateIdentifier },
});
const height = (await engine.getChainStatus()).currentHeight as number;
// Chipnet activated faster blocks (1-minute blocks) at height 332451. Height-based nLockTime and
// OP_CHECKLOCKTIMEVERIFY stay in 10-minute units after that, so a timeout must be set in "lock height", not in the raw
// height XO's getChainStatus() returns. lockTip = the largest height-based nLockTime that is final for the next block.
// (Same rule as the original AgentTab repo, packages/covenant/src/index.ts lockHeightAt.)
const FAST_BLOCKS_ACTIVATION = 332_451;
const lockHeightAt = (h: number) => (h <= FAST_BLOCKS_ACTIVATION ? h : FAST_BLOCKS_ACTIVATION + Math.floor((h - FAST_BLOCKS_ACTIVATION) / 10));
const lockTip = lockHeightAt(height + 1) - 1;

async function missing(invitationIdentifier: string) {
    const m = await engine.listMissingRequirements(invitationIdentifier);
    log('missing requirements', m);
    return m;
}

async function execute(invitationIdentifier: string, suffix: string) {
    const built = await engine.buildInvitationTransactionFromMergedCommit(invitationIdentifier);
    log('built transaction', { txid: built.transactionHash, bytes: built.transactionByteLength, hex: built.serializedTransaction });
    const result: any = await engine.executeAction(invitationIdentifier, { broadcastTransaction: true });
    const txid = result?.builtTransaction?.transactionHash ?? result;
    console.log(`BROADCAST ${suffix} txid ${txid}`);
    save(suffix, result?.storedInvitation?.invitation ?? (await engine.getInvitation(invitationIdentifier))?.invitation);
    return txid as string;
}

let followUpId: string | undefined;
try {
    switch (`${who} ${command}`) {
        case 'owner open-create': {
            const [ budget, blocks ] = rest;
            const template: any = await engine.getTemplate(templateIdentifier);
            const invitation = await engine.createInvitation({
                templateIdentifier,
                actionIdentifier: 'openTab',
                intent: template.start[0],
                variables: [
                    { variableIdentifier: 'agentPublicKey', roleIdentifier: 'owner', value: agentPublicKey() },
                    { variableIdentifier: 'timeoutBlockHeight', roleIdentifier: 'owner', value: lockTip + Number(blocks) },
                    { variableIdentifier: 'budgetSatoshis', roleIdentifier: 'owner', value: BigInt(budget) },
                ],
            });
            log('created', { invitationIdentifier: invitation.invitation.invitationIdentifier, height, lockTip, timeout: lockTip + Number(blocks) });
            await missing(invitation.invitation.invitationIdentifier);
            save('open', invitation.invitation);
            break;
        }
        case 'provider open-accept': {
            const received = load('open');
            let stored: any = await engine.acceptInvitation(received, { roleIdentifier: 'provider' });
            const id = stored.invitation.invitationIdentifier;
            stored = await engine.appendOwnOutputResolutions(id, 'tabOutput', 'provider').catch((e: Error) => { console.log('appendOwnOutputResolutions:', e.message); return stored; });
            await missing(id);
            save('open', (await engine.getInvitation(id))!.invitation);
            break;
        }
        case 'owner open-fund': {
            const received = load('open');
            const id = received.invitationIdentifier;
            await engine.updateInvitation(received);
            await engine.appendOwnOutputResolutions(id, 'tabOutput', 'owner').catch((e: Error) => console.log('appendOwnOutputResolutions(owner):', e.message));
            log('tabOutput resolutions', await engine.listOutputResolutions(id, 'tabOutput', 'owner').catch((e: Error) => e.message));
            await engine.appendInvitation(id, { outputs: [ { outputIdentifier: 'tabOutput', roleIdentifier: 'owner' } ] });
            // Fund from the owner's XO P2PKH wallet.
            const utxos: any[] = (await engine.listUnspentOutputs()).filter((u: any) => u.templateIdentifier === walletTemplateIdentifier && !u.reservedBy);
            log('owner wallet utxos', utxos);
            if (utxos.length === 0) throw new Error('owner wallet empty: fund it with scripts/faucet.ts');
            const utxo = utxos.sort((a, b) => Number(b.valueSatoshis) - Number(a.valueSatoshis))[0];
            await engine.appendInvitation(id, { inputs: [ { outpointTransactionHash: hexToBin(utxo.outpointTransactionHash), outpointIndex: utxo.outpointIndex, roleIdentifier: 'owner' } ] });
            log('change availability', await engine.calculateChangeAvailability(id));
            await engine.addChangeToInvitation(id);
            await missing(id);
            for (const inputIndex of await engine.listOwnInputIndexes(id)) await engine.signInvitation(id, inputIndex);
            await missing(id);
            const txid = await execute(id, 'open');
            notes('tab', { txid, vout: 0, budget: rest[0], invitationIdentifier: id, openedAtHeight: height });
            break;
        }
        case 'provider sync': {
            // Give the provider the final open invitation (with the transaction result) so it tracks the tab output.
            const received = load('open');
            await engine.updateInvitation(received);
            log('provider script hashes', await engine.listScriptHashes());
            log('provider utxos', await engine.listUnspentOutputs());
            break;
        }
        case 'provider settle':
        case 'provider cancel':
        case 'owner refund': {
            const action = command;
            const tab = JSON.parse(readFileSync(`${INVITATIONS}/${name}.tab.json`, 'utf8'));
            // WORKAROUND (see docs/xo-findings.md): the tab's state variables are stored by XO but not used when it
            // evaluates the follow-up's output values, so the budget is passed again, read from the tracked tab UTXO.
            // The covenant checks it against the real input value, so a wrong value only produces an invalid tx.
            const tabUtxo: any = (await engine.listUnspentOutputs()).find((u: any) => u.outpointTransactionHash === tab.txid && u.outpointIndex === tab.vout);
            if (!tabUtxo) throw new Error(`tab ${tab.txid}:${tab.vout} is not an unspent output tracked by this ${who} engine`);
            const variables: any[] = [
                { variableIdentifier: 'budgetSatoshis', roleIdentifier: who, value: BigInt(tabUtxo.valueSatoshis) },
            ];
            if (action === 'refund') {
                // WORKAROUND, same cause: the transaction locktime expression $(<timeoutBlockHeight>) is evaluated from
                // the invitation's commits only, so the owner passes its stored copy of the tab state variable again.
                const tabState: any = (await engine.listScriptHashes()).find((h: any) => h.scriptHash === tabUtxo.scriptHash);
                variables.push({ variableIdentifier: 'timeoutBlockHeight', roleIdentifier: who, value: Number(tabState.variables.timeoutBlockHeight) });
            }
            if (action === 'settle') {
                const v = JSON.parse(readFileSync(`${INVITATIONS}/${name}.voucher.json`, 'utf8'));
                variables.push(
                    { variableIdentifier: 'amountSatoshis', roleIdentifier: 'provider', value: BigInt(v.amount) },
                    { variableIdentifier: 'voucher', roleIdentifier: 'provider', value: v.voucher },
                );
            }
            const template: any = await engine.getTemplate(templateIdentifier);
            const roleIntent = template.lockingScripts.agentTab.roles[who].actions.find((a: any) => a.action === action);
            const stored: any = await engine.createInvitation({ templateIdentifier, actionIdentifier: action, intent: roleIntent, variables });
            const id = stored.invitation.invitationIdentifier;
            followUpId = id;
            await engine.appendInvitation(id, {
                inputs: [ { inputIdentifier: `${action}Input`, outpointTransactionHash: hexToBin(tab.txid), outpointIndex: tab.vout, roleIdentifier: who } ],
            });
            const outputs = action === 'settle'
                ? [ { outputIdentifier: 'providerPayoutOutput', roleIdentifier: who }, { outputIdentifier: 'ownerRemainderOutput', roleIdentifier: who } ]
                : [ { outputIdentifier: 'ownerRefundOutput', roleIdentifier: who } ];
            await engine.appendInvitation(id, { outputs });
            await missing(id);
            await engine.signInvitation(id, 0);
            await missing(id);
            const txid = await execute(id, action);
            notes(`${action}-result`, { txid, invitationIdentifier: id });
            break;
        }
        case 'owner observe':
        case 'provider observe': {
            // Show this party a follow-up the other party executed, so it can track the outputs paid to it.
            const received = load(rest[0]);
            try { await engine.updateInvitation(received); console.log('updateInvitation ok'); }
            catch (e: any) {
                console.log('updateInvitation failed:', e.name, e.message);
                await engine.acceptInvitation(received); console.log('acceptInvitation ok');
            }
            log('utxos', (await engine.listUnspentOutputs()).map((u: any) => ({ tx: u.outpointTransactionHash, vout: u.outpointIndex, sats: u.valueSatoshis, template: u.templateIdentifier === templateIdentifier ? 'agenttab' : 'wallet' })));
            break;
        }
        case 'owner release':
        case 'provider release': {
            // A failed follow-up keeps the tab UTXO reserved in local storage. Archiving its invitations clears that.
            for (const s of await engine.listInvitations() as any[]) {
                const inv = s.invitation;
                if (inv.actionIdentifier !== 'openTab' && !(s.transactionResult ?? inv.result)) {
                    await engine.archiveInvitation(inv.invitationIdentifier);
                    console.log('archived', inv.invitationIdentifier, inv.actionIdentifier);
                }
            }
            break;
        }
        case 'owner status':
        case 'provider status': {
            log('height', height);
            log('script hashes', await engine.listScriptHashes());
            log('utxos', await engine.listUnspentOutputs());
            log('invitations', (await engine.listInvitations()).map((s: any) => ({ id: s.invitation.invitationIdentifier, action: s.invitation.actionIdentifier, commits: s.invitation.commits.length })));
            break;
        }
        default:
            throw new Error(`unknown command: ${who} ${command}`);
    }
} catch (error: any) {
    console.error('FAILED:', error?.name, error?.message);
    if (process.env.XO_STACK) console.error(error?.stack);
    if (error?.cause) console.error('cause:', error.cause);
    for (const k of Object.keys(error ?? {})) console.error(`  ${k}:`, json(error[k]).slice(0, 2000));
    process.exitCode = 1;
    // Do not leave the tab UTXO reserved by a half-built follow-up.
    if (followUpId) await engine.archiveInvitation(followUpId).then(() => console.error('archived failed invitation', followUpId)).catch(() => undefined);
}
await engine.stop().catch(() => undefined);
process.exit(process.exitCode ?? 0);
