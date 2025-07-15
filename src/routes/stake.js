const express = require('express');
const stakeController = require('../controllers/stake.controller');
const fs = require('fs-extra');
const path = require('path'); // Added for path.join

const router = express.Router();

/**
 * POST /create - Create wallets and generate stake files
 */
router.post('/create', async (req, res) => {
    try {
        console.log('🔍 === POST /create CALLED ===');
        console.log('📥 Request body received:', JSON.stringify(req.body, null, 2));
        console.log('📋 Request headers:', JSON.stringify(req.headers, null, 2));
        
        const { ownerAddress, numberOfNodes } = req.body;

        console.log('🔍 Extracted parameters:');
        console.log('  - ownerAddress:', ownerAddress);
        console.log('  - numberOfNodes:', numberOfNodes);

        // Validate request data
        const validation = stakeController.validateStakeRequest({ ownerAddress, numberOfNodes });
        
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validation.details
            });
        }

        console.log(`🚀 Stake creation requested for ${numberOfNodes} nodes by ${ownerAddress}`);

        // Execute stake process
        const result = await stakeController.executeStake(validation.data);

        console.log(`✅ Stake creation completed for session: ${result.sessionId}`);
        console.log(`📊 Created ${result.data.wallets.length} wallets with real mnemonics`);
        console.log(`💾 Mnemonics stored and ready for frontend`);

        res.json({
            success: true,
            message: `Successfully created ${numberOfNodes} wallets with real mnemonics and stake files`,
            sessionId: result.sessionId,
            data: result.data,
            mnemonicsInfo: {
                available: true,
                count: result.data.wallets.length,
                storedSecurely: true,
                downloadable: true,
                note: 'Real mnemonics are included in this response and stored securely'
            }
        });

    } catch (error) {
        console.error('Stake creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Stake creation failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /validate - Validate stake request data without executing
 */
router.post('/validate', async (req, res) => {
    try {
        const { ownerAddress, numberOfNodes } = req.body;

        // Validate request data
        const validation = stakeController.validateStakeRequest({ ownerAddress, numberOfNodes });
        
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                valid: false,
                error: 'Validation failed',
                details: validation.details
            });
        }

        // Check pocketd availability
        const StakeExecutor = require('../services/stake-executor');
        const stakeExecutor = new StakeExecutor();
        const pocketdAvailable = await stakeExecutor.validatePocketd();

        res.status(200).json({
            success: true,
            valid: true,
            message: 'Stake request data is valid',
            data: {
                ownerAddress: validation.data.ownerAddress,
                numberOfNodes: validation.data.numberOfNodes,
                pocketdAvailable,
                stakeAmount: '60005000000upokt',
                readyForStake: pocketdAvailable
            }
        });

    } catch (error) {
        console.error('Stake validation error:', error);
        res.status(500).json({
            success: false,
            valid: false,
            error: 'Validation failed',
            message: error.message || 'Unknown error occurred'
        });
    }
});

/**
 * POST /execute/:sessionId - Execute stake transactions for a session
 */
router.post('/execute/:sessionId', async (req, res) => {
    try {
        console.log('🔍 === POST /execute/:sessionId CALLED ===');
        console.log('📥 Request params:', JSON.stringify(req.params, null, 2));
        console.log('📥 Request body received:', JSON.stringify(req.body, null, 2));
        console.log('📋 Request headers:', JSON.stringify(req.headers, null, 2));
        
        const { sessionId } = req.params;
        const { network = 'main', passphrase = '', ownerKeyName = null, ownerHomeDir = null, keyringBackend = null } = req.body;

        console.log('🔍 Extracted parameters:');
        console.log('  - sessionId:', sessionId);
        console.log('  - network:', network);
        console.log('  - passphrase:', passphrase ? '[PROVIDED]' : '[EMPTY]');
        console.log('  - ownerKeyName:', ownerKeyName);
        console.log('  - ownerHomeDir:', ownerHomeDir);
        console.log('  - keyringBackend:', keyringBackend);

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        // Validate keyring backend parameter
        if (keyringBackend && !['os', 'file', 'kwallet', 'pass', 'test', 'memory'].includes(keyringBackend)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid keyring backend parameter. Must be "os", "file", "kwallet", "pass", "test", or "memory"'
            });
        }

        console.log(`🚀 Stake execution requested for session: ${sessionId}`);
        console.log(`🌐 Network: ${network}`);
        console.log(`🔑 Keyring backend: ${keyringBackend || 'default'}`);
        if (ownerKeyName) {
            console.log(`🔑 Owner key: ${ownerKeyName}`);
        }

        // Execute stake transactions
        const result = await stakeController.executeStakeTransactions(sessionId, network, passphrase, ownerKeyName, ownerHomeDir, keyringBackend);

        res.json({
            success: true,
            message: `Stake transactions completed for session ${sessionId}`,
            data: result
        });

    } catch (error) {
        console.error('Stake execution error:', error);
        res.status(500).json({
            success: false,
            error: 'Stake execution failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /execute-with-key/:sessionId - Execute stake transactions with imported owner key
 */
router.post('/execute-with-key/:sessionId', async (req, res) => {
    try {
        console.log('🔍 === POST /execute-with-key/:sessionId CALLED ===');
        console.log('📥 Request params:', JSON.stringify(req.params, null, 2));
        console.log('📥 Request body received:', JSON.stringify(req.body, null, 2));
        console.log('📋 Request headers:', JSON.stringify(req.headers, null, 2));
        
        const { sessionId } = req.params;
        const { network = 'main', ownerPrivateKey, ownerKeyName = 'owner', homeDir = null, keyringBackend = 'memory' } = req.body;

        console.log('🔍 Extracted parameters:');
        console.log('  - sessionId:', sessionId);
        console.log('  - network:', network);
        console.log('  - ownerPrivateKey:', ownerPrivateKey ? `[PROVIDED - ${ownerPrivateKey.length} chars]` : '[NOT PROVIDED]');
        console.log('  - ownerKeyName:', ownerKeyName);
        console.log('  - homeDir:', homeDir);
        console.log('  - keyringBackend:', keyringBackend);

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        if (!ownerPrivateKey) {
            return res.status(400).json({
                success: false,
                error: 'Owner private key is required'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        // Validate keyring backend parameter
        if (keyringBackend && !['os', 'file', 'kwallet', 'pass', 'test', 'memory'].includes(keyringBackend)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid keyring backend parameter. Must be "os", "file", "kwallet", "pass", "test", or "memory"'
            });
        }

        console.log(`🚀 Stake execution with imported key requested for session: ${sessionId}`);
        console.log(`🌐 Network: ${network}`);
        console.log(`🔑 Keyring backend: ${keyringBackend}`);
        console.log(`🔑 Owner key name: ${ownerKeyName}`);

        // Execute stake transactions with imported key
        const result = await stakeController.executeStakeTransactionsWithImportedKey(sessionId, network, ownerPrivateKey, ownerKeyName, homeDir, keyringBackend);

        res.json({
            success: true,
            message: `Stake transactions completed for session ${sessionId}`,
            data: result
        });

    } catch (error) {
        console.error('Stake execution with imported key error:', error);
        res.status(500).json({
            success: false,
            error: 'Stake execution failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /generate-unsigned/:sessionId - Generate unsigned stake transactions for a session
 */
router.post('/generate-unsigned/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { network = 'main', ownerAddress } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        if (!ownerAddress) {
            return res.status(400).json({
                success: false,
                error: 'Owner address is required'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        console.log(`🚀 Generating unsigned transactions for session: ${sessionId}`);
        console.log(`🌐 Network: ${network}`);
        console.log(`💰 Owner address: ${ownerAddress}`);

        // Generate unsigned transactions
        const result = await stakeController.generateUnsignedStakeTransactions(sessionId, network, ownerAddress);

        res.json({
            success: true,
            message: `Unsigned transactions generated for session ${sessionId}`,
            data: result
        });

    } catch (error) {
        console.error('Unsigned transaction generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate unsigned transactions',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /prepare/:sessionId - Prepare stake files for frontend processing
 */
router.post('/prepare/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { network = 'main', ownerAddress } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        if (!ownerAddress) {
            return res.status(400).json({
                success: false,
                error: 'Owner address is required'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        console.log(`🚀 Preparing stake files for frontend processing for session: ${sessionId}`);
        console.log(`🌐 Network: ${network}`);
        console.log(`💰 Owner address: ${ownerAddress}`);

        // Prepare stake files for frontend processing
        const result = await stakeController.generateUnsignedStakeTransactions(sessionId, network, ownerAddress);

        res.json({
            success: true,
            message: `Stake files prepared for frontend processing for session ${sessionId}`,
            data: result
        });

    } catch (error) {
        console.error('Stake file preparation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to prepare stake files',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /generate-cli/:sessionId - Generate unsigned transactions for CLI method
 */
router.post('/generate-cli/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { network = 'main', ownerAddress, keyringBackend = 'memory' } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        if (!ownerAddress) {
            return res.status(400).json({
                success: false,
                error: 'Owner address is required'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        // Validate keyring backend parameter
        if (keyringBackend && !['os', 'file', 'kwallet', 'pass', 'test', 'memory'].includes(keyringBackend)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid keyring backend parameter. Must be "os", "file", "kwallet", "pass", "test", or "memory"'
            });
        }

        console.log(`🚀 Generating unsigned transactions for CLI method for session: ${sessionId}`);
        console.log(`🌐 Network: ${network}`);
        console.log(`💰 Owner address: ${ownerAddress}`);
        console.log(`🔑 Keyring backend: ${keyringBackend}`);

        // Generate unsigned transactions for CLI method
        const result = await stakeController.generateUnsignedTransactionsForCLI(sessionId, network, ownerAddress, keyringBackend);

        res.json({
            success: true,
            message: `Unsigned transactions generated for CLI method for session ${sessionId}`,
            data: result
        });

    } catch (error) {
        console.error('Unsigned transaction generation for CLI error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate unsigned transactions for CLI',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /execute-local-cli - Execute stake transactions using mnemonic and stake file content
 */
router.post('/execute-local-cli', async (req, res) => {
    try {
        const { stakeFiles, mnemonic, keyName = 'owner', network = 'main', homeDir = null, keyringBackend = null } = req.body;

        // Debug logging
        console.log('🔍 DEBUG: Received request body:');
        console.log('  - stakeFiles:', stakeFiles ? `${stakeFiles.length} files` : 'undefined');
        console.log('  - mnemonic length:', mnemonic ? mnemonic.length : 'undefined');
        console.log('  - mnemonic preview:', mnemonic ? `${mnemonic.substring(0, 20)}...` : 'undefined');
        console.log('  - keyName:', keyName);
        console.log('  - network:', network);
        console.log('  - keyringBackend:', keyringBackend);

        if (!mnemonic) {
            return res.status(400).json({
                success: false,
                error: 'Mnemonic phrase is required'
            });
        }

        // Validate mnemonic format (basic check)
        const wordCount = mnemonic.trim().split(/\s+/).length;
        if (wordCount < 12 || wordCount > 24) {
            return res.status(400).json({
                success: false,
                error: `Invalid mnemonic format. Expected 12-24 words, got ${wordCount} words`
            });
        }

        // Validate keyName format (should be simple alphanumeric)
        if (keyName && !/^[a-zA-Z0-9_-]+$/.test(keyName)) {
            return res.status(400).json({
                success: false,
                error: `Invalid keyName format. Should contain only letters, numbers, hyphens, and underscores. Got: ${keyName}`
            });
        }

        // Validate keyring backend parameter
        if (keyringBackend && !['os', 'file', 'kwallet', 'pass', 'test', 'memory'].includes(keyringBackend)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid keyring backend parameter. Must be "os", "file", "kwallet", "pass", "test", or "memory"'
            });
        }

        // Suggest a simpler keyName if the current one is too complex
        if (keyName && keyName.length > 20) {
            console.log(`⚠️ KeyName is quite long (${keyName.length} chars). Consider using a shorter name like 'owner' or 'stake'`);
        }

        if (!stakeFiles || !Array.isArray(stakeFiles) || stakeFiles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one stake file is required'
            });
        }

        // Validate each stake file
        for (let i = 0; i < stakeFiles.length; i++) {
            const stakeFile = stakeFiles[i];
            if (!stakeFile.content || typeof stakeFile.content !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: `Stake file ${i + 1} must have valid content`
                });
            }
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        console.log(`🚀 Local CLI execution requested`);
        console.log(`🌐 Network: ${network}`);
        console.log(`🔑 Key name: ${keyName}`);
        console.log(`🔑 Keyring backend: ${keyringBackend || 'default'}`);
        console.log(`📄 Number of stake files: ${stakeFiles.length}`);

        // Execute stake transactions with mnemonic
        const result = await stakeController.executeStakeTransactionsWithMnemonic(stakeFiles, mnemonic, keyName, network, homeDir, keyringBackend);

        res.json({
            success: true,
            message: `Stake transactions completed successfully`,
            data: result
        });

    } catch (error) {
        console.error('Local CLI execution error:', error);
        res.status(500).json({
            success: false,
            error: 'Local CLI execution failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * POST /create-node-and-stake - Create a node wallet and stake it using owner mnemonic
 */
router.post('/create-node-and-stake', async (req, res) => {
    try {
        const { ownerMnemonic, ownerAddress, network = 'main', keyName = 'owner', homeDir = null, keyringBackend = null } = req.body;

        if (!ownerMnemonic) {
            return res.status(400).json({
                success: false,
                error: 'Owner mnemonic phrase is required'
            });
        }

        if (!ownerAddress) {
            return res.status(400).json({
                success: false,
                error: 'Owner address is required'
            });
        }

        // Validate mnemonic format (basic check)
        const wordCount = ownerMnemonic.trim().split(/\s+/).length;
        if (wordCount < 12 || wordCount > 24) {
            return res.status(400).json({
                success: false,
                error: `Invalid mnemonic format. Expected 12-24 words, got ${wordCount} words`
            });
        }

        // Validate owner address format
        if (!ownerAddress.startsWith('pokt')) {
            return res.status(400).json({
                success: false,
                error: 'Owner address must start with "pokt"'
            });
        }

        // Validate network parameter
        if (network && !['main', 'testnet', 'beta'].includes(network)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid network parameter. Must be "main", "testnet", or "beta"'
            });
        }

        // Validate keyring backend parameter
        if (keyringBackend && !['os', 'file', 'kwallet', 'pass', 'test', 'memory'].includes(keyringBackend)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid keyring backend parameter. Must be "os", "file", "kwallet", "pass", "test", or "memory"'
            });
        }

        console.log(`🚀 Create node and stake requested`);
        console.log(`🌐 Network: ${network}`);
        console.log(`🔑 Key name: ${keyName}`);
        console.log(`🔑 Keyring backend: ${keyringBackend || 'default'}`);
        console.log(`💰 Owner address: ${ownerAddress}`);

        // Create node and stake
        const result = await stakeController.createNodeAndStake(ownerMnemonic, ownerAddress, network, keyName, homeDir, keyringBackend);

        res.json({
            success: true,
            message: `Node created and staked successfully`,
            data: result
        });

    } catch (error) {
        console.error('Create node and stake error:', error);
        res.status(500).json({
            success: false,
            error: 'Create node and stake failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * GET /status/:sessionId - Get stake session status
 */
router.get('/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        const status = await stakeController.getStakeSessionStatus(sessionId);

        if (!status.success) {
            return res.status(404).json(status);
        }

        res.json(status);

    } catch (error) {
        console.error('Stake status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get stake status',
            message: error.message || 'Unknown error occurred'
        });
    }
});

/**
 * GET /download-mnemonics/:sessionId - Download wallet mnemonics as JSON file
 */
router.get('/download-mnemonics/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        console.log(`📥 Mnemonics download requested for session: ${sessionId}`);

        // Get session info and wallet data
        const sessionDir = path.join(require('../config/config').paths.dataDir, 'stake', sessionId);
        
        // Check if session exists
        if (!await fs.pathExists(sessionDir)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // First, try to read from the stored mnemonics file (contains real mnemonics)
        const mnemonicsFilePath = path.join(sessionDir, 'wallet_mnemonics.json');
        
        if (await fs.pathExists(mnemonicsFilePath)) {
            console.log(`📄 Reading real mnemonics from stored file: ${mnemonicsFilePath}`);
            
            try {
                const mnemonicsData = await fs.readJson(mnemonicsFilePath);
                
                console.log(`✅ Successfully retrieved ${mnemonicsData.wallets.length} wallet mnemonics for session: ${sessionId}`);
                
                return res.json({
                    success: true,
                    message: `Retrieved ${mnemonicsData.wallets.length} wallet mnemonics for session ${sessionId}`,
                    data: mnemonicsData,
                    note: 'Real mnemonics included - store securely!'
                });
                
            } catch (readError) {
                console.error(`❌ Error reading stored mnemonics file: ${readError.message}`);
                // Fall back to legacy method below
            }
        }

        // Fallback: Legacy method (for sessions created before mnemonic storage)
        console.log(`⚠️ No stored mnemonics file found, falling back to legacy method (mnemonics not available)`);
        
        const sessionInfoPath = path.join(sessionDir, 'session_info.json');
        const sessionInfo = await fs.readJson(sessionInfoPath);
        
        // Get wallets directory
        const walletsDir = path.join(sessionDir, 'wallets');
        const wallets = [];
        
        if (await fs.pathExists(walletsDir)) {
            const walletDirs = await fs.readdir(walletsDir);
            
            for (const walletDir of walletDirs) {
                const walletPath = path.join(walletsDir, walletDir);
                const stats = await fs.stat(walletPath);
                
                if (stats.isDirectory()) {
                    // Extract node number from wallet name (e.g., "node_1" -> 1)
                    const nodeNumber = parseInt(walletDir.replace('node_', ''));
                    
                    // Get stake file path
                    const stakeFilesDir = path.join(sessionDir, 'stake_files');
                    const stakeFileName = `stake_${walletDir}.yaml`;
                    const stakeFilePath = path.join(stakeFilesDir, stakeFileName);
                    
                    // Try to get wallet info including mnemonic
                    let walletInfo = {
                        nodeNumber,
                        walletName: walletDir,
                        homePath: walletPath,
                        stakeFile: stakeFilePath
                    };
                    
                    // Try to get wallet address and mnemonic from the wallet directory
                    try {
                        const StakeExecutor = require('../services/stake-executor');
                        const stakeExecutor = new StakeExecutor();
                        const { exec } = require('child_process');
                        const { promisify } = require('util');
                        const execAsync = promisify(exec);
                        
                        // Get wallet address
                        const { stdout: addressOutput } = await execAsync(
                            `${stakeExecutor.pocketdPath} keys show ${walletDir} --home "${walletPath}" --keyring-backend ${stakeExecutor.keyringBackend} --output json`
                        );
                        const walletData = JSON.parse(addressOutput);
                        walletInfo.address = walletData.address;
                        
                        // Note: We can't retrieve the mnemonic from an existing wallet for security reasons
                        // The mnemonic is only available during wallet creation
                        walletInfo.mnemonic = 'NOT_AVAILABLE - Mnemonic was only available during wallet creation';
                        walletInfo.note = 'To get mnemonics, use the /create endpoint which returns them in the response';
                        
                    } catch (walletError) {
                        console.warn(`Could not get wallet info for ${walletDir}: ${walletError.message}`);
                        walletInfo.address = 'UNKNOWN';
                        walletInfo.mnemonic = 'NOT_AVAILABLE';
                        walletInfo.error = walletError.message;
                    }
                    
                    wallets.push(walletInfo);
                }
            }
        }

        // Sort wallets by node number
        wallets.sort((a, b) => a.nodeNumber - b.nodeNumber);

        // Prepare mnemonics data for download (legacy format)
        const mnemonicsData = {
            sessionId,
            createdAt: sessionInfo.createdAt,
            ownerAddress: sessionInfo.ownerAddress,
            numberOfNodes: sessionInfo.numberOfNodes,
            totalWallets: wallets.length,
            wallets: wallets,
            downloadInstructions: 'This is legacy data - real mnemonics are only available from sessions with stored mnemonic files.',
            securityWarning: 'For real mnemonics, ensure the session was created with mnemonic storage enabled.',
            timestamp: new Date().toISOString()
        };

        // Set response headers for file download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="wallet_mnemonics_${sessionId}.json"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Send the JSON data
        res.json({
            success: true,
            message: `Wallet information prepared for download (legacy method - real mnemonics not available)`,
            data: mnemonicsData,
            downloadUrl: `/api/stake/download-mnemonics/${sessionId}`,
            note: 'This data does not contain real mnemonics. Use sessions created with mnemonic storage for complete data.'
        });

    } catch (error) {
        console.error('Mnemonics download error:', error);
        res.status(500).json({
            success: false,
            error: 'Mnemonics download failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * GET /download-mnemonics/:sessionId/file - Direct file download endpoint
 */
router.get('/download-mnemonics/:sessionId/file', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        console.log(`📥 Direct file download requested for session: ${sessionId}`);

        // Get session info and wallet data
        const sessionDir = path.join(require('../config/config').paths.dataDir, 'stake', sessionId);
        
        // Check if session exists
        if (!await fs.pathExists(sessionDir)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // First, try to read from the stored mnemonics file (contains real mnemonics)
        const mnemonicsFilePath = path.join(sessionDir, 'wallet_mnemonics.json');
        
        if (await fs.pathExists(mnemonicsFilePath)) {
            console.log(`📄 Reading real mnemonics from stored file for download: ${mnemonicsFilePath}`);
            
            try {
                const mnemonicsData = await fs.readJson(mnemonicsFilePath);
                
                // Add download metadata
                const downloadData = {
                    ...mnemonicsData,
                    downloadedAt: new Date().toISOString(),
                    downloadInstructions: 'Store this file securely. These mnemonics are required to access your node wallets.',
                    securityWarning: 'Keep this file secure and private. Anyone with access to these mnemonics can control your wallets.',
                    dataType: 'REAL_MNEMONICS'
                };
                
                console.log(`✅ Preparing download of ${mnemonicsData.wallets.length} real wallet mnemonics for session: ${sessionId}`);
                
                // Set response headers for file download
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="wallet_mnemonics_${sessionId}.json"`);
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                
                // Send the JSON data directly as a file
                return res.send(JSON.stringify(downloadData, null, 2));
                
            } catch (readError) {
                console.error(`❌ Error reading stored mnemonics file: ${readError.message}`);
                // Fall back to legacy method below
            }
        }

        // Fallback: Legacy method (for sessions created before mnemonic storage)
        console.log(`⚠️ No stored mnemonics file found, falling back to legacy method (mnemonics not available)`);
        
        const sessionInfoPath = path.join(sessionDir, 'session_info.json');
        const sessionInfo = await fs.readJson(sessionInfoPath);
        
        // Get wallets directory
        const walletsDir = path.join(sessionDir, 'wallets');
        const wallets = [];
        
        if (await fs.pathExists(walletsDir)) {
            const walletDirs = await fs.readdir(walletsDir);

            for (const walletDir of walletDirs) {
                const walletPath = path.join(walletsDir, walletDir);
                const stats = await fs.stat(walletPath);
                
                if (stats.isDirectory()) {
                    // Extract node number from wallet name (e.g., "node_1" -> 1)
                    const nodeNumber = parseInt(walletDir.replace('node_', ''));
                    
                    // Get stake file path
                    const stakeFilesDir = path.join(sessionDir, 'stake_files');
                    const stakeFileName = `stake_${walletDir}.yaml`;
                    const stakeFilePath = path.join(stakeFilesDir, stakeFileName);
                    
                    // Try to get wallet info including mnemonic
                    let walletInfo = {
                        nodeNumber,
                        walletName: walletDir,
                        homePath: walletPath,
                        stakeFile: stakeFilePath
                    };
                    
                    // Try to get wallet address and mnemonic from the wallet directory
                    try {
                        const StakeExecutor = require('../services/stake-executor');
                        const stakeExecutor = new StakeExecutor();
                        const { exec } = require('child_process');
                        const { promisify } = require('util');
                        const execAsync = promisify(exec);
                        
                        // Get wallet address
                        const { stdout: addressOutput } = await execAsync(
                            `${stakeExecutor.pocketdPath} keys show ${walletDir} --home "${walletPath}" --keyring-backend ${stakeExecutor.keyringBackend} --output json`
                        );
                        const walletData = JSON.parse(addressOutput);
                        walletInfo.address = walletData.address;
                        
                        // Note: We can't retrieve the mnemonic from an existing wallet for security reasons
                        // The mnemonic is only available during wallet creation
                        walletInfo.mnemonic = 'NOT_AVAILABLE - Mnemonic was only available during wallet creation';
                        walletInfo.note = 'To get mnemonics, use the /create endpoint which returns them in the response';
                        
                    } catch (walletError) {
                        console.warn(`Could not get wallet info for ${walletDir}: ${walletError.message}`);
                        walletInfo.address = 'UNKNOWN';
                        walletInfo.mnemonic = 'NOT_AVAILABLE';
                        walletInfo.error = walletError.message;
                    }
                    
                    wallets.push(walletInfo);
                }
            }
        }

        // Sort wallets by node number
        wallets.sort((a, b) => a.nodeNumber - b.nodeNumber);

        // Prepare mnemonics data for download (legacy format)
        const mnemonicsData = {
            sessionId,
            createdAt: sessionInfo.createdAt,
            ownerAddress: sessionInfo.ownerAddress,
            numberOfNodes: sessionInfo.numberOfNodes,
            totalWallets: wallets.length,
            wallets: wallets,
            downloadedAt: new Date().toISOString(),
            downloadInstructions: 'This is legacy data - real mnemonics are only available from sessions with stored mnemonic files.',
            securityWarning: 'For real mnemonics, ensure the session was created with mnemonic storage enabled.',
            dataType: 'LEGACY_NO_MNEMONICS',
            timestamp: new Date().toISOString()
        };

        // Set response headers for direct file download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="wallet_info_${sessionId}.json"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Send the JSON data directly as a file
        res.send(JSON.stringify(mnemonicsData, null, 2));

    } catch (error) {
        console.error('Direct file download error:', error);
        res.status(500).json({
            success: false,
            error: 'File download failed',
            message: error.message || 'Unknown error occurred',
            details: error.toString()
        });
    }
});

/**
 * GET /health - Check stake service health
 */
router.get('/health', async (req, res) => {
    try {
        const StakeExecutor = require('../services/stake-executor');
        const stakeExecutor = new StakeExecutor();
        
        const pocketdAvailable = await stakeExecutor.validatePocketd();

        res.status(200).json({
            success: true,
            message: 'Stake service is healthy',
            status: pocketdAvailable ? 'operational' : 'degraded',
            cli: {
                available: pocketdAvailable,
                command: 'keys add',
                method: 'cli_real'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            message: 'Stake service unavailable',
            status: 'degraded',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router; 