// Writes the template as XO extended JSON (bigints encoded), ready for "Import Template" in https://blaze.xo.cash.
import { writeFileSync, mkdirSync } from 'node:fs';
import { serializeTemplate, generateTemplateIdentifier, parseTemplate } from '@xo-cash/utils';
import { agentTabTemplate } from '../src/agenttab-template.ts';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/agenttab.template.json', serializeTemplate(agentTabTemplate));
// NOTE: the identifier of the raw TS object differs from the one the engine stores, because importTemplate hashes
// the parsed (normalised) template. Print the one the engine and blaze.xo.cash will show.
console.log('wrote dist/agenttab.template.json; templateIdentifier', generateTemplateIdentifier(parseTemplate(agentTabTemplate)));
