# lookup-mcp

MCP server for company lookup across Moody's/BvD Orbis, D&B Direct+, and S&P Capital IQ.

## Tools

### `company_search`
Search by name, returns raw candidate lists from each provider.

```json
{ "name": "Starbucks", "providers": ["moodys", "dnb", "sp"] }
```

### `company_match`
Search by name, returns cross-provider matched rows correlated by ticker/ISIN/LEI.

```json
{ "name": "Starbucks", "squishy": false }
```

Each match row shows BvDID + DUNS + IQ CompanyId side by side.

## Setup

```bash
cd lookup-mcp
npm install
cp .env.example .env
# fill in .env
```

## Credentials

Set via environment variables (no proxy needed — Node.js calls APIs directly):

| Variable | Description |
|----------|-------------|
| `MOODYS_USERNAME` | BvD/Orbis login |
| `MOODYS_PASSWORD` | BvD/Orbis password |
| `MOODYS_BASE_URL` | Optional endpoint override |
| `DNB_BASIC_TOKEN` | `btoa('API_key:API_secret')` from D&B Direct+ portal |
| `SP_USERNAME` | S&P Capital IQ username |
| `SP_PASSWORD` | S&P Capital IQ password |

Providers without credentials are silently skipped. At least one provider must be configured.

## Claude Desktop config

```json
{
  "mcpServers": {
    "lookup": {
      "command": "node",
      "args": ["/path/to/lookup-mcp/index.js"],
      "env": {
        "MOODYS_USERNAME": "...",
        "MOODYS_PASSWORD": "...",
        "DNB_BASIC_TOKEN": "...",
        "SP_USERNAME": "...",
        "SP_PASSWORD": "..."
      }
    }
  }
}
```

## Notes

- No Cloudflare proxy needed — Node.js has no CORS restrictions
- S&P bearer token is cached in memory with a 30s expiry buffer; invalidated on 401
- Provider calls run in parallel; one failure doesn't block the others
- Enrich step (S&P ticker/website/address) is non-fatal — search results returned even if it fails
