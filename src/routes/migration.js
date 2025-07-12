const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const MigrationExecutor = require('../services/migration-executor');
const migrationController = require('../controllers/migration.controller');

const router = express.Router();
const migrationExecutor = new MigrationExecutor();

// Esquema de validación para migración CLI real
const migrationSchema = Joi.object({
    morseWallets: Joi.array()
        .items(Joi.string())
        .required()
        .messages({
            'any.required': 'Morse wallets array is required'
        }),
    shannonAddress: Joi.alternatives().try(
        Joi.string()
            .pattern(/^(pokt|poktval)[0-9a-zA-Z]{39,43}$/)
            .messages({
                'string.pattern.base': 'Shannon address must start with "pokt" or "poktval" and have correct length'
            }),
        Joi.object({
            address: Joi.string()
                .pattern(/^(pokt|poktval)[0-9a-zA-Z]{39,43}$/)
                .required()
                .messages({
                    'string.pattern.base': 'Shannon address must start with "pokt" or "poktval" and have correct length'
                }),
            signature: Joi.string().required()
        })
    ).required().messages({
        'any.required': 'Shannon address is required'
    })
});

/**
 * POST /migrate - Ejecutar migración usando CLI claim-accounts REAL
 */
router.post('/migrate', async (req, res) => {
    try {
        const { morseWallets, shannonAddress, network } = req.body;

        if (!morseWallets || !Array.isArray(morseWallets) || morseWallets.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'morseWallets debe ser un array no vacío'
            });
        }

        // Verificar formato de shannonAddress (objeto o string)
        let shannonAddressValue;
        let shannonSignature;

        if (typeof shannonAddress === 'object' && shannonAddress !== null) {
            shannonAddressValue = shannonAddress.address;
            shannonSignature = shannonAddress.signature;
        } else {
            shannonAddressValue = shannonAddress;
        }

        if (!shannonAddressValue || typeof shannonAddressValue !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid shannonAddress in request body'
            });
        }

        // Validar formato de dirección Shannon
        if (!shannonAddressValue.startsWith('pokt')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Shannon address format. Must start with "pokt"'
            });
        }

        // Validar el parámetro network si está presente
        let networkValue = 'beta'; // Valor por defecto
        if (network) {
            if (typeof network !== 'string' || !['beta', 'mainnet'].includes(network)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid network parameter. Must be "beta" or "mainnet"'
                });
            }
            networkValue = network;
        }

        // Preparar datos para el ejecutor
        const migrationData = {
            morsePrivateKeys: morseWallets,
            signingAccount: shannonAddressValue,
            shannonAddress: {
                address: shannonAddressValue,
                signature: shannonSignature
            }
        };

        console.log(`🌐 Migration requested on network: ${networkValue}`);

        // Ejecutar migración con el parámetro network
        const result = await migrationExecutor.executeMigration(migrationData, { network: networkValue });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Unknown error',
            details: error.toString()
        });
    }
});

/**
 * GET /health - Verificar estado del servicio y CLI
 */
router.get('/health', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const pocketdPath = `${process.cwd()}/bin/pocketd`;
        const { stdout } = await execAsync(`${pocketdPath} version`, {
            timeout: 5000
        });
        const version = stdout.trim();

        res.status(200).json({
            success: true,
            message: 'Migration backend is healthy',
            status: 'operational',
            cli: {
                version: version,
                available: true,
                command: 'claim-accounts',
                method: 'cli_real'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            message: 'Service unavailable',
            status: 'degraded',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /validate - Validar datos de migración sin ejecutar
 */
router.post('/validate', async (req, res) => {
    try {
        const { error, value } = migrationSchema.validate(req.body);

        if (error) {
            return res.status(400).json({
                success: false,
                valid: false,
                error: 'Validation failed',
                details: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value
                }))
            });
        }

        const { morseWallets, shannonAddress } = value;

        res.status(200).json({
            success: true,
            valid: true,
            message: 'Migration data is valid for CLI execution',
            data: {
                morseWalletsCount: morseWallets.length,
                shannonAddress: shannonAddress,
                method: 'cli_claim_accounts',
                readyForMigration: true
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            valid: false,
            error: 'Internal validation error',
            details: error.message
        });
    }
});

/**
 * POST /import-wallets - Importar wallets y obtener sus direcciones
 */
router.post('/import-wallets', async (req, res) => {
    await migrationController.importWallets(req, res);
});

// Middleware de manejo de errores
router.use((error, req, res, next) => {
    console.error('Router error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal router error',
        details: error.message
    });
});

module.exports = router; 