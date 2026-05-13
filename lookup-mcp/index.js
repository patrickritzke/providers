import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as moodys from './providers/moodys.js';
import * as dnb    from './providers/dnb.js';
import * as sp     from './providers/sp.js';
import { buildMatches } from './match.js';

const PROVIDERS     = { moodys, dnb, sp };
const ALL_PROVIDERS = ['moodys', 'dnb', 'sp'];

function configuredProviders(requested = ALL_PROVIDERS) {
  return requested.filter(p => {
    if (p === 'moodys') return process.env.MOODYS_USERNAME && process.env.MOODYS_PASSWORD;
    if (p === 'dnb')    return !!process.env.DNB_BASIC_TOKEN;
    if (p === 'sp')     return process.env.SP_USERNAME && process.env.SP_PASSWORD;
    return false;
  });
}

const server = new Server(
  { name: 'lookup-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'company_search',
      description: "Search for a company by name across Moody's/BvD Orbis, D&B Direct+, and S&P Capital IQ. Returns raw candidate lists from each provider with IDs (BvDID / DUNS / IQ CompanyId), location, ticker, ISIN, and LEI.",
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Company name to search for' },
          providers: {
            type: 'array',
            items: { type: 'string', enum: ['moodys', 'dnb', 'sp'] },
            description: "Providers to query. Defaults to all that have credentials configured.",
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'company_match',
      description: "Search for a company across providers and return cross-provider matched rows correlated by ticker, ISIN, or LEI. Each match row shows the same company's BvDID, DUNS, and IQ CompanyId side by side.",
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Company name to search for' },
          providers: {
            type: 'array',
            items: { type: 'string', enum: ['moodys', 'dnb', 'sp'] },
            description: "Providers to query. Defaults to all that have credentials configured.",
          },
          squishy: {
            type: 'boolean',
            description: 'Also match on website domain and address (less precise, surfaces more results). Default false.',
          },
        },
        required: ['name'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const providers = configuredProviders(args.providers);
  if (!providers.length) {
    return {
      content: [{ type: 'text', text: 'No providers configured. Set MOODYS_USERNAME/MOODYS_PASSWORD, DNB_BASIC_TOKEN, or SP_USERNAME/SP_PASSWORD.' }],
      isError: true,
    };
  }

  // Run all providers in parallel; tag errors with provider name
  const settled = await Promise.allSettled(
    providers.map(p =>
      PROVIDERS[p].search(args.name)
        .then(candidates => ({ provider: p, candidates }))
        .catch(err => Promise.reject(Object.assign(err, { provider: p })))
    )
  );

  if (name === 'company_search') {
    const output = {};
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        output[r.value.provider] = r.value.candidates;
      } else {
        output[r.reason.provider] = { error: r.reason.message };
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
  }

  if (name === 'company_match') {
    let moodysResults = [], dnbResults = [], spResults = [];
    const errors = {};

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        const { provider, candidates } = r.value;
        if (provider === 'moodys') moodysResults = candidates;
        if (provider === 'dnb')    dnbResults    = candidates;
        if (provider === 'sp')     spResults     = candidates;
      } else {
        errors[r.reason.provider] = r.reason.message;
      }
    }

    const { matches, unmoodys, undnb, unsp } = buildMatches(
      moodysResults, dnbResults, spResults, args.squishy || false
    );

    const output = {
      matches: matches.map(m => ({
        matched_on: m.key,
        value:      m.val,
        type:       m.type,
        moodys: m.moodys ? { id: m.moodys.id, name: m.moodys.name, location: m.moodys.location } : null,
        dnb:    m.dnb    ? { id: m.dnb.id,    name: m.dnb.name,    location: m.dnb.location    } : null,
        sp:     m.sp     ? { id: m.sp.id,     name: m.sp.name,     location: m.sp.location     } : null,
      })),
      unmatched: { moodys: unmoodys, dnb: undnb, sp: unsp },
      ...(Object.keys(errors).length ? { errors } : {}),
    };

    return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
