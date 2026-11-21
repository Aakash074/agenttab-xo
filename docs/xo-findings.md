# XO findings: a fact list

This is raw material for the human-written XO feedback; it is not the feedback itself. Each entry gives what happened, the version, and a repro or file reference. All of it was observed between Nov 21 and 22, 2026.

**Versions**

| Package | Version |
|---|---|
| `@xo-cash/engine` | 0.1.1-next.18230317763 (npm `next`, published 2026-11-20) |
| `@xo-cash/state` | 0.0.5 |
| `@xo-cash/utils` | 0.0.12 |
| `@xo-cash/templates` | 0.0.12 |
| `@xo-cash/types` | 0.0.8 |
| `@bitauth/libauth` | 3.1.0-next.8 |
| `@electrum-cash/application` | 0.5.3-development.18109001223 |
| Node | 25.2.1 (macOS) |

## Broken, or needed a workaround

**1. Two engines cannot run in one Node process.**
- What happens: the second `Engine.create()` throws `Error: Cannot configure storage for cache after it has been initialized.`, from `@electrum-cash/application` `configureDatabase`. It still throws after `engine.stop()` on the first engine.
- Repro: call `Engine.create(ownerMnemonic, {network: 'chipnet', …})`, then `stop()`, then `Engine.create(providerMnemonic, …)`.
- Workaround: one process per party, passing invitations as files (`scripts/tab.ts`, `scripts/run-tab.sh`).

**2. `StorageType.SQLITE` does not work.**
- What happens: `Engine.create` fails with `TypeError: this[#storage].listScriptHashes is not a function`, raised from `#monitorStoredScriptHashes`. `SQLiteStorage` in `@xo-cash/state` 0.0.5 lacks the method.
- Workaround: `StorageType.INDEXEDDB` in Node (through indexeddbshim, which still writes `.sqlite` files).

**3. `engine.stop()` rejects with an empty error.**
- What happens: it rejects with `AggregateError: All promises were rejected`, `errors: []`. Every script wraps it in `.catch()`.

**4. Follow-up actions do not use the locking script's stored `state.variables` for output values or locktime.**
- What does work: the engine stores the variables on the tab's script hash and uses them to compile the **unlocking** script.
- Output values fail: `settle` fails while merging with `Error: Missing required variable: variableNames [budgetSatoshis]` (`resolveTemplateOutputValueSatoshis` ← `completeMergedOutput` ← `mergeInvitationCommits`). The output value is `$(<budgetSatoshis> <amountSatoshis> OP_SUB)`.
- Locktime fails: `refund` fails with `MergedTransactionLocktimeVariablesMissingError Variables ["timeoutBlockHeight"] missing from commits for transaction locktime of action "refund"`. The locktime is `$(<timeoutBlockHeight>)`.
- Workaround: the follow-up invitation passes `budgetSatoshis` again (read from the tracked tab UTXO) and, for refund, `timeoutBlockHeight` (read from `listScriptHashes()[].variables`). The covenant checks both on-chain anyway. See `scripts/tab.ts`.

**5. Intent variables on locking-script follow-ups are not applied.**
- What happens: `createInvitation({intent})` only uses `intent.generate` (via `listVariableIdentifiersToGenerate`), not `intent.variables`.
- Effect: `variables: [{ budgetSatoshis: '$(XO_OUTPUTVALUE)' }]` on the follow-up intent can't replace workaround 4. In `wrapped_cash.ts` the same idea is commented out with "TODO: Restore this functionality".

**6. A failed follow-up leaves the input UTXO reserved.**
- What happens: the next attempt throws `UnspentOutputReservationExternalConflictError Unspent output "<txid>:0" is already reserved by "<old invitation id>"`. The reservation lives only in local storage.
- Fix: `archiveInvitation(oldId)` clears it. There is no `unreserve` in the Engine API.
- Repro: run a settle that fails after `appendInvitation({inputs})`, then run it again.

**7. `listMissingRequirements()` throws instead of reporting.**
- What happens: it throws when an output value expression can't be evaluated (the error in item 4). It does not list that variable as missing.

**8. No local VM check before broadcast.**
- What happens: a settle with a forged amount (5,000 claimed on a voucher for 3,000) was signed by `signInvitation` and sent by `executeAction`. The chipnet node rejected it with `mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)`.
- Why: `verifyInputUnlockingBytecode` only runs when an input has resolutions (`hasInputResolutions`).
- Repro: `CHEAT_AMOUNT=5000 node --env-file=.env scripts/tab.ts provider settle t7`.

**9. Timelocks on chipnet use lock height, not raw height (faster blocks).**
- What happens: `getChainStatus().currentHeight` is the raw height (about 341000). Chipnet height-based nLockTime and `OP_CHECKLOCKTIMEVERIFY` count in 10-minute "lock height": activation 332451 + (h − 332451) / 10, so about 333306 at the time.
- Result: a refund whose `locktime` was a raw height that had already passed was rejected with `bad-txns-nonfinal`. That was tab t4, locktime 341008 at tip 341011.
- XO has no helper for this, and templates can't express it. Workaround: compute the lock tip in the app (`scripts/tab.ts`, `lockHeightAt`).

**10. The template identifier depends on the import path.**
- What happens: `generateTemplateIdentifier(rawTsObject)` gives `800f9484…`. `importTemplate()` hashes the parsed template and gives `987d55cc…`. `parseTemplate` normalises the template, so the same template has two ids.
- Repro: `scripts/export-template.ts`.

**11. The party that did not run a follow-up does not see what it was paid.**
- What happens: after the provider's settle, the owner's engine does not list the remainder output paid to `ownerKey`'s P2PKH.
  - `updateInvitation(settleInvitation)` → `InvitationNotFoundInStoreError`.
  - `acceptInvitation(settleInvitation)` succeeds, but no UTXO appears.
- Repro: `node --env-file=.env scripts/tab.ts owner observe t1 settle`.

**12. Startup log noise on chipnet with a fresh database.**
- What happens: the console repeats `Failed to process transaction update: Error: Could not validate a block header on height 341005: The requested header is ahead of the current checkpoint at height 312224`. `getChainStatus()` showed `verifiedHeight 302144`, `verifiedPercent "0.0"`. Transactions still worked.

## Missing, or had to be done by hand

**13. No CashScript path.**
- The `cashc` artifact ASM prints data pushes as bare hex, but CashASM needs `<0x…>`, so a converter was written (`scripts/gen-cashasm.ts`).
- Constructor arguments have to be pushed in reverse order by hand: `<timeout> <provider> <agent> <owner> body`.
- The function selector (`OP_0`/`OP_1`/`OP_2`) and the reversed argument order in the unlocking scripts are also manual.
- Byte equality with cashc and with the CashScript SDK's P2SH32 address is checked in `test/template.test.ts`.

**14. `lockingType: 'p2sh'` means P2SH32 only.**
- It maps to libauth `p2sh32`. P2SH20 needs `p2s` plus a hand-written hash wrapper (as the comment in `faucet_cash.ts` says). AgentTab uses P2SH32, so this was fine.

**15. No datasig variable type.**
- The voucher is a `bytes` variable. The template cannot say "this must be a valid data signature by `agentPublicKey` over X", so it is only checked on-chain.
- Resolutions do support key-holder data signatures (the type docs mention "a public key or a data signature"). But AgentTab's agent signs vouchers off-chain, before any invitation exists, so an `agent` role wouldn't fit.

**16. No `bytes8` / fixed-width number helper.**
- The voucher amount is `$(<amountSatoshis> <8> OP_NUM2BIN)` in `scripts`.

**17. Fee estimate is flat.**
- It is `DEFAULT_FEE_SATOSHIS_PER_INPUT = 160` plus `DEFAULT_FEE_SATOSHIS_PER_OUTPUT = 120`, so it does not depend on size.
- Covenant spends are 439–547 bytes. The template uses a fixed 1,000-sat `minerFeeSatoshis` constant, the cancel cap the covenant allows.

**18. The default network is mainnet.**
- `DEFAULT_XO_NETWORK = mainnet`. If you forget `network: 'chipnet'`, the engine runs on mainnet.

**19. Docs and examples don't match the published build.**
- The README and `playground/examples/receive-satoshis.js` call `getSpendableResources`. That method does not exist in 0.1.1-next.18230317763; the available ones are `listSpendableUnspentOutputs` and `listUnspentOutputs`.
- The GitLab engine `development` branch was last committed 2026-10-11 with `package.json` 0.0.2, while npm `next` was built 2026-11-20. We had to read `dist/index.mjs` to learn the API (`appendOwnOutputResolutions`, `addChangeToInvitation`, `updateInvitation`, `archiveInvitation`).

**20. Invitations reveal account xpubs.**
- Each commit's `entityIdentifier` is the account's extended public key (`tpub…` on chipnet). Sharing an invitation file shares it.

**21. The debug tool needs a wallet before it shows anything.**
- https://blaze.xo.cash opens with "Create new account / Use existing mnemonic". There is no read-only "paste an invitation" view before a wallet exists.
- We did not create one. We wrote `scripts/inspect.ts` to rebuild each invitation's transaction offline instead.

## Worked without trouble

**22.** The libauth CashASM compiler reproduced the cashc 0.14.0 bytecode byte for byte. The P2SH32 address matched the CashScript SDK for 5 timeouts (1, 16, 17, 300000, 1.8e9).

**23.** Two-party open worked:
- the provider joins its role (`generate: ['providerKey']`);
- `appendOwnOutputResolutions(id, 'tabOutput', 'provider')` publishes `providerKey.public_key`;
- the owner adds its resolution, output, input and change (`addChangeToInvitation`), then signs and executes.

**24.** Follow-ups (`settle`, `cancel`, `refund`) started from the role intents in `lockingScripts.agentTab.roles.*.actions` and signed with keys generated in the open invitation. This includes `<providerKey.schnorr_signature.all_outputs>` checked by CashScript `checkSig`.

**25.** A refund with `sequenceNumber: 0xfffffffe` and `locktime: '$(<timeoutBlockHeight>)'` produced a valid CLTV spend once the value was in lock height (refund tx `d04830c7…`).
