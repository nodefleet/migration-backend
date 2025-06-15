const fs = require('fs').promises;
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
     */
    async executeMigration(migrationData, options = {}) {
        const sessionId = uuidv4();
        console.log(`🚀 Starting migration session: ${sessionId}`);

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

            console.log(`🎯 Starting CLI migration with claim-accounts...`);

            // Execute migration command with the FULL list of Morse private keys
            const result = await this.runMigrationCommand(
                migrationData.morsePrivateKeys,
                migrationData.shannonAddress?.address || migrationData.signingAccount,
                migrationData.shannonAddress?.signature,
                sessionId
            );

            console.log(`✅ Migration session completed: ${sessionId}`);
            return {
                success: true,
                sessionId,
                result,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Migration session failed: ${sessionId}`, error);

            // Clean up on error
            await this.cleanup(sessionId);

            throw {
                success: false,
                sessionId,
                error: error.message,
                timestamp: new Date().toISOString()
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
                    timeout: 10000
                });

                // Si ya existe alice, no hacer nada
                if (stdout.includes('alice')) {
                    return true;
                }
            } catch (e) {
                console.log('⚠️ Error listing keys, will try to create alice anyway');
            }

            // Crear la cuenta alice para fines de generar la transacción
            await execAsync(`${process.cwd()}/bin/pocketd keys add alice --home ${homeDir} --keyring-backend test`, {
                timeout: 15000
            });

            console.log('✅ Alice account created successfully');

            // Verificar que se creó
            const { stdout } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home ${homeDir} --keyring-backend test`, {
                timeout: 10000
            });

            if (stdout.includes('alice')) {
                console.log('✅ Verified alice account exists');
                return true;
            } else {
                throw new Error('Alice account could not be verified after creation');
            }
        } catch (error) {
            if (error.stderr && error.stderr.includes('already exists')) {
                console.log('✅ Alice account already exists (caught from error)');
                return true;
            }
            console.error('❌ Error checking/creating alice account:', error);
            throw new Error(`Failed to create alice account: ${error.message}`);
        }
    }

    /**
     * Run the CLI claim-accounts command with ALL Morse private keys.
     * @param {string[]} morsePrivateKeys – array of Morse private keys / wallet JSONs
     * @param {string} shannonAddress – Shannon destination address
     * @param {string} shannonSignature – Hex signature of Shannon private key (optional)
     * @param {string} sessionId – unique identifier for this session
     */
    async runMigrationCommand(morsePrivateKeys, shannonAddress, shannonSignature, sessionId) {
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

            const shannonKeyName = `shannon-${sessionId.substring(0, 8)}`;

            // Generar un nombre aleatorio para el keyring-backend
            const keyringBackend = `test`;

            // Crear un directorio específico para este keyring
            const keyringDir = path.join(homeDir, `keyring-${keyringBackend}`);
            if (!require('fs').existsSync(keyringDir)) {
                require('fs').mkdirSync(keyringDir, { recursive: true });
            }

            // IMPORTAR LA CUENTA SHANNON
            if (shannonSignature) {
                try {
                    // Limpiar el hexadecimal (quitar 0x si existe)
                    let cleanSignature = shannonSignature.trim();
                    if (cleanSignature.startsWith('0x')) {
                        cleanSignature = cleanSignature.substring(2);
                    }

                    // Importar la clave Shannon directamente como hexadecimal
                    const importShannonCmd = `${process.cwd()}/bin/pocketd keys import-hex ${shannonKeyName} "${cleanSignature}" --home=${homeDir} --keyring-backend=${keyringBackend}`;
                    const { stdout: shannonImportOutput, stderr: shannonImportError } = await execAsync(importShannonCmd, {
                        timeout: 30000,
                        env: {
                            ...process.env,
                            PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                        }
                    });
                } catch (shannonImportError) {
                    console.error('Error importing Shannon key:', shannonImportError.message);
                }
            }

            // Verificar que las claves se importaron correctamente
            const { stdout: keyInfo } = await execAsync(`${process.cwd()}/bin/pocketd keys list --home=${homeDir} --keyring-backend=${keyringBackend}`, {
                timeout: 10000,
                env: {
                    ...process.env,
                    PATH: `${process.env.PATH}:${process.cwd()}/bin:/usr/local/bin`
                }
            });
            // Definir archivo de salida
            const outputFilePath = path.resolve(path.join(this.outputDir, `migration-output-${sessionId}.json`));

            // El comando de migración exactamente como lo usó jorgecuesta
            const command = `pocketd tx migration claim-accounts` +
                ` --input-file=${inputFilePath}` +
                ` --output-file=${outputFilePath}` +
                ` --home=${homeDir}` +
                ` --keyring-backend=${keyringBackend}` +
                ` --from=${shannonKeyName}` +
                ` --unsafe --unarmored-json` +
                ` --network=main` +
                ` --chain-id=pocket` +
                ` --gas=auto` +
                ` --gas-adjustment=1.1` +
                ` --gas-prices=0.001upokt` +
                ` --node=https://shannon-grove-rpc.mainnet.poktroll.com` +
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
                            method: 'cli_claim_accounts'
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

                throw new Error(`Migration command failed: ${cmdError.message}`);
            }
        } catch (error) {
            console.error(`CLI migration failed:`, error);

            return {
                success: false,
                error: error.message,
                details: error.toString(),
                method: 'cli_claim_accounts'
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

            // Detectar si es un JSON de wallet Morse
            let actualPrivateKey = privateKeyHex;
            let walletName = name;

            if (typeof privateKeyHex === 'string' && privateKeyHex.trim().startsWith('{')) {
                try {
                    const morseWallet = JSON.parse(privateKeyHex);
                    console.log(`📋 Detected Morse wallet JSON format for: ${morseWallet.name || 'Unknown'}`);

                    // Usar SOLO el private key del JSON
                    if (morseWallet.priv) {
                        actualPrivateKey = morseWallet.priv;
                    } else {
                        throw new Error('Missing private key field (priv) in Morse wallet JSON');
                    }

                    // Crear un nombre seguro para el keyring (sin caracteres especiales)
                    walletName = name || `wallet${Date.now()}`;
                    console.log(`📋 Using safe wallet name: ${walletName}`);
                } catch (e) {
                    console.log('📋 Not a JSON format, using as raw private key:', e.message);
                }
            }

            // Limpiar el hex (remover 0x si está presente)
            let cleanHex = actualPrivateKey.trim().startsWith('0x')
                ? actualPrivateKey.trim().substring(2)
                : actualPrivateKey.trim();

            console.log(`📍 Using private key with length: ${cleanHex.length}`);

            // Validar formato de clave privada
            if (!/^[0-9a-fA-F]{64,128}$/.test(cleanHex)) {
                throw new Error(`Invalid private key format. Expected 64 or 128 hex characters, got ${cleanHex.length}`);
            }

            // Determinar el directorio home para pocketd
            let homeDir = './localnet/pocketd';
            try {
                await fs.access(homeDir);
                console.log(`✅ Using existing home directory: ${homeDir}`);
            } catch {
                // Si no existe, usar un directorio temporal
                homeDir = path.join(this.tempDir, 'pocketd-home');
                await fs.mkdir(homeDir, { recursive: true });
                console.log(`📁 Created temporary home directory: ${homeDir}`);
            }

            // Eliminar la clave si ya existe para evitar errores
            try {
                console.log(`🗑️ Removing existing key if present: ${walletName}`);
                await execAsync(`/usr/bin/pocketd keys delete ${walletName} --home ${homeDir} --keyring-backend test --yes`, {
                    timeout: 10000
                });
            } catch (e) {
                // Ignorar errores al eliminar
            }

            // Importar usando el comando import-hex que es para claves hexadecimales
            // SOLO mostrar parte de la clave por seguridad en logs
            console.log(`🔑 Executing import-hex command: /usr/bin/pocketd keys import-hex ${walletName} ${cleanHex.substring(0, 10)}... --home ${homeDir} --keyring-backend test`);

            // IMPORTANTE: Usar comillas para evitar problemas con caracteres especiales
            const importCmd = `/usr/bin/pocketd keys import-hex ${walletName} "${cleanHex}" --home=${homeDir} --keyring-backend=test`;

            try {
                const { stdout, stderr } = await execAsync(importCmd, {
                    timeout: 30000
                });
                console.log('📋 Import result:', { stdout, stderr });

                if (stderr && !stderr.includes('successfully')) {
                    console.warn(`⚠️ Import warning: ${stderr}`);
                }
            } catch (importError) {
                console.error('❌ Import error:', importError.message);
                if (importError.stdout) console.log('📋 Import stdout:', importError.stdout);
                if (importError.stderr) console.log('📋 Import stderr:', importError.stderr);

                // Solo fallar si no contiene "already exists"
                if (importError.stderr &&
                    !(importError.stderr.includes('already exists') ||
                        importError.stderr.includes('already imported'))) {
                    throw new Error(`Import failed: ${importError.message}`);
                } else {
                    console.log('✅ Key already exists, continuing...');
                }
            }

            // Verificar que la clave está en el keyring
            try {
                const { stdout } = await execAsync(`/usr/bin/pocketd keys show ${walletName} --home ${homeDir} --keyring-backend test`, {
                    timeout: 10000
                });
                console.log('✅ Key successfully imported and verified:', stdout);
            } catch (verifyError) {
                console.error('❌ Key verification error:', verifyError.message);
                throw new Error('Key could not be verified after import');
            }

            // Guardar el directorio home para uso posterior
            this.homeDir = homeDir;
            return true;

        } catch (error) {
            console.error('❌ Failed to import key to keyring:', error);
            throw new Error(`Key import failed: ${error.message}`);
        }
    }
}

module.exports = MigrationExecutor; 