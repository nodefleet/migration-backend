const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

// Promisificar exec para usar async/await
const execAsync = promisify(exec);

class MigrationExecutor {
    constructor() {
        this.baseDir = path.join(__dirname, '../../data');
        this.inputDir = path.join(this.baseDir, 'input');
        this.outputDir = path.join(this.baseDir, 'output');
        this.tempDir = path.join(this.baseDir, 'temp');

        // Ensure directories exist
        this.initializeDirectories();
    }

    async initializeDirectories() {
        await fs.mkdir(this.inputDir, { recursive: true });
        await fs.mkdir(this.outputDir, { recursive: true });
        await fs.mkdir(this.tempDir, { recursive: true });
        console.log('📁 Directories created successfully');
    }

    /**
     * Execute complete migration process
     * @param {Object} migrationData - Migration data
     * @param {Object} options - Options for migration
     * @param {string} options.network - Network to use (beta or testnet)
     */
    async executeMigration(migrationData, options = {}) {
        const sessionId = uuidv4();
        console.log(`🚀 Starting migration session: ${sessionId}`);

        // Get network from options or default to beta
        const network = options.network || 'beta';
        console.log(`🌐 Using network: ${network}`);

        try {
            // Validate inputs
            this.validateMigrationData(migrationData);

            // Prepare input file
            const inputFile = await this.prepareInputFile(migrationData, sessionId);

            // Ensure alice account exists
            await this.ensureAliceAccount();

            // IMPORTANTE: Usar "alice" como cuenta firmante, NO usar el shannon address
            const signingAccount = "alice";
            console.log(`📍 Morse Private Key preview: ${migrationData.morsePrivateKeys[0].substring(0, 20)}...`);
            console.log(`📍 Shannon Address: ${migrationData.signingAccount}`);

            // Verificar si recibimos la firma de Shannon
            if (migrationData.shannonAddress && migrationData.shannonAddress.signature) {
                console.log(`📍 Shannon Signature recibida: ${migrationData.shannonAddress.signature.substring(0, 20)}...`);
            }

            console.log(`🎯 Starting CLI migration with claim-accounts on network ${network}...`);

            // Execute migration command with the FULL list of Morse private keys
            const result = await this.runMigrationCommand(
                migrationData.morsePrivateKeys,
                migrationData.shannonAddress?.address || migrationData.signingAccount,
                migrationData.shannonAddress?.signature,
                sessionId,
                network
            );

            console.log(`✅ Migration session completed: ${sessionId}`);
            return {
                success: true,
                sessionId,
                result,
                timestamp: new Date().toISOString(),
                network
            };

        } catch (error) {
            console.error(`❌ Migration session failed: ${sessionId}`, error);

            // Clean up on error
            await this.cleanup(sessionId);

            throw {
                success: false,
                sessionId,
                error: error.message,
                timestamp: new Date().toISOString(),
                network
            };
        }
    }

    validateMigrationData(migrationData) {
        if (!migrationData.morsePrivateKeys || !Array.isArray(migrationData.morsePrivateKeys)) {
            throw new Error('Invalid morsePrivateKeys: must be an array');
        }

        if (migrationData.morsePrivateKeys.length === 0) {
            throw new Error('No Morse private keys provided');
        }

        if (!migrationData.signingAccount || typeof migrationData.signingAccount !== 'string') {
            throw new Error('Invalid signingAccount: must be a non-empty string');
        }

        // Validate each private key format
        for (const [index, privateKey] of migrationData.morsePrivateKeys.entries()) {
            if (!this.isValidMorsePrivateKey(privateKey)) {
                throw new Error(`Invalid Morse private key at index ${index}`);
            }
        }

        // Validate Shannon address format
        if (!this.isValidShannonAddress(migrationData.signingAccount)) {
            throw new Error('Invalid Shannon signing account address format');
        }
    }

    isValidMorsePrivateKey(privateKey) {
        if (typeof privateKey !== 'string') return false;

        const trimmed = privateKey.trim();

        // Check if it's JSON format first (same as frontend)
        try {
            if (trimmed.startsWith('{')) {
                const parsed = JSON.parse(trimmed);

                // FORMATO MODIFICADO: Aceptar cualquier JSON que tenga al menos el campo priv
                if (parsed.priv) {
                    // priv debe ser hexadecimal de 64 o 128 caracteres
                    const privHex = parsed.priv.startsWith('0x')
                        ? parsed.priv.substring(2)
                        : parsed.priv;

                    const hasValidPriv = typeof parsed.priv === 'string' &&
                        /^[0-9a-fA-F]{64,128}$/i.test(privHex);

                    console.log(`✅ JSON wallet validado - clave privada válida: ${hasValidPriv}`);
                    return hasValidPriv;
                }

                // Si no tiene priv pero tiene addr, también es válido
                if (parsed.addr) {
                    const hasValidAddr = typeof parsed.addr === 'string' &&
                        /^[0-9a-fA-F]{40}$/i.test(parsed.addr);

                    console.log(`✅ JSON wallet validado - dirección válida: ${hasValidAddr}`);
                    return hasValidAddr;
                }

                console.log('❌ JSON wallet inválido - no tiene campos priv o addr');
                return false;
            }
        } catch (e) {
            console.log(`❌ Error parseando JSON: ${e.message}`);
            // Not JSON, check if it's hex format
        }

        // Check hex format (same as frontend logic)
        const cleanHex = trimmed.startsWith('0x') ? trimmed.substring(2) : trimmed;

        // Morse private keys can be 64 or 128 characters
        // Morse addresses are 40 characters
        const isMorsePrivateKey = /^[0-9a-fA-F]{64}$/.test(cleanHex) || /^[0-9a-fA-F]{128}$/.test(cleanHex);
        const isMorseAddress = /^[0-9a-fA-F]{40}$/.test(cleanHex);

        // Accept both private keys and addresses (same as frontend)
        return isMorsePrivateKey || isMorseAddress;
    }

    isValidShannonAddress(address) {
        return typeof address === 'string' &&
            (address.startsWith('pokt') || address.startsWith('poktval')) &&
            address.length >= 40;
    }

    async prepareInputFile(migrationData, sessionId) {
        // Usar directamente el array de morseWallets 
        let inputData = [];

        // Procesar cada elemento del array
        for (const key of migrationData.morsePrivateKeys) {
            try {
                // Si es formato JSON de wallet Morse, extraer solo la clave privada
                if (typeof key === 'string' && key.trim().startsWith('{')) {
                    try {
                        const morseJson = JSON.parse(key.trim());
                        if (morseJson.priv) {
                            // Extraer SOLO la clave privada del JSON como string
                            const privateKey = morseJson.priv.startsWith('0x')
                                ? morseJson.priv.substring(2)
                                : morseJson.priv;

                            inputData.push(privateKey);
                        }
                    } catch (e) {
                        // Si no se puede parsear como JSON, usar directamente
                        inputData.push(key);
                    }
                } else {
                    // Si es una clave privada hex, limpiar y usar directamente
                    const privateKey = key.trim().startsWith('0x')
                        ? key.trim().substring(2)
                        : key.trim();

                    inputData.push(privateKey);
                }
            } catch (e) {
                throw new Error(`Could not process key: ${e.message}`);
            }
        }

        const fileName = `migration-input-${sessionId}.json`;
        const filePath = path.join(this.inputDir, fileName);

        // Guardar el archivo como array de strings (formato que espera claim-accounts)
        await fs.writeFile(filePath, JSON.stringify(inputData), 'utf8');

        return filePath;
    }

    /**
     * Asegura que la cuenta alice exista en el keyring para la migración
     */
    async ensureAliceAccount() {
        const homeDir = path.join(process.cwd(), 'localnet/pocketd');
        if (!require('fs').existsSync(homeDir)) {
            require('fs').mkdirSync(homeDir, { recursive: true });
        }

        try {
            // Verificar si la cuenta alice ya existe
            try {
                const { stdout } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home ${homeDir} --keyring-backend test`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                // Si ya existe alice, no hacer nada
                if (stdout.includes('alice')) {
                    console.log('✅ Alice account already exists');
                    return true;
                }
            } catch (e) {
                console.log('⚠️ Error listing keys, will try to create alice anyway');
            }

            console.log('🔑 Creating alice account...');

            // Crear la cuenta alice para fines de generar la transacción (non-interactive)
            try {
                const { stdout } = await execAsync(`${process.cwd()}/bin/pocketd keys add alice --home ${homeDir} --keyring-backend test --output json`, {
                    timeout: 15000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                console.log('✅ Alice account created successfully');
                console.log('📋 Alice account info:', stdout);
            } catch (createError) {
                // If creation fails, check if it's because the account already exists
                if (createError.stderr && (createError.stderr.includes('already exists') || createError.stderr.includes('duplicated'))) {
                    console.log('✅ Alice account already exists (caught from creation error)');
                    return true;
                }
                
                console.error('❌ Error creating alice account:', createError);
                throw createError;
            }

            // Verificar que se creó
            try {
                const { stdout } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home ${homeDir} --keyring-backend test`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                if (stdout.includes('alice')) {
                    console.log('✅ Verified alice account exists');
                    return true;
                } else {
                    console.log('⚠️ Alice account not found in keyring list, but continuing anyway');
                    return true; // Continue anyway since we'll use Shannon key if available
                }
            } catch (verifyError) {
                console.log('⚠️ Could not verify alice account, but continuing anyway');
                return true; // Continue anyway since we'll use Shannon key if available
            }

        } catch (error) {
            console.error('❌ Error in ensureAliceAccount:', error);
            
            // Don't throw the error - just log it and continue
            // The migration might still work if Shannon key is provided
            console.log('⚠️ Alice account creation failed, but continuing with migration...');
            return false;
        }
    }

    /**
     * Run the CLI claim-accounts command with ALL Morse private keys.
     * @param {string[]} morsePrivateKeys – array of Morse private keys / wallet JSONs
     * @param {string} shannonAddress – Shannon destination address
     * @param {string} shannonSignature – Hex signature of Shannon private key (optional)
     * @param {string} sessionId – unique identifier for this session
     * @param {string} network – Network to use (beta or testnet)
     */
    async runMigrationCommand(morsePrivateKeys, shannonAddress, shannonSignature, sessionId, network = 'beta') {
        try {
            // Crear directorios necesarios
            await this.initializeDirectories();

            // Definir directorio home para pocketd y asegurarse de que exista
            const homeDir = path.resolve(path.join(process.cwd(), 'localnet/pocketd'));
            if (!require('fs').existsSync(homeDir)) {
                require('fs').mkdirSync(homeDir, { recursive: true });
            }

            // Build array of cleaned private keys (hex only) to write to input file
            const cleanedKeys = [];
            for (let key of morsePrivateKeys) {
                try {
                    if (typeof key === 'string' && key.trim().startsWith('{')) {
                        const json = JSON.parse(key.trim());
                        if (json.priv) {
                            key = json.priv;
                        }
                    }
                } catch (_) { /* ignore parse errors */ }

                // Remove 0x prefix if present
                let clean = typeof key === 'string' && key.trim().startsWith('0x') ? key.trim().substring(2) : key.trim();
                cleanedKeys.push(clean);
            }

            // Write ALL keys to input file (CLI expects array)
            const inputFilePath = path.resolve(path.join(this.inputDir, `migration-input-${sessionId}.json`));
            await fs.writeFile(inputFilePath, JSON.stringify(cleanedKeys), 'utf8');

            const keyringBackend = `test`;

            // Crear un directorio específico para este keyring
            const keyringDir = path.join(homeDir, `keyring-${keyringBackend}`);
            if (!require('fs').existsSync(keyringDir)) {
                require('fs').mkdirSync(keyringDir, { recursive: true });
            }

            // IMPORTAR LA CUENTA SHANNON
            const shannonKeyName = `shannon-${sessionId.substring(0, 8)}`;
            let useAliceForSigning = false;

            // Vaciar el keyring antes de importar la clave Shannon
            try {
                console.log('🧹 Limpiando el keyring antes de importar la clave Shannon...');

                // Listar todas las claves existentes
                const { stdout: existingKeys } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home=${homeDir} --keyring-backend=${keyringBackend}`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                console.log('🔑 Claves existentes en el keyring:');
                console.log(existingKeys);

                // Eliminar todas las claves existentes
                const keyLines = existingKeys.split('\n');
                for (const line of keyLines) {
                    if (line.includes('name:')) {
                        const keyName = line.replace('- name:', '').trim();
                        if (keyName) {
                            try {
                                console.log(`🗑️ Eliminando clave: ${keyName}`);
                                await execAsync(`${process.cwd()}/bin/pocketd keys delete ${keyName} --home=${homeDir} --keyring-backend=${keyringBackend} --yes`, {
                                    timeout: 10000,
                                    env: {
                                        ...process.env,
                                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                    }
                                });
                            } catch (deleteError) {
                                console.error(`⚠️ Error al eliminar clave ${keyName}:`, deleteError.message);
                            }
                        }
                    }
                }

                console.log('✅ Keyring limpiado correctamente');
            } catch (cleanError) {
                console.error('⚠️ Error al limpiar el keyring:', cleanError.message);
            }

            if (shannonSignature) {
                try {
                    // Limpiar espacios
                    let cleanSignature = shannonSignature.trim();

                    // Detectar si es una mnemónica (frase semilla)
                    const wordCount = cleanSignature.split(' ').length;
                    const isMnemonic = wordCount >= 12 && wordCount <= 24;

                    if (isMnemonic) {
                        console.log(`Detectada mnemónica Shannon (${wordCount} palabras)`);

                        try {
                            // Crear un archivo temporal con la mnemónica
                            const mnemonicFile = path.join(this.tempDir, `mnemonic-${sessionId}.txt`);
                            await fs.writeFile(mnemonicFile, cleanSignature);

                            // Usar el comando add con --recover y --source para importar desde archivo
                            const importCmd = `${process.cwd()}/bin/pocketd keys add ${shannonKeyName} --recover --source=${mnemonicFile} --home=${homeDir} --keyring-backend=${keyringBackend}`;

                            const { stdout, stderr } = await execAsync(importCmd, {
                                timeout: 30000,
                                env: {
                                    ...process.env,
                                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                }
                            });

                            // Eliminar el archivo temporal
                            await fs.unlink(mnemonicFile);

                            console.log(`✅ Clave Shannon importada desde mnemónica: ${stdout}`);
                        } catch (importError) {
                            // Verificar si el error es porque la clave ya existe
                            if (importError.stderr && importError.stderr.includes('duplicated address')) {
                                console.log(`✅ La clave Shannon ya existe en el keyring, continuando...`);
                            } else {
                                // Si es otro error, usamos alice como fallback
                                console.error('Error importing Shannon key:', importError.message);
                                if (importError.stderr) console.error('Error details:', importError.stderr);
                                useAliceForSigning = true;
                            }
                        }
                    } else {
                        // Quitar 0x si existe (para claves hex)
                        if (cleanSignature.startsWith('0x')) {
                            cleanSignature = cleanSignature.substring(2);
                        }

                        try {
                            // Importar la clave Shannon como hexadecimal
                            const importShannonCmd = `${process.cwd()}/bin/pocketd keys import-hex ${shannonKeyName} "${cleanSignature}" --home=${homeDir} --keyring-backend=${keyringBackend}`;
                            const { stdout, stderr } = await execAsync(importShannonCmd, {
                                timeout: 30000,
                                env: {
                                    ...process.env,
                                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                }
                            });

                            console.log(`✅ Clave Shannon importada como hex: ${stdout}`);
                        } catch (importError) {
                            // Verificar si el error es porque la clave ya existe
                            if (importError.stderr && (importError.stderr.includes('duplicated address') || importError.stderr.includes('already exists'))) {
                                console.log(`✅ La clave Shannon ya existe en el keyring, continuando...`);
                            } else {
                                // Si es otro error, usamos alice como fallback
                                console.error('Error importing Shannon key:', importError.message);
                                if (importError.stderr) console.error('Error details:', importError.stderr);
                                useAliceForSigning = true;
                            }
                        }
                    }
                } catch (shannonImportError) {
                    console.error('Error importing Shannon key:', shannonImportError.message);
                    if (shannonImportError.stderr) console.error('Error details:', shannonImportError.stderr);
                    useAliceForSigning = true;
                }
            } else {
                // Si no hay firma Shannon, usamos alice
                useAliceForSigning = true;
            }

            // Verificar que las claves se importaron correctamente
            try {
                const { stdout: keyInfo } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home=${homeDir} --keyring-backend=${keyringBackend}`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                console.log('🔑 Available keys in keyring:');
                console.log(keyInfo);

                // Si la clave Shannon no está en la lista, usar alice
                if (!keyInfo.includes(shannonKeyName)) {
                    console.log(`⚠️ Shannon key ${shannonKeyName} not found in keyring, using alice instead`);
                    useAliceForSigning = true;
                }
            } catch (error) {
                console.error('Error listing keys:', error);
                useAliceForSigning = true;
            }

            // Determinar qué clave usar para firmar
            const signingKeyName = useAliceForSigning ? 'alice' : shannonKeyName;
            console.log(`🔑 Using ${signingKeyName} for signing the transaction`);

            // Definir archivo de salida
            const outputFilePath = path.resolve(path.join(this.outputDir, `migration-output-${sessionId}.json`));

            // Configurar parámetros según la red
            let chainId, nodeUrl, net;
            if (network === 'mainnet') {
                net = 'main'
                chainId = 'pocket';
                nodeUrl = 'https://shannon-grove-rpc.mainnet.poktroll.com';
            } else {
                // Default: beta
                net = 'beta'
                chainId = 'pocket-beta';
                nodeUrl = 'https://rpc.shannon-testnet.eu.nodefleet.net';
            }

            console.log(`🌐 Using network: ${network}, chain-id: ${chainId}, node: ${nodeUrl}`);

            // El comando de migración exactamente como lo usó jorgecuesta
            const command = `pocketd tx migration claim-accounts` +
                ` --input-file=${inputFilePath}` +
                ` --output-file=${outputFilePath}` +
                ` --home=${homeDir}` +
                ` --keyring-backend=${keyringBackend}` +
                ` --from=${signingKeyName}` +
                ` --unsafe --unarmored-json` +
                ` --destination=${shannonAddress}` +
                ` --network=${net}` +
                ` --chain-id=${chainId}` +
                ` --gas=auto` +
                ` --gas-adjustment=1.1` +
                ` --gas-prices=0.001upokt` +
                ` --node=${nodeUrl}` +
                ` --yes`;

            try {
                const { stdout, stderr } = await execAsync(command, {
                    timeout: 120000, // 2 minutos de timeout para la transacción
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                // Verificar resultado
                if (require('fs').existsSync(outputFilePath)) {
                    const outputContent = await fs.readFile(outputFilePath, 'utf8');

                    try {
                        const outputData = JSON.parse(outputContent);

                        return {
                            success: true,
                            mappings: outputData.mappings || [],
                            txHash: outputData.tx_hash || 'generated',
                            txCode: outputData.tx_code || 0,
                            accountsMigrated: outputData.mappings ? outputData.mappings.length : 0,
                            error: null,
                            method: 'cli_claim_accounts',
                            network: network
                        };
                    } catch (jsonError) {
                        throw new Error(`Failed to parse output file: ${jsonError.message}`);
                    }
                } else {
                    throw new Error('Migration did not generate output file');
                }
            } catch (cmdError) {
                console.error('Migration command error:', cmdError.message);

                if (cmdError.stdout) console.log('Command stdout:', cmdError.stdout);
                if (cmdError.stderr) console.log('Command stderr:', cmdError.stderr);

                // Parse specific error types for better user experience
                let errorMessage = 'Migration command failed.';
                let errorType = 'unknown';

                if (cmdError.stderr) {
                    if (cmdError.stderr.includes('has already been claimed')) {
                        // Parse the already claimed error for details
                        const alreadyClaimedMatch = cmdError.stderr.match(/morse address "([^"]+)" has already been claimed at height (\d+) by shannon address "([^"]+)"/);
                        if (alreadyClaimedMatch) {
                            const [, morseAddr, height, shannonAddr] = alreadyClaimedMatch;
                            errorMessage = `Morse account ${morseAddr} has already been migrated to Shannon address ${shannonAddr} at block height ${height}. Each Morse account can only be migrated once.`;
                            errorType = 'already_claimed';
                        } else {
                            errorMessage = 'One or more Morse accounts have already been migrated to other Shannon addresses. Each Morse account can only be migrated once.';
                            errorType = 'already_claimed';
                        }
                    } else if (cmdError.stderr.includes('account') && cmdError.stderr.includes('not found')) {
                        errorMessage = 'Migration failed because the signing account lacks funds or was not found on the network.';
                        errorType = 'account_not_found';
                    } else if (cmdError.stderr.includes('insufficient funds') || cmdError.stderr.includes('insufficient account funds')) {
                        errorMessage = 'Migration failed due to insufficient funds in the signing account.';
                        errorType = 'insufficient_funds';
                    } else if (cmdError.stderr.includes('0/') && cmdError.stderr.includes('claimable Morse accounts found')) {
                        errorMessage = 'No claimable Morse accounts found in the snapshot. Please verify that the provided private keys correspond to valid Morse accounts that haven\'t been migrated yet.';
                        errorType = 'no_claimable_accounts';
                    } else {
                        errorMessage = `Migration command failed: ${cmdError.message}`;
                        errorType = 'generic';
                    }
                } else {
                    errorMessage = `Migration command failed: ${cmdError.message}`;
                    errorType = 'generic';
                }

                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error(`CLI migration failed:`, error);

            // Enhanced error response with type information
            let errorType = 'unknown';
            if (error.message.includes('already been migrated') || error.message.includes('already been claimed')) {
                errorType = 'already_claimed';
            } else if (error.message.includes('not found')) {
                errorType = 'account_not_found';
            } else if (error.message.includes('insufficient funds')) {
                errorType = 'insufficient_funds';
            } else if (error.message.includes('No claimable Morse accounts')) {
                errorType = 'no_claimable_accounts';
            }

            return {
                success: false,
                error: error.message,
                errorType: errorType,
                details: error.toString(),
                method: 'cli_claim_accounts',
                network: network
            };
        }
    }

    /**
     * Execute single account migration using armored key and claim-account command
     * @param {string} morseAddress - Not used (morse address is in armored key)
     * @param {Object} armoredKey - Armored (encrypted) private key JSON
     * @param {Object} supplierStakeYaml - Not supported (supplier stake not available in claim-account)
     * @param {Object} options - Migration options including network, passphrase, and Shannon signing key
     */
    async executeArmoredMigration(morseAddress, armoredKey, supplierStakeYaml, options = {}) {
        const sessionId = uuidv4();
        console.log(`🚀 Starting armored key migration session: ${sessionId}`);

        // Get network from options or default to beta
        const network = options.network || 'beta';
        const passphrase = options.passphrase || '';
        const shannonAddress = options.shannonAddress;
        const shannonSignature = options.shannonSignature;
        console.log(`🌐 Using network: ${network}`);

        try {
            // Validate inputs
            this.validateArmoredMigrationData(armoredKey);

            // Prepare armored key file
            const armoredKeyFile = await this.prepareArmoredKeyFile(armoredKey, sessionId);

            // Ensure alice account exists as fallback
            const aliceExists = await this.ensureAliceAccount();

            console.log(`🔐 Armored key file: ${armoredKeyFile}`);
            console.log(`🔑 Passphrase provided: ${!!passphrase}`);
            console.log(`📍 Shannon address provided: ${!!shannonAddress}`);
            console.log(`📝 Shannon signature provided: ${!!shannonSignature}`);
            console.log(`👤 Alice account available: ${aliceExists}`);

            // Check if we have a signing option available
            if (!aliceExists && !shannonSignature) {
                throw new Error('No signing account available. Alice account creation failed and no Shannon signature provided.');
            }

            // Execute single account migration command
            const result = await this.runArmoredMigrationCommand(
                armoredKeyFile,
                sessionId,
                network,
                passphrase,
                shannonAddress,
                shannonSignature,
                aliceExists
            );

            console.log(`✅ Armored migration session completed: ${sessionId}`);
            return {
                success: true,
                sessionId,
                result,
                timestamp: new Date().toISOString(),
                network
            };

        } catch (error) {
            console.error(`❌ Armored migration session failed: ${sessionId}`, error);

            // Clean up on error
            await this.cleanup(sessionId);

            throw {
                success: false,
                sessionId,
                error: error.message,
                timestamp: new Date().toISOString(),
                network
            };
        }
    }

    /**
     * Validate armored migration data
     */
    validateArmoredMigrationData(armoredKey) {
        if (!armoredKey || typeof armoredKey !== 'object') {
            throw new Error('Invalid armored key: must be an object');
        }

        // Validate armored key structure
        const requiredFields = ['kdf', 'salt', 'secparam', 'ciphertext'];
        for (const field of requiredFields) {
            if (!armoredKey[field]) {
                throw new Error(`Invalid armored key: missing required field '${field}'`);
            }
        }
    }

    /**
     * Prepare armored key file
     */
    async prepareArmoredKeyFile(armoredKey, sessionId) {
        const fileName = `armored-key-${sessionId}.json`;
        const filePath = path.join(this.tempDir, fileName);
        
        await fs.writeFile(filePath, JSON.stringify(armoredKey, null, 2), 'utf8');
        console.log(`📄 Armored key file created: ${filePath}`);
        
        return filePath;
    }

    // Note: Supplier stake files are not supported with claim-account command
    // This command only works with the armored key file which contains all necessary information

    /**
     * Run the armored key migration command using claim-account
     */
    async runArmoredMigrationCommand(armoredKeyFile, sessionId, network = 'beta', passphrase = '', shannonAddress = null, shannonSignature = null, aliceExists = true) {
        try {
            // Definir directorio home para pocketd
            const homeDir = path.resolve(path.join(process.cwd(), 'localnet/pocketd'));
            if (!require('fs').existsSync(homeDir)) {
                require('fs').mkdirSync(homeDir, { recursive: true });
            }

            const keyringBackend = 'test';

            // IMPORTAR LA CUENTA SHANNON (similar al código de private key migration)
            const shannonKeyName = `shannon-${sessionId.substring(0, 8)}`;
            let useAliceForSigning = false;

            // Vaciar el keyring antes de importar la clave Shannon
            try {
                console.log('🧹 Limpiando el keyring antes de importar la clave Shannon...');

                // Listar todas las claves existentes
                const { stdout: existingKeys } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home=${homeDir} --keyring-backend=${keyringBackend}`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                console.log('🔑 Claves existentes en el keyring:');
                console.log(existingKeys);

                // Eliminar todas las claves existentes
                const keyLines = existingKeys.split('\n');
                for (const line of keyLines) {
                    if (line.includes('name:')) {
                        const keyName = line.replace('- name:', '').trim();
                        if (keyName) {
                            try {
                                console.log(`🗑️ Eliminando clave: ${keyName}`);
                                await execAsync(`${process.cwd()}/bin/pocketd keys delete ${keyName} --home=${homeDir} --keyring-backend=${keyringBackend} --yes`, {
                                    timeout: 10000,
                                    env: {
                                        ...process.env,
                                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                    }
                                });
                            } catch (deleteError) {
                                console.error(`⚠️ Error al eliminar clave ${keyName}:`, deleteError.message);
                            }
                        }
                    }
                }

                console.log('✅ Keyring limpiado correctamente');
            } catch (cleanError) {
                console.error('⚠️ Error al limpiar el keyring:', cleanError.message);
            }

            // Importar la cuenta Shannon si se proporciona
            if (shannonSignature) {
                try {
                    // Limpiar espacios
                    let cleanSignature = shannonSignature.trim();

                    // Detectar si es una mnemónica (frase semilla)
                    const wordCount = cleanSignature.split(' ').length;
                    const isMnemonic = wordCount >= 12 && wordCount <= 24;

                    if (isMnemonic) {
                        console.log(`Detectada mnemónica Shannon (${wordCount} palabras)`);

                        try {
                            // Crear un archivo temporal con la mnemónica
                            const mnemonicFile = path.join(this.tempDir, `mnemonic-${sessionId}.txt`);
                            await fs.writeFile(mnemonicFile, cleanSignature);

                            // Usar el comando add con --recover y --source para importar desde archivo
                            const importCmd = `${process.cwd()}/bin/pocketd keys add ${shannonKeyName} --recover --source=${mnemonicFile} --home=${homeDir} --keyring-backend=${keyringBackend}`;

                            const { stdout, stderr } = await execAsync(importCmd, {
                                timeout: 30000,
                                env: {
                                    ...process.env,
                                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                }
                            });

                            // Eliminar el archivo temporal
                            await fs.unlink(mnemonicFile);

                            console.log(`✅ Clave Shannon importada desde mnemónica: ${stdout}`);
                        } catch (importError) {
                            // Verificar si el error es porque la clave ya existe
                            if (importError.stderr && importError.stderr.includes('duplicated address')) {
                                console.log(`✅ La clave Shannon ya existe en el keyring, continuando...`);
                            } else {
                                // Si es otro error, usamos alice como fallback
                                console.error('Error importing Shannon key:', importError.message);
                                if (importError.stderr) console.error('Error details:', importError.stderr);
                                useAliceForSigning = true;
                            }
                        }
                    } else {
                        // Quitar 0x si existe (para claves hex)
                        if (cleanSignature.startsWith('0x')) {
                            cleanSignature = cleanSignature.substring(2);
                        }

                        try {
                            // Importar la clave Shannon como hexadecimal
                            const importShannonCmd = `${process.cwd()}/bin/pocketd keys import-hex ${shannonKeyName} "${cleanSignature}" --home=${homeDir} --keyring-backend=${keyringBackend}`;
                            const { stdout, stderr } = await execAsync(importShannonCmd, {
                                timeout: 30000,
                                env: {
                                    ...process.env,
                                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                                }
                            });

                            console.log(`✅ Clave Shannon importada como hex: ${stdout}`);
                        } catch (importError) {
                            // Verificar si el error es porque la clave ya existe
                            if (importError.stderr && (importError.stderr.includes('duplicated address') || importError.stderr.includes('already exists'))) {
                                console.log(`✅ La clave Shannon ya existe en el keyring, continuando...`);
                            } else {
                                // Si es otro error, usamos alice como fallback
                                console.error('Error importing Shannon key:', importError.message);
                                if (importError.stderr) console.error('Error details:', importError.stderr);
                                useAliceForSigning = true;
                            }
                        }
                    }
                } catch (shannonImportError) {
                    console.error('Error importing Shannon key:', shannonImportError.message);
                    if (shannonImportError.stderr) console.error('Error details:', shannonImportError.stderr);
                    useAliceForSigning = true;
                }
            } else {
                // Si no hay firma Shannon, usamos alice (si existe)
                if (aliceExists) {
                    useAliceForSigning = true;
                } else {
                    throw new Error('No signing account available. Shannon signature not provided and alice account not available.');
                }
            }

            // Verificar que las claves se importaron correctamente
            try {
                const { stdout: keyInfo } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home=${homeDir} --keyring-backend=${keyringBackend}`, {
                    timeout: 10000,
                    env: {
                        ...process.env,
                        PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                    }
                });

                console.log('🔑 Available keys in keyring:');
                console.log(keyInfo);

                // Si la clave Shannon no está en la lista, usar alice si está disponible
                if (!keyInfo.includes(shannonKeyName)) {
                    console.log(`⚠️ Shannon key ${shannonKeyName} not found in keyring`);
                    if (aliceExists && keyInfo.includes('alice')) {
                        console.log(`✅ Using alice account for signing`);
                        useAliceForSigning = true;
                    } else {
                        throw new Error('No valid signing account found in keyring');
                    }
                }
            } catch (error) {
                console.error('Error listing keys:', error);
                if (aliceExists) {
                    console.log('⚠️ Using alice as fallback');
                    useAliceForSigning = true;
                } else {
                    throw new Error('No signing account available and keyring verification failed');
                }
            }

            // Determinar qué clave usar para firmar
            const signingKeyName = useAliceForSigning ? 'alice' : shannonKeyName;
            console.log(`🔑 Using ${signingKeyName} for signing the transaction`);

            // Configurar parámetros según la red
            let chainId, nodeUrl, net;
            if (network === 'mainnet') {
                net = 'main';
                chainId = 'pocket';
                nodeUrl = 'https://shannon-grove-rpc.mainnet.poktroll.com';
            } else {
                // Default: beta
                net = 'beta';
                chainId = 'pocket-beta';
                nodeUrl = 'https://rpc.shannon-testnet.eu.nodefleet.net';
            }

            console.log(`🌐 Using network: ${network}, chain-id: ${chainId}, node: ${nodeUrl}`);

            // Build the claim-account command - only takes armored key file as argument
            let command = `pocketd tx migration claim-account ${armoredKeyFile}` +
                ` --from=${signingKeyName}` +
                ` --network=${net}` +
                ` --home=${homeDir}` +
                ` --keyring-backend=${keyringBackend}` +
                ` --chain-id=${chainId}` +
                ` --gas=auto` +
                ` --gas-prices=1upokt` +
                ` --gas-adjustment=1.5` +
                ` --node=${nodeUrl}`;

            // Handle passphrase - use --no-passphrase if empty, otherwise provide passphrase
            if (!passphrase || passphrase.trim() === '') {
                command += ` --no-passphrase`;
            } else {
                command += ` --passphrase="${passphrase}"`;
            }

            command += ` --yes`;

            console.log(`⚡ Executing armored migration command...`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 120000, // 2 minutos de timeout
                env: {
                    ...process.env,
                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                }
            });

            console.log('📤 Command stdout:', stdout);
            if (stderr) console.log('⚠️ Command stderr:', stderr);

            // Parse the result from stdout
            try {
                // Check if command produced the expected output (morse info extracted)
                const morsePublicKeyMatch = stdout.match(/morse_public_key:\s*(.+)/);
                const morseSignatureMatch = stdout.match(/morse_signature:\s*(.+)/);
                const shannonDestMatch = stdout.match(/shannon_dest_address:\s*(.+)/);
                const shannonSigningMatch = stdout.match(/shannon_signing_address:\s*(.+)/);

                if (morsePublicKeyMatch && shannonDestMatch) {
                    // Successfully processed armored key file
                    const extractedInfo = {
                        morsePublicKey: morsePublicKeyMatch[1].trim(),
                        morseSignature: morseSignatureMatch ? morseSignatureMatch[1].trim() : null,
                        shannonDestAddress: shannonDestMatch[1].trim(),
                        shannonSigningAddress: shannonSigningMatch ? shannonSigningMatch[1].trim() : null
                    };

                    // Look for transaction hash in the output
                    const txHashMatch = stdout.match(/txhash:\s*([A-Fa-f0-9]+)/);
                    const txHash = txHashMatch ? txHashMatch[1] : null;

                    if (txHash) {
                        // Transaction was successful
                        return {
                            success: true,
                            txHash: txHash,
                            extractedInfo: extractedInfo,
                            output: stdout,
                            method: 'cli_claim_account',
                            network: network
                        };
                    } else {
                        // Armored key processed but transaction failed - determine specific error
                        let errorMessage = 'Armored key processed successfully, but transaction failed.';
                        let errorType = 'unknown';

                        // Check for specific error patterns
                        if (stderr.includes('has already been claimed')) {
                            // Parse the already claimed error for details
                            const alreadyClaimedMatch = stderr.match(/morse address "([^"]+)" has already been claimed at height (\d+) by shannon address "([^"]+)"/);
                            if (alreadyClaimedMatch) {
                                const [, morseAddr, height, shannonAddr] = alreadyClaimedMatch;
                                errorMessage = `This Morse account (${morseAddr}) has already been migrated to Shannon address ${shannonAddr} at block height ${height}. Each Morse account can only be migrated once.`;
                                errorType = 'already_claimed';
                            } else {
                                errorMessage = 'This Morse account has already been migrated to another Shannon address. Each Morse account can only be migrated once.';
                                errorType = 'already_claimed';
                            }
                        } else if (stderr.includes('account') && stderr.includes('not found')) {
                            errorMessage = 'Transaction failed because the signing account lacks funds or was not found on the network.';
                            errorType = 'account_not_found';
                        } else if (stderr.includes('insufficient funds') || stderr.includes('insufficient account funds')) {
                            errorMessage = 'Transaction failed due to insufficient funds in the signing account.';
                            errorType = 'insufficient_funds';
                        } else {
                            // Generic fallback
                            errorMessage = 'Armored key processed successfully, but transaction failed. This usually means the signing account lacks funds or the destination account is not found on the network.';
                            errorType = 'generic';
                        }

                        return {
                            success: false,
                            error: errorMessage,
                            errorType: errorType,
                            extractedInfo: extractedInfo,
                            output: stdout,
                            stderr: stderr,
                            method: 'cli_claim_account',
                            network: network
                        };
                    }
                } else {
                    // Command didn't produce expected output
                    return {
                        success: false,
                        error: 'Failed to extract information from armored key file',
                        output: stdout,
                        stderr: stderr,
                        method: 'cli_claim_account',
                        network: network
                    };
                }
            } catch (parseError) {
                console.error('Error parsing command output:', parseError);
                return {
                    success: false,
                    error: 'Failed to parse command output',
                    output: stdout,
                    stderr: stderr,
                    method: 'cli_claim_account',
                    network: network
                };
            }

        } catch (error) {
            console.error(`Armored migration command failed:`, error);

            if (error.stdout) console.log('Command stdout:', error.stdout);
            if (error.stderr) console.log('Command stderr:', error.stderr);

            return {
                success: false,
                error: error.message,
                details: error.toString(),
                method: 'cli_claim_account',
                network: network
            };
        }
    }

    /**
     * Método para compatibilidad - crear cuenta alice en el keyring
     */
    async ensureShannonAccountInKeyring(sessionId) {
        try {
            await this.ensureAliceAccount();
            console.log(`🔑 Using alice account for migration for session ${sessionId}`);
            return 'alice';
        } catch (error) {
            console.error('❌ Error ensuring account exists:', error);

            // Fallback para pruebas
            console.log('⚠️ Using fallback test-migration account for session', sessionId);
            return 'alice';
        }
    }

    /**
     * Método para compatibilidad
     */
    buildMigrationCommand(inputFile, outputFile, accountName, sessionId) {
        // IMPORTANTE: Este método ya no se usa directamente, pero lo mantenemos por compatibilidad
        // El error estaba aquí - este comando se estaba pasando como clave privada
        console.log('⚠️ DEPRECATED: buildMigrationCommand - Este método ya no se usa directamente');

        // Devolver null para evitar que se use este comando como clave privada
        return null;
    }

    /**
     * Método para compatibilidad
     */
    async executeCommand(command, timeout = 60000) {
        console.log(`⚡ Executing: ${command}`);
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout,
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                env: {
                    ...process.env,
                    PATH: `${process.env.PATH}:/usr/local/bin:/opt/bin:${process.cwd()}/bin`
                }
            });

            // Log both stdout and stderr for debugging
            if (stdout) console.log('📤 Command stdout:', stdout);
            if (stderr) console.log('⚠️ Command stderr:', stderr);

            return { stdout, stderr, error: null, method: 'cli_claim_accounts' };
        } catch (error) {
            console.error('❌ Command execution error:', error.message);
            console.error('❌ Command that failed:', command);

            if (error.stdout) console.log('📤 Error stdout:', error.stdout);
            if (error.stderr) console.log('⚠️ Error stderr:', error.stderr);

            // Mensaje de error detallado y amigable
            let friendlyError = error.message;

            if (error.stderr && error.stderr.includes('connection refused')) {
                friendlyError = 'No se pudo conectar al nodo Shannon. Verifique su conexión a internet o pruebe con otro nodo.';
            } else if (error.stderr && error.stderr.includes('no such host')) {
                friendlyError = 'El nombre del host del nodo Shannon no pudo ser resuelto. Verifique que el nombre del servidor sea correcto.';
            } else if (error.stderr && error.stderr.includes('not found')) {
                friendlyError = 'El comando pocket no fue encontrado. Verifique que la instalación sea correcta y la versión sea compatible.';
            }

            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                error: friendlyError,
                method: 'cli_claim_accounts',
                details: error.toString()
            };
        }
    }

    async parseOutputFile(outputFile) {
        try {
            if (!(await fs.pathExists(outputFile))) {
                throw new Error('Output file does not exist');
            }

            const content = await fs.readJson(outputFile);

            // Validate output structure
            if (!content.mappings || !Array.isArray(content.mappings)) {
                throw new Error('Invalid output format: missing mappings array');
            }

            console.log(`📊 Parsed ${content.mappings.length} migration mappings`);

            return content;

        } catch (error) {
            console.error('❌ Error parsing output file:', error);
            throw new Error(`Failed to parse migration results: ${error.message}`);
        }
    }

    async cleanup(sessionId) {
        try {
            // Remove input files (keep output for results)
            try {
                const inputFiles = await fs.readdir(this.inputDir);
                const sessionInputFiles = inputFiles.filter(file => file.includes(sessionId));

                for (const file of sessionInputFiles) {
                    const filePath = path.join(this.inputDir, file);
                    await fs.remove(filePath);
                    console.log(`🗑️ Cleaned up input: ${filePath}`);
                }
            } catch (error) {
                console.warn('⚠️ Could not clean input directory:', error.message);
            }

            // Remove temp files
            try {
                const tempFiles = await fs.readdir(this.tempDir);
                const sessionTempFiles = tempFiles.filter(file => file.includes(sessionId));

                for (const file of sessionTempFiles) {
                    const filePath = path.join(this.tempDir, file);
                    await fs.remove(filePath);
                    console.log(`🗑️ Cleaned up temp: ${filePath}`);
                }
            } catch (error) {
                console.warn('⚠️ Could not clean temp directory:', error.message);
            }

        } catch (error) {
            console.warn('⚠️ Cleanup warning:', error.message);
        }
    }

    async getMigrationStatus(sessionId) {
        try {
            const outputFile = path.join(this.outputDir, `migration-output-${sessionId}.json`);

            if (await fs.pathExists(outputFile)) {
                const result = await fs.readJson(outputFile);
                const stats = await fs.stat(outputFile);

                return {
                    sessionId,
                    status: 'completed',
                    result,
                    timestamp: stats.mtime.toISOString()
                };
            }

            return {
                sessionId,
                status: 'not_found',
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                sessionId,
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async checkPocketAvailability() {
        try {
            const pocketPath = '/usr/bin/pocketd';
            const { stdout } = await execAsync(`${pocketPath} version`, {
                timeout: 10000
            });

            return {
                available: true,
                version: stdout.trim(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                available: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Importa una clave privada al keyring usando pocket
     */
    async importPrivateKeyToKeyring(privateKeyHex, name) {
        try {
            console.log(`🔑 Importing private key to keyring for: ${name}`);

            // Extraer la dirección ETH original si es un JSON de wallet
            let ethAddress = null;
            let cleanPrivateKey = privateKeyHex;

            if (typeof privateKeyHex === 'string' && privateKeyHex.trim().startsWith('{')) {
                try {
                    const walletData = JSON.parse(privateKeyHex);
                    if (walletData.addr) {
                        ethAddress = walletData.addr;
                        console.log(`📋 Found original ETH address: ${ethAddress}`);
                    }
                    if (walletData.priv) {
                        cleanPrivateKey = walletData.priv;
                        console.log(`📋 Using private key from wallet JSON`);
                    }
                } catch (e) {
                    console.log('📋 Not a valid JSON wallet format:', e.message);
                }
            }

            // Limpiar el hex (remover 0x si está presente)
            let cleanHex = cleanPrivateKey.trim().startsWith('0x')
                ? cleanPrivateKey.trim().substring(2)
                : cleanPrivateKey.trim();

            console.log(`📍 Using private key with length: ${cleanHex.length}`);

            // Usar la ruta correcta a pocketd
            const pocketdPath = `${process.cwd()}/bin/pocketd`;

            // Importar la clave con el formato simplificado
            const importCmd = `${pocketdPath} keys import-hex ${name} ${cleanHex} --keyring-backend test`;
            await execAsync(importCmd, {
                timeout: 30000
            });

            // Obtener la dirección usando list
            const { stdout } = await execAsync(
                `${pocketdPath} keys list --keyring-backend test`,
                {
                    timeout: 10000
                }
            );

            // Extraer la dirección del output que corresponde a nuestra clave
            let poktAddress = null;
            const lines = stdout.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`name: ${name}`)) {
                    // Buscar la línea de dirección anterior
                    if (i > 0 && lines[i - 1].includes('address:')) {
                        const addressLine = lines[i - 1].trim();
                        poktAddress = addressLine.replace('- address:', '').trim();
                        break;
                    }
                }
            }

            return {
                success: true,
                poktAddress: poktAddress,
                ethAddress: ethAddress,
                originalWallet: ethAddress ? true : false
            };
        } catch (error) {
            console.error('❌ Failed to import key to keyring:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = MigrationExecutor; 