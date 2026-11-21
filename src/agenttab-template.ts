import type { XOTemplate } from '@xo-cash/types';
import { AGENTTAB_CONTRACT_CASHASM } from './agenttab-cashasm.ts';

/**
 * AgentTab as an XO template.
 *
 * AgentTab is a refundable, one-way payment channel ("tab") for an AI agent. The owner locks a budget in one
 * covenant UTXO. The agent pays for API calls with off-chain vouchers: Schnorr data signatures over
 * "AGENTTAB" ++ tab outpoint ++ cumulative amount (8 bytes). The provider settles once with the best voucher.
 *
 * The covenant itself is NOT rewritten for XO. `agentTabContract` is the exact bytecode cashc 0.14.0 produced for
 * contracts/AgentTab.cash (same approach as faucet_cash.ts in the XO templates repo: embed the existing covenant,
 * then let the template enforce the transaction shape the covenant expects).
 *
 * Roles:
 *  - owner: funds the tab (openTab) and can take everything back after the timeout (refund).
 *  - provider: the paid API. Settles with an agent voucher (settle) or waives the tab (cancel).
 *
 * The agent is NOT an XO role. Its voucher is signed off-chain, before and outside any XO invitation, and is
 * handed to the provider with each paid HTTP request. In XO it enters the settle action as a provider-filled
 * `voucher` variable. The covenant checks it with OP_CHECKDATASIGVERIFY, so a wrong voucher cannot be spent.
 */
export const agentTabTemplate: XOTemplate = {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',

    name: 'AgentTab',
    description: 'A refundable tab for an AI agent: lock a budget once, pay a provider with off-chain vouchers, settle once.',
    icon: 'tab',

    version: '1',
    supported: [ 'BCH_2025_05', 'BCH_2026_05' ],

    resources: [
        {
            name: 'Original AgentTab project',
            description: 'The CashScript covenant, paywall server, MCP tools and web app that this template migrates.',
            url: 'https://github.com/Aakash074/agenttab',
        },
    ],

    roles: {
        owner: {
            name: 'Tab owner',
            description: 'Locks the budget for an agent and gets back whatever the agent did not spend.',
            icon: 'owner',
        },
        provider: {
            name: 'API provider',
            description: 'Gets paid what the agent signed for, and nothing more.',
            icon: 'provider',
        },
    },

    // The owner opens a tab with a provider. Both must take part: the provider's key is part of the covenant.
    start: [
        {
            action: 'openTab',
            role: 'owner',
            generate: [ 'ownerKey' ],
        },
    ],

    actions: {
        openTab: {
            name: 'Open a tab',
            description: 'Lock a budget for an agent, payable to one provider, refundable after a timeout.',
            icon: 'tab',

            roles: {
                owner: {
                    name: 'Fund the tab',
                    description: 'Choose the agent, the budget and the timeout, and fund the tab.',
                    icon: 'owner',
                    generate: [ 'ownerKey' ],
                    requirements: {
                        variables: [ 'agentPublicKey', 'timeoutBlockHeight', 'budgetSatoshis' ],
                    },
                },
                provider: {
                    name: 'Accept the tab',
                    description: 'Generate the key that settles or cancels this tab.',
                    icon: 'provider',
                    generate: [ 'providerKey' ],
                },
            },

            requirements: {
                participants: [
                    { role: 'owner', slots: { min: 1, max: 1 } },
                    { role: 'provider', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'openTabTransaction',
        },

        settle: {
            name: 'Settle the tab',
            description: 'Take the amount on the agent voucher. The rest goes back to the owner.',
            icon: 'settle',

            roles: {
                provider: {
                    requirements: {
                        variables: [ 'amountSatoshis', 'voucher' ],
                        secrets: [ 'providerKey' ],
                    },
                },
            },

            requirements: {
                participants: [ { role: 'provider', slots: { min: 1, max: 1 } } ],
            },

            transaction: 'settleTransaction',
        },

        cancel: {
            name: 'Cancel the tab',
            description: 'Waive the tab. The whole budget, minus the miner fee, goes back to the owner now.',
            icon: 'cancel',

            roles: {
                provider: {
                    requirements: {
                        secrets: [ 'providerKey' ],
                    },
                },
            },

            requirements: {
                participants: [ { role: 'provider', slots: { min: 1, max: 1 } } ],
            },

            transaction: 'cancelTransaction',
        },

        refund: {
            name: 'Refund the tab',
            description: 'After the timeout, take the whole budget back (minus the miner fee).',
            icon: 'refund',

            roles: {
                owner: {
                    requirements: {
                        secrets: [ 'ownerKey' ],
                    },
                },
            },

            requirements: {
                participants: [ { role: 'owner', slots: { min: 1, max: 1 } } ],
            },

            transaction: 'refundTransaction',
        },
    },

    transactions: {
        openTabTransaction: {
            name: 'Tab opened',
            description: 'Locked $(<budgetSatoshis>) satoshis in an AgentTab until block $(<timeoutBlockHeight>).',
            icon: 'tab',

            // The owner adds its own funding inputs and change.
            inputs: [],
            outputs: [ { output: 'tabOutput', outputIndex: 0 } ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        // The covenant requires exactly 1 input and exactly 2 outputs: provider first, owner second.
        settleTransaction: {
            name: 'Tab settled',
            description: 'Paid $(<amountSatoshis>) satoshis to the provider and returned the rest to the owner.',
            icon: 'settle',

            inputs: [ { input: 'settleInput', inputIndex: 0 } ],
            outputs: [
                { output: 'providerPayoutOutput', outputIndex: 0 },
                { output: 'ownerRemainderOutput', outputIndex: 1 },
            ],

            version: 2,
            locktime: 0,
            composable: false,
        },

        // The covenant requires exactly 1 input and 1 output that pays the owner.
        cancelTransaction: {
            name: 'Tab cancelled',
            description: 'Returned the budget to the owner.',
            icon: 'cancel',

            inputs: [ { input: 'cancelInput', inputIndex: 0 } ],
            outputs: [ { output: 'ownerRefundOutput', outputIndex: 0 } ],

            version: 2,
            locktime: 0,
            composable: false,
        },

        // OP_CHECKLOCKTIMEVERIFY needs nLockTime >= timeout and a non-final input sequence number.
        refundTransaction: {
            name: 'Tab refunded',
            description: 'Returned the budget to the owner after the timeout.',
            icon: 'refund',

            inputs: [ { input: 'refundInput', inputIndex: 0 } ],
            outputs: [ { output: 'ownerRefundOutput', outputIndex: 0 } ],

            version: 2,
            locktime: '$(<timeoutBlockHeight>)',
            composable: false,
        },
    },

    inputs: {
        settleInput: {
            name: 'Tab',
            description: 'The tab being settled.',
            icon: 'tab',
            valueSatoshis: '$(<budgetSatoshis>)',
            token: null,
            unlockingScript: 'settleUnlock',
        },
        cancelInput: {
            name: 'Tab',
            description: 'The tab being cancelled.',
            icon: 'tab',
            valueSatoshis: '$(<budgetSatoshis>)',
            token: null,
            unlockingScript: 'cancelUnlock',
        },
        refundInput: {
            name: 'Tab',
            description: 'The tab being refunded.',
            icon: 'tab',
            valueSatoshis: '$(<budgetSatoshis>)',
            token: null,
            // Any value below 0xffffffff keeps the input non-final, so nLockTime (and OP_CHECKLOCKTIMEVERIFY) applies.
            sequenceNumber: 0xfffffffe,
            unlockingScript: 'refundUnlock',
        },
    },

    outputs: {
        tabOutput: {
            name: 'Tab',
            description: '$(<budgetSatoshis>) satoshis locked for an agent.',
            icon: 'tab',
            lockingScript: 'agentTab',
            valueSatoshis: '$(<budgetSatoshis>)',
            token: null,
        },

        // The covenant allows the provider output to be at most the voucher amount, so the provider pays the fee.
        providerPayoutOutput: {
            name: 'Provider payment',
            description: '$(<amountSatoshis>) satoshis owed, minus the miner fee.',
            icon: 'provider',
            lockingScript: 'providerWallet',
            valueSatoshis: '$(<amountSatoshis> <minerFeeSatoshis> OP_SUB)',
            token: null,
        },

        // The covenant forces this to be exactly budget - amount.
        ownerRemainderOutput: {
            name: 'Unspent budget',
            description: 'What the agent did not spend, returned to the owner.',
            icon: 'owner',
            lockingScript: 'ownerWallet',
            valueSatoshis: '$(remainderSatoshis)',
            token: null,
        },

        // The covenant allows at most a 1000 satoshi fee on cancel. Refund has no limit, but uses the same fee.
        ownerRefundOutput: {
            name: 'Refunded budget',
            description: 'The budget returned to the owner, minus the miner fee.',
            icon: 'refund',
            lockingScript: 'ownerWallet',
            valueSatoshis: '$(<budgetSatoshis> <minerFeeSatoshis> OP_SUB)',
            token: null,
        },
    },

    lockingScripts: {
        agentTab: {
            name: 'AgentTab covenant',
            description: 'Pays the provider at most what the agent signed for and forces the rest back to the owner.',
            icon: 'tab',

            lockingType: 'p2sh',
            lockingBytecode: 'agentTabRedeemBytecode',

            // Both sides need these to rebuild the redeem script and the payout outputs in follow-ups.
            state: {
                variables: [ 'agentPublicKey', 'timeoutBlockHeight', 'budgetSatoshis' ],
            },

            // Tab coins belong to the covenant, not to either wallet.
            selectable: false,
            balance: { satoshis: 0n, fungibleTokens: 0n, nonfungibleTokens: 0 },

            roles: {
                owner: {
                    state: { secrets: [ 'ownerKey' ] },
                    actions: [
                        { action: 'refund', role: 'owner', secrets: [ { ownerKey: null } ] },
                    ],
                    selectable: false,
                    balance: { satoshis: true },
                },
                provider: {
                    state: { secrets: [ 'providerKey' ] },
                    actions: [
                        { action: 'settle', role: 'provider', secrets: [ { providerKey: null } ] },
                        { action: 'cancel', role: 'provider', secrets: [ { providerKey: null } ] },
                    ],
                    selectable: false,
                    balance: { satoshis: 0n },
                },
            },
        },

        // These are the plain P2PKH outputs the covenant pays to: hash160(provider) and hash160(owner).
        providerWallet: {
            name: 'Provider wallet',
            description: 'P2PKH address of the provider key used in this tab.',
            icon: 'provider',
            lockingType: 'p2pkh',
            lockingBytecode: 'providerP2PKHBytecode',
            unlockingBytecode: 'providerP2PKHUnlock',
            roles: {
                owner: { relevant: false },
                provider: {
                    state: { secrets: [ 'providerKey' ] },
                    selectable: true,
                    balance: { satoshis: true },
                },
            },
        },
        ownerWallet: {
            name: 'Owner wallet',
            description: 'P2PKH address of the owner key used in this tab.',
            icon: 'owner',
            lockingType: 'p2pkh',
            lockingBytecode: 'ownerP2PKHBytecode',
            unlockingBytecode: 'ownerP2PKHUnlock',
            roles: {
                provider: { relevant: false },
                owner: {
                    state: { secrets: [ 'ownerKey' ] },
                    selectable: true,
                    balance: { satoshis: true },
                },
            },
        },
    },

    scripts: {
        // NOTE: This is the AgentTab covenant exactly as cashc 0.14.0 compiled it. Do not edit it here.
        agentTabContract: AGENTTAB_CONTRACT_CASHASM,

        // CashScript pushes constructor arguments in reverse order before the contract body:
        // AgentTab(owner, agent, provider, timeout) -> <timeout> <provider> <agent> <owner> body.
        agentTabRedeemBytecode:
            '<timeoutBlockHeight> <providerKey.public_key> <agentPublicKey> <ownerKey.public_key> agentTabContract',

        // CashScript unlocking data: function arguments in reverse order, then the function index.
        // settle(sig providerSig, datasig voucher, bytes8 amountBytes) is function 0.
        settleUnlock: '<voucherAmountBytes> <voucher> <providerKey.schnorr_signature.all_outputs> OP_0',
        // cancel(sig providerSig) is function 1.
        cancelUnlock: '<providerKey.schnorr_signature.all_outputs> OP_1',
        // refund(sig ownerSig) is function 2.
        refundUnlock: '<ownerKey.schnorr_signature.all_outputs> OP_2',

        // The voucher signs the amount as 8 little-endian bytes (bytes8 in CashScript).
        voucherAmountBytes: '$(<amountSatoshis> <8> OP_NUM2BIN)',

        // What the covenant forces back to the owner on settle.
        remainderSatoshis: '<budgetSatoshis> <amountSatoshis> OP_SUB',

        providerP2PKHBytecode: 'OP_DUP OP_HASH160 <$(<providerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
        providerP2PKHUnlock: '<providerKey.schnorr_signature.all_outputs> <providerKey.public_key>',
        ownerP2PKHBytecode: 'OP_DUP OP_HASH160 <$(<ownerKey.public_key> OP_HASH160)> OP_EQUALVERIFY OP_CHECKSIG',
        ownerP2PKHUnlock: '<ownerKey.schnorr_signature.all_outputs> <ownerKey.public_key>',
    },

    constants: {
        minerFeeSatoshis: {
            name: 'Miner fee',
            description: 'Fixed fee for settle, cancel and refund. The covenant caps the cancel fee at 1000 satoshis.',
            type: 'satoshis',
            value: 1000n,
        },
    },

    variables: {
        ownerKey: {
            name: 'Owner key',
            description: 'Key of the tab owner. Receives the remainder and can refund after the timeout.',
            type: 'private_key',
        },
        providerKey: {
            name: 'Provider key',
            description: 'Key of the API provider. Settles or cancels the tab and receives the payment.',
            type: 'private_key',
        },
        agentPublicKey: {
            name: 'Agent public key',
            description: 'The agent signs vouchers with this key. It can never withdraw from the tab.',
            type: 'public_key',
        },
        timeoutBlockHeight: {
            name: 'Timeout (block height)',
            description: 'From this block on the owner can refund the whole tab. The provider must settle before it.',
            type: 'integer',
        },
        budgetSatoshis: {
            name: 'Budget',
            description: 'Satoshis locked in the tab.',
            type: 'satoshis',
        },
        amountSatoshis: {
            name: 'Voucher amount',
            description: 'The cumulative amount on the best voucher the provider holds.',
            type: 'satoshis',
        },
        voucher: {
            name: 'Agent voucher',
            description: 'Schnorr data signature by the agent over "AGENTTAB" ++ tab outpoint ++ amount (8 bytes LE).',
            type: 'bytes',
        },
    },

    icons: [
        { name: 'tab', hash: '0000000000000000000000' },
        { name: 'owner', hash: '0000000000000000000000' },
        { name: 'provider', hash: '0000000000000000000000' },
        { name: 'settle', hash: '0000000000000000000000' },
        { name: 'cancel', hash: '0000000000000000000000' },
        { name: 'refund', hash: '0000000000000000000000' },
    ],
};
