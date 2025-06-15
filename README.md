# Migration Backend

A lightweight Express.js service that wraps the **Pocket Network** `pocketd` CLI command `claim-accounts` for mass-migration of Morse wallets to Shannon.

---

## Prerequisites

* Node.js **≥ 18** (to run the service).
* `pocketd` binary available in `$PATH` **or** copied into `bin/` (the Dockerfile copies it automatically).
* Linux/macOS; Windows is untested.

---

## Quick Start

```bash
# 1. Install dependencies
npm ci

# 2. Copy environment template and adjust variables if needed
cp .env.example .env

# 3. Launch (development)
npm run dev      # nodemon + ts-node, hot reload
# or production
npm start        # node src/index.js

# 4. Alternatively with Docker
docker-compose up --build
```

Environment variables (see `.env.example`):

| Key | Default | Description |
|-----|---------|-------------|
| `PORT` | `3001` | HTTP port the service listens on |
| `POCKETD_PATH` | `bin/pocketd` | Path to the `pocketd` executable |
| `NETWORK` | `main` | Network sent to `claim-accounts` |
| `CHAIN_ID` | `pocket` | Chain-ID sent to `claim-accounts` |

---

## REST API

### 1. `GET /api/migration/health`

Returns a heartbeat for the service and validates that `pocketd` is available.

**Response 200 – OK**
```json
{
  "success": true,
  "message": "Migration backend is healthy",
  "status": "operational",
  "cli": {
    "version": "v0.1.12-dev1",
    "available": true,
    "command": "claim-accounts",
    "method": "cli_real"
  },
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

**Response 503 – Degraded / CLI missing**
```json
{
  "success": false,
  "message": "Service unavailable",
  "status": "degraded",
  "error": "pocketd not found",
  "timestamp": "..."
}
```

---

### 2. `POST /api/migration/validate`

Validates the payload you intend to send to `/migrate` without actually executing the CLI.

**Request Body**
```json
{
  "morseWallets": ["<hexPrivKey|walletJSON>", "..."],
  "shannonAddress": {
    "address": "pokt1...",
    "signature": "<hexPrivKeyOfShannonSigner>"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `morseWallets` | `string[]` | ✅ | Array containing Morse private keys **or** complete wallet JSON objects. |
| `shannonAddress` | `string` **or** object | ✅ | Destination Shannon address **OR** `{ address, signature }` object containing signature (private key hex) of the signer to import. |

**Response 200 – Valid**
```json
{
  "success": true,
  "valid": true,
  "message": "Migration data is valid for CLI execution",
  "data": {
    "morseWalletsCount": 3,
    "shannonAddress": "pokt1...",
    "method": "cli_claim_accounts",
    "readyForMigration": true
  }
}
```

---

### 3. `POST /api/migration/migrate`

Executes Pocket Network CLI migration.

**Request Body** – *same schema as `/validate`*

Additional behaviour:
* Writes all Morse keys to `data/input/migration-input-<sessionId>.json`.
* Produces `data/output/migration-output-<sessionId>.json` containing CLI result.

**Response 200 – Success**
```json
{
  "success": true,
  "data": {
    "success": true,
    "sessionId": "b9d4d1d2-5ffc-44f0-8eee-c3e6b6b40c20",
    "result": {
      "mappings": [...],
      "txHash": "...",
      "accountsMigrated": 3,
      ...
    },
    "timestamp": "2025-01-01T12:34:56.000Z"
  }
}
```

**Response 4xx / 5xx** – Error details returned.

---

## Workflow Overview

1. **Validate** your payload (optional but recommended).  
2. **Migrate** – on success you receive a JSON result and a generated transaction (unsigned or offline, depending on flags).  
3. Inspect `data/output/` for detailed CLI output and mappings.

---

## File Structure

```
migration-backend/
├─ bin/                  # pocketd binary (optional – mounted by Dockerfile)
├─ data/
│  ├─ input/             # Generated migration-input-<id>.json files
│  ├─ output/            # Generated migration-output-<id>.json files
│  └─ temp/              # Work files (cleaned automatically)
├─ src/
│  ├─ routes/migration.js
│  └─ services/migration-executor.js
├─ Dockerfile            # Production image (includes pocketd)
└─ docker-compose.yml    # One-command local stack
```

---

## License

MIT © 2025 Nodefleet 