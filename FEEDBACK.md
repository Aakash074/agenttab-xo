# XO feedback (written by the author, Aakash Kumar)

## 1. Why I tried XO
AgentTab was already a working CashScript covenant. But every transaction was built by hand in my server code, and there was no clean way for the owner and provider to build a transaction together. I hoped a template would describe the roles, the actions (open, settle, cancel, refund) and the outputs in one place, so the wallet could handle the rest.

## 2. First hour: what was easy
The template format was easy to read once I saw faucet_cash.ts. I copied its pattern and put my compiled cashc bytecode in as CashASM. It matched cashc byte for byte and gave the same address as the CashScript SDK, which was a good moment. Opening a tab with both parties also worked without much trouble. Later the template imported into blaze.xo.cash on the first try, and the settle showed SUCCESS in the debugger.

## 3. The biggest pains
- Two engines can't run in one Node process. The second Engine.create() fails even after the first one is stopped. I had to run owner and provider as separate processes and pass invitations as files. That's fine for production but slow when you're testing.
- Follow-ups ignore stored variables. The engine already has budgetSatoshis and timeoutBlockHeight saved on the tab, but settle and refund still fail unless I pass them again. It feels like the template forgets its own contract.
- Chipnet lock height. My refund on tab t4 was rejected because I used the raw block height as the timeout. Chipnet counts timelocks in "lock height", so I had to work out that number in my own code. Nothing in XO warns you about this.

## 4. Should templates check a datasig early?
Yes. XO signed and broadcast a settle that claimed 5,000 on a 3,000 voucher, and only the chain caught it. A datasig variable type tied to a public key, or just running the VM locally before broadcast, would catch this right away with a clear error. Right now you get a confusing node error after the fact.

## 5. What I'd ask GP to fix first
Make follow-up actions use the variables already stored on the locking script. Every real contract has this kind of state (budget, timeout, keys), and having to pass it again makes templates fragile and easy to get wrong. If you send a different value than the one stored, it only fails on-chain.

## 6. Would I use XO for the next version?
Yes, with a caveat. Top-ups and multi-provider tabs mean more parties and more follow-up actions, and that's where invitations really help. But I'd wait for the stored-variables fix and the one-process limit to be sorted out first. Otherwise every new action means more workaround code.

Supporting facts with versions and repros: [docs/xo-findings.md](docs/xo-findings.md).
