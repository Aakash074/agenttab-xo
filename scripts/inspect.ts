// Offline inspection of saved XO invitations, the same checks the debug tool needs to show them:
// schema-validates each file with XO's deserializeInvitation, lists commits, rebuilds the transaction from the merged
// commits with the AgentTab template, and compares its hash to the transaction result recorded in the invitation.
// Usage: node scripts/inspect.ts invitations/t2.open.json invitations/t2.settle.json ...
import { readFileSync } from 'node:fs';
import { deserializeInvitation, parseTemplate, generateTemplateIdentifier } from '@xo-cash/utils';
import { mergeInvitationCommits, buildInvitationTransactionFromMergedCommit } from '@xo-cash/engine';
import { agentTabTemplate } from '../src/agenttab-template.ts';

const template = parseTemplate(agentTabTemplate);
const templateIdentifier = generateTemplateIdentifier(template);
for (const path of process.argv.slice(2)) {
    const invitation: any = deserializeInvitation(readFileSync(path, 'utf8'));
    const roles = invitation.commits.map((c: any) => c.data.roleIdentifier).filter(Boolean);
    const recorded = Object.values(invitation.result?.transactions ?? {}).map((t: any) => t.transactionHash);
    let rebuilt = '(not buildable)';
    try {
        rebuilt = buildInvitationTransactionFromMergedCommit(mergeInvitationCommits(invitation, template), template, invitation.actionIdentifier).transactionHash;
    } catch (e: any) { rebuilt = `(${e.name}: ${e.message})`; }
    console.log(JSON.stringify({
        file: path, invitationIdentifier: invitation.invitationIdentifier, action: invitation.actionIdentifier,
        templateMatches: invitation.templateIdentifier === templateIdentifier, commits: invitation.commits.length,
        entities: new Set(invitation.commits.map((c: any) => c.entityIdentifier)).size, roles,
        recordedTxid: recorded[0], rebuiltTxid: rebuilt, match: recorded[0] === rebuilt,
    }));
}
process.exit(0);
