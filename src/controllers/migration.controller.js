const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const MigrationExecutor = require('../services/migration-executor');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class MigrationController {
    constructor() {
        this.migrationExecutor = new MigrationExecutor();
    }

    async executeMigration(req, res) {
        try {
            const { morsePrivateKey, shannonAddress } = req.body;
            const sessionId = uuidv4();

            console.log(`🆔 Generated session ID: ${sessionId}`);

            // Validar los datos
            if (!morsePrivateKey || !shannonAddress) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    session: sessionId
                });
            }

            console.log('✅ Request validated successfully');

            // Información de depuración limitada para privacidad
            console.log(`📍 Morse Private Key preview: ${typeof morsePrivateKey === 'string' ? morsePrivateKey.substring(0, 10) + '...' : 'Invalid format'}`);
            console.log(`📍 Shannon Address: ${shannonAddress}`);

            // Iniciar la migración usando el comando CLI
            console.log('🎯 Starting CLI migration with claim-accounts...');

            // Crear el archivo temporal de entrada para la migración
            const inputDir = path.join(__dirname, '../../data/input');
            const outputDir = path.join(__dirname, '../../data/output');

            // Asegurarse de que los directorios existen
            await fs.mkdir(inputDir, { recursive: true });
            await fs.mkdir(outputDir, { recursive: true });

            // Generar nombres de archivos únicos para esta migración
            const inputFile = path.join(inputDir, `migration-input-${sessionId}.json`);
            const outputFile = path.join(outputDir, `migration-output-${sessionId}.json`);

            // Guardar la clave privada en el archivo de entrada
            // El comando espera un array con la clave o wallet
            const inputData = [morsePrivateKey];
            await fs.writeFile(inputFile, JSON.stringify(inputData, null, 2), 'utf8');

            // Construir y ejecutar el comando de migración
            const executor = new MigrationExecutor();

            // Crear el comando de migración correctamente
            const migrationCommand = executor.buildMigrationCommand(inputFile, outputFile, sessionId);

            try {
                // Ejecutar el comando construido, no la clave privada directamente
                const result = await executor.runMigrationCommand(migrationCommand, sessionId);
                return res.status(200).json({
                    success: true,
                    data: result,
                    sessionId
                });
            } catch (migrationError) {
                console.error('❌ Migration error:', migrationError);
                return res.status(500).json({
                    success: false,
                    error: migrationError.error || 'Migration failed',
                    details: migrationError.details || migrationError.message,
                    sessionId
                });
            }
        } catch (error) {
            console.error('❌ Unexpected error in /migrate:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error',
                details: error.message,
                sessionId: req.body.sessionId || 'unknown'
            });
        }
    }

    async importWallets(req, res) {
        try {
            const { wallets } = req.body;
            const sessionId = uuidv4();

            if (!Array.isArray(wallets) || wallets.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Se requiere un array de wallets no vacío',
                    session: sessionId
                });
            }

            console.log(`🔑 Procesando ${wallets.length} wallets para importación`);

            const importResults = [];
            for (const wallet of wallets) {
                try {
                    // Usar el método de importación del MigrationExecutor
                    const walletName = `wallet-${uuidv4().substring(0, 8)}`;
                    const result = await this.migrationExecutor.importPrivateKeyToKeyring(wallet, walletName);

                    if (result.success) {
                        importResults.push({
                            wallet: wallet.substring(0, 10) + '...', // Solo mostramos parte del wallet por seguridad
                            success: true,
                            poktAddress: result.poktAddress,
                            ethAddress: result.ethAddress,
                            originalWallet: result.originalWallet,
                            name: walletName
                        });
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    console.error('❌ Error importando wallet:', error);
                    importResults.push({
                        wallet: wallet.substring(0, 10) + '...',
                        success: false,
                        error: error.message
                    });
                }
            }

            return res.status(200).json({
                success: true,
                data: {
                    sessionId,
                    results: importResults
                }
            });

        } catch (error) {
            console.error('❌ Error en importación de wallets:', error);
            return res.status(500).json({
                success: false,
                error: 'Error interno del servidor',
                details: error.message,
                sessionId: uuidv4()
            });
        }
    }
}

module.exports = new MigrationController(); 