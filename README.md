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

## API Endpoints

### Private Key Migration (Bulk)

**POST** `/api/migration/migrate`

Migrates multiple accounts using raw private keys (hex format or JSON wallets).

```bash
curl -X POST http://localhost:3001/api/migration/migrate \
  -H "Content-Type: application/json" \
  -d '{
    "morseWallets": ["0x123abc...", "{\"priv\":\"456def...\",\"addr\":\"789...\"}"],
    "shannonAddress": "pokt14ujjc89tud8lpwmjrffnjujw6y8vuupd5n4qzd",
    "network": "mainnet"
  }'
```

### Armored Key Migration (Single Account) ✨ NEW

**POST** `/api/migration/migrate-armored`

Migrates a single account using an armored (encrypted) private key. This uses the `claim-account` command instead of `claim-accounts`.

```bash
curl -X POST http://localhost:3001/api/migration/migrate-armored \
  -H "Content-Type: application/json" \
  -d '{
    "armoredKey": {
      "kdf": "scrypt",
      "salt": "8CF326A35F4CBDF6F9C12930EDF90156",
      "secparam": "12",
      "hint": "",
      "ciphertext": "nKg0o3fzX1FkADkA+yy0K6JGqjDTY..."
    },
    "passphrase": "mypassword123",
    "network": "beta"
  }'
```

**Request Parameters:**
- `armoredKey` (required): Object with PKK armored key structure
  - `kdf`: Key derivation function (e.g., "scrypt")
  - `salt`: Salt value for encryption
  - `secparam`: Security parameter
  - `hint`: Password hint (optional, can be empty string)
  - `ciphertext`: Encrypted private key data
- `passphrase` (optional): Decryption passphrase (empty string or omit for no passphrase)
- `network` (optional): "beta" or "mainnet" (default: "beta")

**Important Notes:**
- The armored key contains both the Morse account info AND the Shannon destination address
- The signing account (`alice`) must have funds on the target network to pay transaction fees
- Morse address and supplier stake configuration are embedded in the armored key file

**Generated Command Structure:**
```bash
pocketd tx migration claim-account <armored_key_file.json> \
  --from=alice \
  --network=<network> \
  --home=<home> \
  --keyring-backend=test \
  --chain-id=<chain-id> \
  --gas=auto \
  --gas-prices=1upokt \
  --gas-adjustment=1.5 \
  --node=<node> \
  --no-passphrase  # OR --passphrase="password"
  --yes
```

**Expected Response (Success):**
- The command extracts Morse account information from the armored key
- Creates a migration transaction to the Shannon destination address embedded in the key
- Returns transaction hash if successful

**Expected Response (Partial Success):**
- If the armored key is processed successfully but transaction fails (due to insufficient funds), you'll get:
  - `success: false` but with extracted information showing the command worked
  - `extractedInfo` containing the Morse and Shannon addresses
  - Error message indicating funding/account issues

### Validation Endpoints

**POST** `/api/migration/validate` - Validate private key migration data
**POST** `/api/migration/validate-armored` - Validate armored key migration data ✨ NEW

### Health Check

**GET** `/api/migration/health` - Check service status and CLI availability

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