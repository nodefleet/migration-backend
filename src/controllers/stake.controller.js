const Joi = require('joi');
const StakeExecutor = require('../services/stake-executor');

const stakeExecutor = new StakeExecutor();

// Validation schema for stake request
const stakeRequestSchema = Joi.object({
    ownerAddress: Joi.string()
        .pattern(/^(pokt|poktval)[0-9a-zA-Z]{39,43}$/)
        .required()
        .messages({
            'string.pattern.base': 'Owner address must start with "pokt" or "poktval" and have correct length',
            'any.required': 'Owner address is required'
        }),
    numberOfNodes: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .required()
        .messages({
            'number.base': 'Number of nodes must be a number',
            'number.integer': 'Number of nodes must be an integer',
            'number.min': 'Number of nodes must be at least 1',
            'number.max': 'Number of nodes cannot exceed 100',
            'any.required': 'Number of nodes is required'
        })
});

/**
 * Validate stake request data
 * @param {Object} data - Request data to validate
 * @returns {Object} - Validation result
 */
const validateStakeRequest = (data) => {
    const { error, value } = stakeRequestSchema.validate(data);
    
    if (error) {
        return {
            valid: false,
            error: 'Validation failed',
            details: error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value
            }))
        };
    }
    
    return {
        valid: true,
        data: value
    };
};

/**
 * Execute stake process
 * @param {Object} stakeData - Validated stake data
 * @returns {Promise<Object>} - Stake execution result
 */
const executeStake = async (stakeData) => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Execute the stake process
        const result = await stakeExecutor.executeStake(stakeData);
        return result;
    } catch (error) {
        console.error('Stake execution error:', error);
        throw error;
    }
};

/**
 * Execute stake transactions for a session
 * @param {string} sessionId - Session ID to execute stakes for
 * @param {string} network - Network to stake on (default: main)
 * @param {string} passphrase - Passphrase for the keys (default: empty)
 * @param {string} ownerKeyName - Name of the owner's key (optional)
 * @param {string} ownerHomeDir - Home directory for the owner's key (optional)
 * @param {string} keyringBackend - Keyring backend to use (default: from config)
 * @returns {Promise<Object>} - Stake execution result
 */
const executeStakeTransactions = async (sessionId, network = 'main', passphrase = '', ownerKeyName = null, ownerHomeDir = null, keyringBackend = null) => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Execute the stake transactions
        const result = await stakeExecutor.executeStakeTransactions(sessionId, network, passphrase, ownerKeyName, ownerHomeDir, keyringBackend);
        return result;
    } catch (error) {
        console.error('Stake transaction execution error:', error);
        throw error;
    }
};

/**
 * Execute stake transactions with imported owner key
 * @param {string} sessionId - Session ID to execute stakes for
 * @param {string} network - Network to stake on (default: main)
 * @param {string} ownerPrivateKey - Owner's private key in hex format
 * @param {string} ownerKeyName - Name for the owner's key in keyring (default: owner)
 * @param {string} homeDir - Home directory for the keyring (default: from config)
 * @param {string} keyringBackend - Keyring backend to use (default: memory)
 * @returns {Promise<Object>} - Stake execution result
 */
const executeStakeTransactionsWithImportedKey = async (sessionId, network = 'main', ownerPrivateKey, ownerKeyName = 'owner', homeDir = null, keyringBackend = 'memory') => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Validate owner private key
        if (!ownerPrivateKey || typeof ownerPrivateKey !== 'string') {
            throw new Error('Valid owner private key is required');
        }

        // Execute the stake transactions with imported key
        const result = await stakeExecutor.executeStakeTransactionsWithImportedKey(sessionId, network, ownerPrivateKey, ownerKeyName, homeDir, keyringBackend);
        return result;
    } catch (error) {
        console.error('Stake transaction execution with imported key error:', error);
        throw error;
    }
};

/**
 * Execute stake transactions using mnemonic recovery
 * @param {Array} stakeFiles - Array of stake file objects with content and metadata
 * @param {string} mnemonic - Mnemonic phrase for wallet recovery
 * @param {string} keyName - Name for the key in memory keyring (default: owner)
 * @param {string} network - Network to stake on (default: main)
 * @param {string} homeDir - Home directory for the keyring (default: from config)
 * @param {string} keyringBackend - Keyring backend to use (default: from config)
 * @returns {Promise<Object>} - Stake execution result
 */
const executeStakeTransactionsWithMnemonic = async (stakeFiles, mnemonic, keyName = 'owner', network = 'main', homeDir = null, keyringBackend = null) => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Validate mnemonic
        if (!mnemonic || typeof mnemonic !== 'string') {
            throw new Error('Valid mnemonic phrase is required');
        }

        // Validate stake files
        if (!stakeFiles || !Array.isArray(stakeFiles) || stakeFiles.length === 0) {
            throw new Error('At least one stake file is required');
        }

        // Validate each stake file has content
        for (let i = 0; i < stakeFiles.length; i++) {
            const stakeFile = stakeFiles[i];
            if (!stakeFile.content || typeof stakeFile.content !== 'string') {
                throw new Error(`Stake file ${i + 1} must have valid content`);
            }
        }

        // Execute the stake transactions with mnemonic
        const result = await stakeExecutor.executeMultipleStakesWithMnemonic(stakeFiles, mnemonic, keyName, network, homeDir, keyringBackend);
        return result;
    } catch (error) {
        console.error('Stake transaction execution with mnemonic error:', error);
        throw error;
    }
};

/**
 * Generate unsigned stake transactions for a session
 * @param {string} sessionId - Session ID to generate transactions for
 * @param {string} network - Network to stake on (default: main)
 * @param {string} ownerAddress - Owner address to use for signing
 * @returns {Promise<Object>} - Unsigned transactions result
 */
const generateUnsignedStakeTransactions = async (sessionId, network = 'main', ownerAddress) => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Validate owner address
        if (!ownerAddress || !ownerAddress.startsWith('pokt')) {
            throw new Error('Valid owner address is required');
        }

        // Generate unsigned transactions
        const result = await stakeExecutor.generateUnsignedStakeTransactions(sessionId, network, ownerAddress);
        return result;
    } catch (error) {
        console.error('Unsigned transaction generation error:', error);
        throw error;
    }
};

/**
 * Generate unsigned stake transactions for CLI method
 * @param {string} sessionId - Session ID to generate transactions for
 * @param {string} network - Network to stake on (default: main)
 * @param {string} ownerAddress - Owner address to use for signing
 * @param {string} keyringBackend - Keyring backend to use (default: memory)
 * @returns {Promise<Object>} - Unsigned transactions result for CLI
 */
const generateUnsignedTransactionsForCLI = async (sessionId, network = 'main', ownerAddress, keyringBackend = 'memory') => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Validate owner address
        if (!ownerAddress || !ownerAddress.startsWith('pokt')) {
            throw new Error('Valid owner address is required');
        }

        // Generate unsigned transactions for CLI method
        const result = await stakeExecutor.generateUnsignedTransactionsForCLI(sessionId, network, ownerAddress, keyringBackend);
        return result;
    } catch (error) {
        console.error('Unsigned transaction generation for CLI error:', error);
        throw error;
    }
};

/**
 * Get stake session status
 * @param {string} sessionId - Session ID to check
 * @returns {Promise<Object>} - Session status
 */
const getStakeSessionStatus = async (sessionId) => {
    try {
        const fs = require('fs-extra');
        const path = require('path');
        const config = require('../config/config');
        
        const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
        
        // Check if session directory exists
        const sessionExists = await fs.pathExists(sessionDir);
        if (!sessionExists) {
            return {
                success: false,
                error: 'Session not found',
                sessionId
            };
        }

        // Get session information
        const walletsDir = path.join(sessionDir, 'wallets');
        const stakeFilesDir = path.join(sessionDir, 'stake_files');
        
        const walletsExist = await fs.pathExists(walletsDir);
        const stakeFilesExist = await fs.pathExists(stakeFilesDir);
        
        let walletCount = 0;
        let stakeFileCount = 0;
        
        if (walletsExist) {
            const walletDirs = await fs.readdir(walletsDir);
            walletCount = walletDirs.filter(dir => 
                fs.statSync(path.join(walletsDir, dir)).isDirectory()
            ).length;
        }
        
        if (stakeFilesExist) {
            const files = await fs.readdir(stakeFilesDir);
            stakeFileCount = files.filter(file => file.endsWith('.yaml')).length;
        }

        return {
            success: true,
            sessionId,
            status: 'completed',
            data: {
                walletsCreated: walletCount,
                stakeFilesGenerated: stakeFileCount,
                sessionDirectory: sessionDir
            },
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error getting stake session status:', error);
        throw error;
    }
};

/**
 * Create node wallet and stake it using owner mnemonic
 * @param {string} ownerMnemonic - Owner's mnemonic phrase for signing
 * @param {string} ownerAddress - Owner's address (who has the funds)
 * @param {string} network - Network to stake on (default: main)
 * @param {string} keyName - Name for the owner's key in keyring (default: owner)
 * @param {string} homeDir - Home directory for the keyring (default: from config)
 * @param {string} keyringBackend - Keyring backend to use (default: from config)
 * @returns {Promise<Object>} - Stake execution result with node mnemonic
 */
const createNodeAndStake = async (ownerMnemonic, ownerAddress, network = 'main', keyName = 'owner', homeDir = null, keyringBackend = null) => {
    try {
        // Validate pocketd availability first
        const pocketdAvailable = await stakeExecutor.validatePocketd();
        if (!pocketdAvailable) {
            throw new Error('Pocketd CLI is not available. Please ensure pocketd is installed and accessible.');
        }

        // Validate owner mnemonic
        if (!ownerMnemonic || typeof ownerMnemonic !== 'string') {
            throw new Error('Valid owner mnemonic phrase is required');
        }

        // Validate owner address
        if (!ownerAddress || !ownerAddress.startsWith('pokt')) {
            throw new Error('Valid owner address is required');
        }

        // Execute the create node and stake process
        const result = await stakeExecutor.createNodeAndStake(ownerMnemonic, ownerAddress, network, keyName, homeDir, keyringBackend);
        return result;
    } catch (error) {
        console.error('Create node and stake error:', error);
        throw error;
    }
};

module.exports = {
    validateStakeRequest,
    executeStake,
    executeStakeTransactions,
    executeStakeTransactionsWithImportedKey,
    executeStakeTransactionsWithMnemonic,
    generateUnsignedStakeTransactions,
    generateUnsignedTransactionsForCLI,
    getStakeSessionStatus,
    createNodeAndStake
}; 