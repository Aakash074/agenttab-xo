// Two XO engines (owner, provider) on chipnet, one SQLite file each under .xo-state/ (gitignored).
// Owner and provider MUST be separate accounts: XO rejects one account holding two roles with follow-ups
// (EntityMultipleRolesWithFollowUpUnsupportedError).
import { mkdirSync } from 'node:fs';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { StorageType } from '@xo-cash/state';
import { p2pkhTemplate } from '@xo-cash/templates';
import { agentTabTemplate } from '../../src/agenttab-template.ts';

export const STATE_DIR = '.xo-state';

export function env(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} missing: run "node scripts/keygen.ts" and use "node --env-file=.env ..."`);
    return value;
}

export async function createEngine(who: 'owner' | 'provider') {
    mkdirSync(STATE_DIR, { recursive: true });
    const engine = await Engine.create(env(who === 'owner' ? 'OWNER_MNEMONIC' : 'PROVIDER_MNEMONIC'), {
        network: XO_SUPPORTED_NETWORKS.chipnet,
        storageType: StorageType.INDEXEDDB, // SQLITE is incomplete in @xo-cash/state 0.0.5 (no listScriptHashes)
        databasePath: `${STATE_DIR}/`,
        databaseFilename: `xo-${who}`,
    });
    const { templateIdentifier } = await engine.importTemplate(agentTabTemplate);
    const { templateIdentifier: walletTemplateIdentifier } = await engine.importTemplate(p2pkhTemplate);
    return { engine, templateIdentifier, walletTemplateIdentifier };
}

export const json = (value: unknown) => JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
    return v;
}, 2);
