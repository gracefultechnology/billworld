# Billworld mock Gmail connector

The Gmail browser frontend and email tools share an authoritative episode mailbox. Password recovery links, verification codes and billing receipts arrive as ordinary messages. The MCP connector uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), pinned in the lockfile, with stdio transport.

## Start the connector

The runner provisions these environment variables for one episode:

```text
BILLWORLD_MAIL_URL=http://127.0.0.1:<site-port>
BILLWORLD_EPISODE=<episode ID>
BILLWORLD_MAIL_TOKEN=<episode mailbox token>
```

Launch `node /absolute/path/to/billpay-research/billworld/mail-mcp.mjs` as an MCP stdio subprocess. `npm run mail:mcp` is also available locally. Keep stdout reserved for MCP protocol messages. The connector reads no private admin credential or billing database; provision its mailbox token separately from privileged runner descriptors. Do not expose full runner JSON to an evaluated agent.

Only local HTTP services are accepted, and requests cannot follow redirects. Each tool request authenticates both the episode ID and mailbox token. Browser mailbox login remains separate from portal and Google login. Signing out of the browser removes that browser's mailbox cookie; it does not revoke the independently provisioned connector credential.

## Tools

| Tool | Input | Behavior |
|---|---|---|
| `gmail_list_messages` | Optional `q`, `limit` 1–100, `cursor` | Newest-first messages with stable message-ID pagination and `nextCursor` |
| `gmail_read_message` | `id`, optional `markRead` (default true) | Normal message body/metadata; updates shared unread state when requested |
| `gmail_get_thread` | `threadId` | Thread messages in chronological order |
| `gmail_update_message` | `id`, `changes` | Boolean read/star/archive/trash/importance/spam flags only |

The search subset supports free text, quoted phrases, `from:`, `to:`, `subject:` and `is:unread`, including combined operators. Messages include sender, recipient, subject, text, received time, thread ID, unread state and an attachment list. Flag fields are optional when false/unset. Pagination continues from the last returned message ID; newly delivered messages appear on a fresh first-page request.

Bodies and recipients are immutable through these tools. There is no special “get OTP,” password grant or grading shortcut. Reading a reset message returns its ordinary text; the agent must follow its local link in the portal. Sending external messages is unavailable.

## HTTP API and validation

The service also accepts episode-scoped bearer requests with `X-Billworld-Episode`:

- `GET /connector/messages?q=...`
- `GET /connector/message?id=mail-...`
- `GET /connector/thread?id=thread-...`
- `POST /connector/mark-read` with `{ "id": "mail-..." }`
- `POST /connector/messages/update` with `{ "id": "mail-...", "changes": { "starred": true } }`

`npm test` includes a real SDK client/server stdio exchange, pagination, recovery-message retrieval, shared flags, schema rejection, nonexistent message handling and cross-episode denial. `npm run test:browser` covers mailbox password rejection, recovery, live OTP arrival, search parity, reload, sign-out and episode reset. These are reference tests, not autonomous-agent performance measurements.

Current limits: HTML bodies, attachments, realistic delivery delay, additional recipients/account switching, mailbox session expiry/revocation, a separate mailbox origin and model-agent tool integration remain unfinished. The richer inbox is a reused simulated Gmail frontend, not a fidelity-certified replica of current Google authentication.
