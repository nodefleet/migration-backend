const { exec } = require('child_process');
const { promisify } = require('util');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');

const execAsync = promisify(exec);

class StakeExecutor {
    constructor() {
        this.pocketdPath = config.pocketd.command;
        this.defaultHome = config.pocketd.defaultHome;
        this.keyringBackend = config.pocketd.defaultKeyringBackend;
        this.timeout = config.pocketd.timeout;
        this.maxRetries = config.pocketd.maxRetries;
    }

    /**
     * Utility function to add delay between transactions
     * @param {number} seconds - Number of seconds to wait
     * @returns {Promise<void>}
     */
    async delay(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    /**
     * Check if error is a sequence mismatch error
     * @param {Error} error - The error to check
     * @returns {boolean} - Whether it's a sequence mismatch error
     */
    isSequenceMismatchError(error) {
        const errorMessage = error.message || error.toString();
        return errorMessage.includes('account sequence mismatch') || 
               errorMessage.includes('expected') && errorMessage.includes('got') && errorMessage.includes('sequence');
    }

    /**
     * Execute stake transaction with retry logic for sequence mismatch
     * @param {string} stakeFilePath - Path to the stake configuration file
     * @param {string} keyName - Name of the key to use for staking
     * @param {string} homeDir - Home directory for the key
     * @param {string} network - Network to stake on (default: main)
     * @param {string} passphrase - Passphrase for the key (default: empty)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @param {number} maxRetries - Maximum number of retries (default: 3)
     * @returns {Promise<Object>} - Stake transaction result
     */
    async executeStakeTransactionWithRetry(stakeFilePath, keyName, homeDir, network = 'main', passphrase = '', keyringBackend = null, maxRetries = 3) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔧 Attempt ${attempt}/${maxRetries} - Staking with config: ${stakeFilePath}`);
                
                const result = await this.executeStakeTransaction(stakeFilePath, keyName, homeDir, network, passphrase, keyringBackend);
                
                if (attempt > 1) {
                    console.log(`✅ Transaction succeeded on attempt ${attempt}`);
                }
                
                return {
                    ...result,
                    attempts: attempt
                };
                
            } catch (error) {
                lastError = error;
                console.error(`❌ Attempt ${attempt} failed: ${error.message}`);
                
                // Check if it's a sequence mismatch error
                if (this.isSequenceMismatchError(error)) {
                    if (attempt < maxRetries) {
                        const retryDelay = 30 * attempt; // Increasing delay: 30s, 60s, 90s
                        console.log(`🔄 Sequence mismatch detected. Waiting ${retryDelay} seconds before retry...`);
                        await this.delay(retryDelay);
                        continue;
                    } else {
                        console.error(`❌ Max retries (${maxRetries}) reached for sequence mismatch`);
                    }
                } else {
                    // For non-sequence mismatch errors, don't retry
                    console.error(`❌ Non-retryable error: ${error.message}`);
                    break;
                }
            }
        }
        
        throw new Error(`Transaction failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
    }

    /**
     * Store wallet mnemonics to JSON file
     * @param {Array} wallets - Array of wallet objects with mnemonics
     * @param {string} sessionId - Session ID for the wallets
     * @returns {Promise<string>} - Path to the saved JSON file
     */
    async storeWalletMnemonics(wallets, sessionId) {
        try {
            console.log(`💾 Storing ${wallets.length} wallet mnemonics for session: ${sessionId}`);
            
            const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
            const mnemonicsFile = path.join(sessionDir, 'wallet_mnemonics.json');
            
            // Ensure session directory exists
            await fs.ensureDir(sessionDir);
            
            // Prepare mnemonics data
            const mnemonicsData = {
                sessionId,
                createdAt: new Date().toISOString(),
                totalWallets: wallets.length,
                wallets: wallets.map(wallet => ({
                    nodeNumber: wallet.nodeNumber,
                    walletName: wallet.walletName,
                    address: wallet.address,
                    mnemonic: wallet.mnemonic,
                    homePath: wallet.homePath,
                    stakeFile: wallet.stakeFile
                }))
            };
            
            // Write to JSON file
            await fs.writeJson(mnemonicsFile, mnemonicsData, { spaces: 2 });
            
            console.log(`✅ Wallet mnemonics stored in: ${mnemonicsFile}`);
            return mnemonicsFile;
            
        } catch (error) {
            console.error(`❌ Failed to store wallet mnemonics: ${error.message}`);
            throw new Error(`Failed to store wallet mnemonics: ${error.message}`);
        }
    }

    /**
     * Create a new wallet using pocketd keys add
     * @param {string} walletName - Name for the wallet
     * @param {string} homePath - Home directory for the wallet
     * @returns {Promise<Object>} - Wallet creation result
     */
    async createWallet(walletName, homePath) {
        try {
            console.log(`🔑 Creating wallet: ${walletName} in ${homePath}`);
            
            // Create home directory if it doesn't exist
            await fs.ensureDir(homePath);

            // Generate wallet using pocketd keys add
            const command = `${this.pocketdPath} keys add ${walletName} --home ${homePath} --keyring-backend ${this.keyringBackend} --output json`;
            
            const { stdout } = await execAsync(command, {
                timeout: this.timeout,
                cwd: process.cwd()
            });

            const walletData = JSON.parse(stdout);
            
            console.log(`✅ Wallet created: ${walletName}`);
            return {
                success: true,
                walletName,
                address: walletData.address,
                mnemonic: walletData.mnemonic,
                homePath
            };
        } catch (error) {
            console.error(`❌ Failed to create wallet ${walletName}:`, error.message);
            throw new Error(`Failed to create wallet ${walletName}: ${error.message}`);
        }
    }

    /**
     * Export private key from wallet
     * @param {string} walletName - Name of the wallet
     * @param {string} homePath - Home directory for the wallet
     * @returns {Promise<string>} - Private key in hex format
     */
    async exportPrivateKey(walletName, homePath) {
        try {
            console.log(`🔓 Exporting private key for wallet: ${walletName}`);
            
            const command = `${this.pocketdPath} keys export ${walletName} --home ${homePath} --keyring-backend ${this.keyringBackend} --unsafe --unarmored-hex --yes`;
            
            const { stdout } = await execAsync(command, {
                timeout: this.timeout,
                cwd: process.cwd()
            });

            const privateKey = stdout.trim();
            console.log(`✅ Private key exported for wallet: ${walletName}`);
            return privateKey;
        } catch (error) {
            console.error(`❌ Failed to export private key for ${walletName}:`, error.message);
            throw new Error(`Failed to export private key for ${walletName}: ${error.message}`);
        }
    }

    /**
     * Generate stake configuration YAML file
     * @param {Object} stakeData - Stake configuration data
     * @param {string} outputPath - Path to save the YAML file
     */
    async generateStakeFile(stakeData, outputPath) {
        try {
            console.log(`📄 Generating stake file: ${outputPath}`);
            
            const {
                stakeAmount = '60005000000upokt',
                ownerAddress,
                operatorAddress,
                services = ['eth', 'solana', 'bsc', 'poly', 'kava', 'osmosis', 'op', 'eth-holesky-testnet'],
                publicUrl = 'https://relayminer.shannon-mainnet.eu.nodefleet.net',
                revSharePercent = {
                    [ownerAddress]: 95.0,
                    [operatorAddress]: 5.0
                }
            } = stakeData;

            let yamlContent = `stake_amount: ${stakeAmount}\n`;
            yamlContent += `owner_address: ${ownerAddress}\n`;
            yamlContent += `operator_address: ${operatorAddress}\n`;
            yamlContent += `services:\n`;

            for (const service of services) {
                yamlContent += `  - service_id: ${service}\n`;
                yamlContent += `    endpoints:\n`;
                yamlContent += `      - publicly_exposed_url: ${publicUrl}\n`;
                yamlContent += `        rpc_type: json_rpc\n`;
                yamlContent += `    rev_share_percent:\n`;
                
                for (const [address, share] of Object.entries(revSharePercent)) {
                    yamlContent += `      ${address}: ${share}.0\n`;
                }
            }

            // Ensure directory exists
            await fs.ensureDir(path.dirname(outputPath));
            
            // Write the file
            await fs.writeFile(outputPath, yamlContent, 'utf8');
            
            console.log(`✅ Stake file generated: ${outputPath}`);
            return outputPath;
        } catch (error) {
            console.error(`❌ Failed to generate stake file:`, error.message);
            throw new Error(`Failed to generate stake file: ${error.message}`);
        }
    }

    /**
     * Execute stake process - create wallets and generate stake files
     * @param {Object} stakeRequest - Stake request data
     * @returns {Promise<Object>} - Stake execution result
     */
    async executeStake(stakeRequest) {
        const sessionId = uuidv4();
        const { ownerAddress, numberOfNodes } = stakeRequest;
        
        console.log(`🚀 Starting stake process for session: ${sessionId}`);
        console.log(`📊 Creating ${numberOfNodes} nodes for owner: ${ownerAddress}`);

        try {
            const results = {
                sessionId,
                ownerAddress,
                numberOfNodes,
                wallets: [],
                stakeFiles: [],
                timestamp: new Date().toISOString()
            };

            // Create wallets directory for this session
            const sessionWalletsDir = path.join(config.paths.dataDir, 'stake', sessionId, 'wallets');
            const sessionStakeDir = path.join(config.paths.dataDir, 'stake', sessionId, 'stake_files');
            
            await fs.ensureDir(sessionWalletsDir);
            await fs.ensureDir(sessionStakeDir);

            // Save session information
            const sessionInfo = {
                sessionId,
                ownerAddress,
                numberOfNodes,
                createdAt: new Date().toISOString()
            };
            await fs.writeJson(path.join(config.paths.dataDir, 'stake', sessionId, 'session_info.json'), sessionInfo, { spaces: 2 });

            // Create wallets
            for (let i = 1; i <= numberOfNodes; i++) {
                const walletName = `node_${i}`;
                const walletHomePath = path.join(sessionWalletsDir, walletName);
                
                console.log(`\n🔧 Processing node ${i}/${numberOfNodes}`);
                
                // Create wallet
                const walletResult = await this.createWallet(walletName, walletHomePath);
                
                // Export private key
                const privateKey = await this.exportPrivateKey(walletName, walletHomePath);
                
                // Generate stake file for this wallet
                const stakeFileName = `stake_${walletName}.yaml`;
                const stakeFilePath = path.join(sessionStakeDir, stakeFileName);
                
                const stakeData = {
                    stakeAmount: '60005000000upokt',
                    ownerAddress: ownerAddress,
                    operatorAddress: walletResult.address,
                    services: ['eth', 'solana', 'bsc', 'poly', 'kava', 'osmosis', 'op', 'eth-holesky-testnet'],
                    publicUrl: 'https://relayminer.shannon-mainnet.eu.nodefleet.net',
                    revSharePercent: {
                        [ownerAddress]: 95.0,
                        [walletResult.address]: 5.0
                    }
                };
                
                await this.generateStakeFile(stakeData, stakeFilePath);
                
                // Add to results
                results.wallets.push({
                    nodeNumber: i,
                    walletName,
                    address: walletResult.address,
                    privateKey,
                    mnemonic: walletResult.mnemonic,
                    homePath: walletHomePath,
                    stakeFile: stakeFilePath
                });
                
                results.stakeFiles.push({
                    nodeNumber: i,
                    fileName: stakeFileName,
                    filePath: stakeFilePath
                });
            }

            // Prepare mnemonics data for frontend download (don't store on backend)
            const mnemonicsData = {
                sessionId,
                createdAt: new Date().toISOString(),
                totalWallets: results.wallets.length,
                wallets: results.wallets.map(wallet => ({
                    nodeNumber: wallet.nodeNumber,
                    walletName: wallet.walletName,
                    address: wallet.address,
                    mnemonic: wallet.mnemonic,
                    homePath: wallet.homePath,
                    stakeFile: wallet.stakeFile
                }))
            };

            // Add mnemonics data to results for frontend download
            results.mnemonicsData = mnemonicsData;
            results.downloadableMnemonics = true;

            // Store mnemonics securely for later access
            const mnemonicsFilePath = await this.storeWalletMnemonics(results.wallets, sessionId);
            console.log(`💾 Mnemonics stored at: ${mnemonicsFilePath}`);

            console.log(`\n✅ Stake process completed successfully for session: ${sessionId}`);
            console.log(`📁 Created ${results.wallets.length} wallets and ${results.stakeFiles.length} stake files`);
            console.log(`💾 Wallet mnemonics data prepared for frontend download`);
            console.log(`⚠️ IMPORTANT: Frontend should download and store mnemonics securely - they are not saved on backend`);
            
            return {
                success: true,
                sessionId,
                data: results
            };

        } catch (error) {
            console.error(`❌ Stake process failed for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Execute stake transactions with imported owner key
     * @param {string} sessionId - Session ID to execute stakes for
     * @param {string} network - Network to stake on (default: main)
     * @param {string} ownerPrivateKey - Owner's private key in hex format
     * @param {string} ownerKeyName - Name for the owner's key in keyring (default: owner)
     * @param {string} homeDir - Home directory for the keyring (default: from config)
     * @param {string} keyringBackend - Keyring backend to use (default: memory)
     * @returns {Promise<Object>} - Stake execution results
     */
    async executeStakeTransactionsWithImportedKey(sessionId, network = 'main', ownerPrivateKey, ownerKeyName = 'owner', homeDir = null, keyringBackend = 'memory') {
        try {
            console.log(`🚀 Starting stake transactions with imported key for session: ${sessionId}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Keyring backend: ${keyringBackend}`);
            console.log(`🔑 Owner key name: ${ownerKeyName}`);

            const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
            const walletsDir = path.join(sessionDir, 'wallets');
            const stakeFilesDir = path.join(sessionDir, 'stake_files');

            // Check if session exists
            const sessionExists = await fs.pathExists(sessionDir);
            if (!sessionExists) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Get session info to find owner address
            const sessionInfoPath = path.join(sessionDir, 'session_info.json');
            let ownerAddress = null;
            
            if (await fs.pathExists(sessionInfoPath)) {
                const sessionInfo = await fs.readJson(sessionInfoPath);
                ownerAddress = sessionInfo.ownerAddress;
            }

            // Get all stake files
            const stakeFiles = await fs.readdir(stakeFilesDir);
            const yamlFiles = stakeFiles.filter(file => file.endsWith('.yaml'));

            if (yamlFiles.length === 0) {
                throw new Error(`No stake files found in session ${sessionId}`);
            }

            // Use provided home directory or default
            const keyringHomeDir = homeDir || this.defaultHome;

            // Import the owner's key into the keyring
            console.log(`🔑 Importing owner key into ${keyringBackend} keyring...`);
            const importResult = await this.importKeyToKeyring(ownerKeyName, ownerPrivateKey, keyringHomeDir, keyringBackend);
            
            if (!importResult.success) {
                throw new Error(`Failed to import owner key: ${importResult.error}`);
            }

            console.log(`✅ Owner key imported successfully: ${importResult.address}`);

            const results = {
                sessionId,
                network,
                keyringBackend,
                ownerKeyName,
                ownerAddress: importResult.address,
                totalFiles: yamlFiles.length,
                successful: 0,
                failed: 0,
                transactions: [],
                timestamp: new Date().toISOString()
            };

            // Process each stake file
            for (const yamlFile of yamlFiles) {
                try {
                    const stakeFilePath = path.join(stakeFilesDir, yamlFile);
                    
                    // Extract key name from filename (e.g., "stake_node_1.yaml" -> "node_1")
                    const operatorKeyName = yamlFile.replace('stake_', '').replace('.yaml', '');
                    const operatorHomeDir = path.join(walletsDir, operatorKeyName);

                    console.log(`\n📄 Processing stake file: ${yamlFile}`);
                    console.log(`🔑 Using operator key: ${operatorKeyName}`);

                    console.log(`💰 Transaction will be signed by: ${ownerKeyName} (${importResult.address})`);

                    // Execute stake transaction using imported owner key
                    const transactionResult = await this.executeStakeTransactionWithRetry(
                        stakeFilePath,
                        ownerKeyName, // Use the key name, not the address
                        keyringHomeDir,
                        network,
                        '', // No passphrase needed for memory keyring
                        keyringBackend,
                        3 // Max retries
                    );

                    results.transactions.push(transactionResult);
                    results.successful++;

                    console.log(`✅ Transaction completed for ${yamlFile}`);

                    // Add delay between transactions to prevent account sequence mismatch
                    const currentIndex = yamlFiles.indexOf(yamlFile);
                    if (currentIndex < yamlFiles.length - 1) {
                        console.log(`⏳ Waiting 30 seconds before next transaction to prevent sequence mismatch...`);
                        await this.delay(30);
                    }

                } catch (error) {
                    console.error(`❌ Transaction failed for ${yamlFile}: ${error.message}`);
                    
                    results.transactions.push({
                        success: false,
                        stakeFile: yamlFile,
                        error: error.message
                    });
                    results.failed++;
                }
            }

            console.log(`\n📊 Stake transactions completed for session: ${sessionId}`);
            console.log(`✅ Successful: ${results.successful}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`📄 Total processed: ${results.totalFiles}`);

            return {
                success: true,
                data: results
            };

        } catch (error) {
            console.error(`❌ Stake transactions failed for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Execute stake transaction using mnemonic in memory keyring
     * @param {string} stakeFileContent - YAML content of the stake file
     * @param {string} mnemonic - Mnemonic phrase for wallet recovery
     * @param {string} keyName - Name for the key in memory keyring
     * @param {string} network - Network to stake on (default: main)
     * @param {string} homeDir - Home directory for the keyring (default: from config)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @returns {Promise<Object>} - Stake execution result
     */
    async executeStakeWithMnemonic(stakeFileContent, mnemonic, keyName = 'owner', network = 'main', homeDir = null, keyringBackend = null) {
        try {
            // Use provided keyring backend or fall back to config default
            const backend = keyringBackend || this.keyringBackend;
            
            console.log(`🚀 Executing stake transaction with mnemonic for key: ${keyName}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Keyring backend: ${backend}`);
            
            // Debug logging for mnemonic
            console.log(`🔍 DEBUG: Mnemonic validation:`);
            console.log(`  - mnemonic length: ${mnemonic ? mnemonic.length : 'undefined'}`);
            console.log(`  - mnemonic preview: ${mnemonic ? mnemonic.substring(0, 50) + '...' : 'undefined'}`);
            console.log(`  - word count: ${mnemonic ? mnemonic.trim().split(/\s+/).length : 'undefined'}`);
            console.log(`  - keyName: ${keyName}`);

            // Use provided home directory or default
            const keyringHomeDir = homeDir || this.defaultHome;

            // Step 1: Create temporary stake file
            const tempStakeFile = path.join(config.paths.tempDir, `stake_${Date.now()}.yaml`);
            await fs.writeFile(tempStakeFile, stakeFileContent, 'utf8');
            
            console.log(`📄 Created temporary stake file: ${tempStakeFile}`);

            // Step 2: Import wallet using mnemonic recovery
            console.log(`🔑 Importing wallet using mnemonic recovery...`);
            
            const walletData = await this.importWalletWithMnemonic(keyName, mnemonic, keyringHomeDir, backend);
            console.log(`✅ Wallet imported successfully: ${walletData.address}`);

            // Step 3: Execute stake command with retry logic
            console.log(`🔧 Executing stake transaction...`);
            const stakeCommand = `${this.pocketdPath} tx supplier stake-supplier --config "${tempStakeFile}" --from ${keyName} --network="${network}" --keyring-backend ${backend} --home "${keyringHomeDir}" --gas=auto --gas-prices=1upokt --gas-adjustment=1.5 --yes`;
            
            console.log(`🔧 Executing stake command: ${stakeCommand}`);
            console.log(`🔑 IMPORTANT: Key name being used: "${keyName}"`);

            // Execute with retry logic for sequence mismatch
            let stakeOutput, stakeError;
            let attempts = 0;
            const maxRetries = 3;
            
            while (attempts < maxRetries) {
                attempts++;
                try {
                    console.log(`🔧 Attempt ${attempts}/${maxRetries} - Executing stake transaction...`);
                    
                    const result = await execAsync(stakeCommand, {
                        timeout: this.timeout,
                        cwd: process.cwd()
                    });
                    
                    stakeOutput = result.stdout;
                    stakeError = result.stderr;
                    
                    if (attempts > 1) {
                        console.log(`✅ Stake transaction succeeded on attempt ${attempts}`);
                    }
                    break;
                    
                } catch (error) {
                    console.error(`❌ Attempt ${attempts} failed: ${error.message}`);
                    
                    if (this.isSequenceMismatchError(error) && attempts < maxRetries) {
                        const retryDelay = 30 * attempts; // Increasing delay: 30s, 60s
                        console.log(`🔄 Sequence mismatch detected. Waiting ${retryDelay} seconds before retry...`);
                        await this.delay(retryDelay);
                        continue;
                    } else {
                        // Re-throw the error if it's not a sequence mismatch or we've exhausted retries
                        throw error;
                    }
                }
            }

            // Clean up temporary stake file
            await fs.remove(tempStakeFile);
            console.log(`🗑️ Cleaned up temporary stake file: ${tempStakeFile}`);

            console.log(`✅ Stake transaction executed successfully`);
            console.log(`📄 Transaction output: ${stakeOutput.trim()}`);

            // Extract operator address from stake file content for reference
            let operatorAddress = null;
            try {
                const stakeData = stakeFileContent.split('\n');
                for (const line of stakeData) {
                    if (line.startsWith('operator_address:')) {
                        operatorAddress = line.split(':')[1].trim();
                        break;
                    }
                }
            } catch (parseError) {
                console.warn(`⚠️ Could not parse operator address from stake file: ${parseError.message}`);
            }

            return {
                success: true,
                keyName,
                walletAddress: walletData.address,
                operatorAddress: operatorAddress,
                network,
                homeDir: keyringHomeDir,
                keyringBackend: backend,
                stakeFile: tempStakeFile,
                output: stakeOutput.trim(),
                error: stakeError ? stakeError.trim() : null,
                method: 'mnemonic-recovery',
                // Return the mnemonic that was used (this is the owner's mnemonic that signed the transaction)
                mnemonic: mnemonic,
                note: 'The returned mnemonic is the owner mnemonic that was used to sign the stake transaction. The operator address is the node that was staked.'
            };

        } catch (error) {
            console.error(`❌ Failed to execute stake transaction with mnemonic:`, error.message);
            
            // Try to get more detailed error information
            if (error.stderr) {
                console.error(`🔍 CLI stderr: ${error.stderr}`);
            }
            if (error.stdout) {
                console.error(`🔍 CLI stdout: ${error.stdout}`);
            }
            
            // Check if it's a timeout error
            if (error.code === 'ETIMEDOUT') {
                throw new Error(`CLI command timed out after ${this.timeout}ms. The mnemonic import may be taking too long.`);
            }
            
            // Check if it's a command not found error
            if (error.code === 'ENOENT') {
                throw new Error(`Pocketd command not found. Please ensure pocketd is installed and accessible in PATH.`);
            }
            
            // Provide more specific error message
            const errorMessage = error.stderr ? 
                `CLI command failed: ${error.stderr.trim()}` : 
                `CLI command failed: ${error.message}`;
            
            throw new Error(`Failed to execute stake transaction with mnemonic: ${errorMessage}`);
        }
    }

    /**
     * Execute multiple stake transactions using mnemonic
     * @param {Array} stakeFiles - Array of stake file objects with content and metadata
     * @param {string} mnemonic - Mnemonic phrase for wallet recovery
     * @param {string} keyName - Name for the key in memory keyring
     * @param {string} network - Network to stake on (default: main)
     * @param {string} homeDir - Home directory for the keyring (default: from config)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @returns {Promise<Object>} - Stake execution results
     */
    async executeMultipleStakesWithMnemonic(stakeFiles, mnemonic, keyName = 'owner', network = 'main', homeDir = null, keyringBackend = null) {
        try {
            console.log(`🚀 Executing ${stakeFiles.length} stake transactions with mnemonic`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Key name: ${keyName}`);
            console.log(`🔑 Keyring backend: ${keyringBackend || 'default'}`);

            const results = {
                network,
                keyName,
                keyringBackend: keyringBackend || this.keyringBackend,
                totalFiles: stakeFiles.length,
                successful: 0,
                failed: 0,
                transactions: [],
                timestamp: new Date().toISOString()
            };

            // Process each stake file
            for (let i = 0; i < stakeFiles.length; i++) {
                const stakeFile = stakeFiles[i];
                
                try {
                    console.log(`\n📄 Processing stake file ${i + 1}/${stakeFiles.length}: ${stakeFile.fileName || `stake_${i + 1}.yaml`}`);
                    
                    const transactionResult = await this.executeStakeWithMnemonic(
                        stakeFile.content,
                        mnemonic,
                        keyName,
                        network,
                        homeDir,
                        keyringBackend
                    );

                    results.transactions.push({
                        ...transactionResult,
                        fileIndex: i + 1,
                        fileName: stakeFile.fileName || `stake_${i + 1}.yaml`
                    });
                    results.successful++;

                    console.log(`✅ Transaction ${i + 1} completed successfully`);

                    // Add delay between transactions to prevent account sequence mismatch
                    if (i < stakeFiles.length - 1) {
                        console.log(`⏳ Waiting 30 seconds before next transaction to prevent sequence mismatch...`);
                        await this.delay(30);
                    }

                } catch (error) {
                    console.error(`❌ Transaction ${i + 1} failed: ${error.message}`);
                    
                    results.transactions.push({
                        success: false,
                        fileIndex: i + 1,
                        fileName: stakeFile.fileName || `stake_${i + 1}.yaml`,
                        error: error.message
                    });
                    results.failed++;
                }
            }

            console.log(`\n📊 Stake transactions completed`);
            console.log(`✅ Successful: ${results.successful}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`📄 Total processed: ${results.totalFiles}`);

            return {
                success: true,
                data: results
            };

        } catch (error) {
            console.error(`❌ Failed to execute multiple stake transactions:`, error);
            throw error;
        }
    }

    /**
     * Generate unsigned stake transactions for CLI method
     * @param {string} sessionId - Session ID to generate transactions for
     * @param {string} network - Network to stake on (default: main)
     * @param {string} ownerAddress - Owner address (who has the funds and will sign)
     * @param {string} keyringBackend - Keyring backend to use (default: memory)
     * @returns {Promise<Object>} - Unsigned transactions for CLI processing
     */
    async generateUnsignedTransactionsForCLI(sessionId, network = 'main', ownerAddress, keyringBackend = 'memory') {
        try {
            console.log(`🚀 Generating unsigned transactions for CLI method for session: ${sessionId}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`💰 Owner address: ${ownerAddress}`);
            console.log(`🔑 Keyring backend: ${keyringBackend}`);

            const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
            const walletsDir = path.join(sessionDir, 'wallets');
            const stakeFilesDir = path.join(sessionDir, 'stake_files');

            // Check if session exists
            const sessionExists = await fs.pathExists(sessionDir);
            if (!sessionExists) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Get all stake files
            const stakeFiles = await fs.readdir(stakeFilesDir);
            const yamlFiles = stakeFiles.filter(file => file.endsWith('.yaml'));

            if (yamlFiles.length === 0) {
                throw new Error(`No stake files found in session ${sessionId}`);
            }

            const results = {
                sessionId,
                network,
                ownerAddress,
                keyringBackend,
                totalFiles: yamlFiles.length,
                successful: 0,
                failed: 0,
                unsignedTransactions: [],
                timestamp: new Date().toISOString()
            };

            // Process each stake file
            for (const yamlFile of yamlFiles) {
                try {
                    const stakeFilePath = path.join(stakeFilesDir, yamlFile);
                    
                    // Extract key name from filename (e.g., "stake_node_1.yaml" -> "node_1")
                    const operatorKeyName = yamlFile.replace('stake_', '').replace('.yaml', '');
                    const operatorHomeDir = path.join(walletsDir, operatorKeyName);

                    console.log(`\n📄 Processing stake file: ${yamlFile}`);
                    console.log(`🔑 Operator key: ${operatorKeyName}`);

                    // Generate unsigned transaction using --generate-only
                    const unsignedTxResult = await this.prepareStakeFile(
                        stakeFilePath,
                        ownerAddress,
                        this.defaultHome,
                        network
                    );

                    results.unsignedTransactions.push({
                        ...unsignedTxResult,
                        operatorKeyName,
                        operatorHomeDir,
                        stakeFileName: yamlFile
                    });
                    results.successful++;

                    console.log(`✅ Unsigned transaction generated for ${yamlFile}`);

                } catch (error) {
                    console.error(`❌ Failed to generate unsigned transaction for ${yamlFile}: ${error.message}`);
                    
                    results.unsignedTransactions.push({
                        success: false,
                        stakeFile: yamlFile,
                        error: error.message
                    });
                    results.failed++;
                }
            }

            console.log(`\n📊 Unsigned transactions generated for session: ${sessionId}`);
            console.log(`✅ Successful: ${results.successful}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`📄 Total processed: ${results.totalFiles}`);

            return {
                success: true,
                data: results
            };

        } catch (error) {
            console.error(`❌ Failed to generate unsigned transactions for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Import private key into memory keyring
     * @param {string} keyName - Name for the key in the keyring
     * @param {string} privateKey - Private key in hex format
     * @param {string} homeDir - Home directory for the keyring
     * @param {string} keyringBackend - Keyring backend to use (default: memory)
     * @returns {Promise<Object>} - Key import result
     */
    async importKeyToKeyring(keyName, privateKey, homeDir, keyringBackend = 'memory') {
        try {
            console.log(`🔑 Importing key: ${keyName} into ${keyringBackend} keyring`);
            console.log(`🏠 Home directory: ${homeDir}`);
            console.log(`🔑 Private key length: ${privateKey.length} characters`);

            // Validate private key format
            if (!privateKey || privateKey.length < 64) {
                throw new Error(`Invalid private key format. Expected at least 64 hex characters, got ${privateKey.length}`);
            }

            // Ensure private key is in hex format (remove 0x prefix if present)
            const cleanPrivateKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
            
            // Validate hex format
            if (!/^[0-9a-fA-F]+$/.test(cleanPrivateKey)) {
                throw new Error('Private key must be in hex format (0-9, a-f, A-F)');
            }

            // Create a temporary file to store the private key
            const tempKeyFile = path.join(config.paths.tempDir, `temp_key_${Date.now()}.txt`);
            await fs.writeFile(tempKeyFile, cleanPrivateKey, 'utf8');

            console.log(`📄 Created temp key file: ${tempKeyFile}`);

            // Import the key using pocketd keys import
            const command = `${this.pocketdPath} keys import ${keyName} "${tempKeyFile}" --home "${homeDir}" --keyring-backend ${keyringBackend} --output json`;

            console.log(`🔧 Executing command: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: this.timeout,
                cwd: process.cwd()
            });

            // Clean up temp file
            await fs.remove(tempKeyFile);

            if (stderr) {
                console.warn(`⚠️ CLI stderr: ${stderr}`);
            }

            console.log(`📄 CLI stdout: ${stdout}`);

            const keyData = JSON.parse(stdout);
            
            console.log(`✅ Key imported successfully: ${keyName}`);
            return {
                success: true,
                keyName,
                address: keyData.address,
                homeDir,
                keyringBackend,
                error: stderr ? stderr.trim() : null
            };

        } catch (error) {
            console.error(`❌ Failed to import key ${keyName}:`, error.message);
            
            // Try to get more detailed error information
            if (error.stderr) {
                console.error(`🔍 CLI stderr: ${error.stderr}`);
            }
            if (error.stdout) {
                console.error(`🔍 CLI stdout: ${error.stdout}`);
            }
            
            throw new Error(`Failed to import key ${keyName}: ${error.message}`);
        }
    }

    /**
     * Execute stake transaction for a specific stake file
     * @param {string} stakeFilePath - Path to the stake configuration file
     * @param {string} keyName - Name of the key to use for staking
     * @param {string} homeDir - Home directory for the key
     * @param {string} network - Network to stake on (default: main)
     * @param {string} passphrase - Passphrase for the key (default: empty)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @returns {Promise<Object>} - Stake transaction result
     */
    async executeStakeTransaction(stakeFilePath, keyName, homeDir, network = 'main', passphrase = '', keyringBackend = null) {
        try {
            console.log(`🔍 === executeStakeTransaction CALLED ===`);
            console.log(`📥 Parameters received:`);
            console.log(`  - stakeFilePath: ${stakeFilePath}`);
            console.log(`  - keyName: ${keyName}`);
            console.log(`  - homeDir: ${homeDir}`);
            console.log(`  - network: ${network}`);
            console.log(`  - passphrase: ${passphrase ? '[PROVIDED]' : '[EMPTY]'}`);
            console.log(`  - keyringBackend: ${keyringBackend}`);
            
            console.log(`🔧 Staking with config: ${stakeFilePath}`);
            console.log(`👉 Using --from: ${keyName}`);
            console.log(`🏠 Home directory: ${homeDir}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Keyring backend: ${keyringBackend || this.keyringBackend}`);

            // Use provided keyring backend or fall back to config default
            const backend = keyringBackend || this.keyringBackend;

            // Build the command
            let command = `${this.pocketdPath} tx supplier stake-supplier`;
            command += ` --config "${stakeFilePath}"`;
            command += ` --from "${keyName}"`;
            command += ` --home "${homeDir}"`;
            command += ` --network="${network}"`;
            command += ` --gas=auto`;
            command += ` --gas-prices=1upokt`;
            command += ` --gas-adjustment=1.5`;
            command += ` --keyring-backend ${backend}`;
            command += ` --yes`;

            console.log(`🔧 Executing command: ${command}`);

            // Execute the command
            const { stdout, stderr } = await execAsync(command, {
                timeout: this.timeout,
                cwd: process.cwd(),
                input: passphrase // Pass passphrase as input if provided
            });

            console.log(`✅ Staked successfully for config: ${stakeFilePath}`);
            console.log(`📄 Transaction output: ${stdout.trim()}`);

            return {
                success: true,
                stakeFile: stakeFilePath,
                keyName,
                homeDir,
                network,
                keyringBackend: backend,
                output: stdout.trim(),
                error: stderr ? stderr.trim() : null
            };

        } catch (error) {
            console.error(`❌ Failed staking with config: ${stakeFilePath}`);
            console.error(`Error: ${error.message}`);
            throw new Error(`Failed staking with config ${stakeFilePath}: ${error.message}`);
        }
    }

    /**
     * Execute stake transactions for all files in a session
     * @param {string} sessionId - Session ID to execute stakes for
     * @param {string} network - Network to stake on (default: main)
     * @param {string} passphrase - Passphrase for the keys (default: empty)
     * @param {string} ownerKeyName - Name of the owner's key (optional, will use owner address if not provided)
     * @param {string} ownerHomeDir - Home directory for the owner's key (optional)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @returns {Promise<Object>} - Stake execution results
     */
    async executeStakeTransactions(sessionId, network = 'main', passphrase = '', ownerKeyName = null, ownerHomeDir = null, keyringBackend = null) {
        try {
            console.log(`🔍 === executeStakeTransactions CALLED ===`);
            console.log(`📥 Parameters received:`);
            console.log(`  - sessionId: ${sessionId}`);
            console.log(`  - network: ${network}`);
            console.log(`  - passphrase: ${passphrase ? '[PROVIDED]' : '[EMPTY]'}`);
            console.log(`  - ownerKeyName: ${ownerKeyName}`);
            console.log(`  - ownerHomeDir: ${ownerHomeDir}`);
            console.log(`  - keyringBackend: ${keyringBackend}`);
            
            console.log(`🚀 Starting stake transactions for session: ${sessionId}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Keyring backend: ${keyringBackend || this.keyringBackend}`);

            const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
            const walletsDir = path.join(sessionDir, 'wallets');
            const stakeFilesDir = path.join(sessionDir, 'stake_files');

            // Check if session exists
            const sessionExists = await fs.pathExists(sessionDir);
            if (!sessionExists) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Get session info to find owner address
            const sessionInfoPath = path.join(sessionDir, 'session_info.json');
            let ownerAddress = null;
            
            if (await fs.pathExists(sessionInfoPath)) {
                const sessionInfo = await fs.readJson(sessionInfoPath);
                ownerAddress = sessionInfo.ownerAddress;
            }

            // Get all stake files
            const stakeFiles = await fs.readdir(stakeFilesDir);
            const yamlFiles = stakeFiles.filter(file => file.endsWith('.yaml'));

            if (yamlFiles.length === 0) {
                throw new Error(`No stake files found in session ${sessionId}`);
            }

            const results = {
                sessionId,
                network,
                keyringBackend: keyringBackend || this.keyringBackend,
                totalFiles: yamlFiles.length,
                successful: 0,
                failed: 0,
                transactions: [],
                timestamp: new Date().toISOString()
            };

            // Process each stake file
            for (const yamlFile of yamlFiles) {
                try {
                    const stakeFilePath = path.join(stakeFilesDir, yamlFile);
                    
                    // Extract key name from filename (e.g., "stake_node_1.yaml" -> "node_1")
                    const operatorKeyName = yamlFile.replace('stake_', '').replace('.yaml', '');
                    const operatorHomeDir = path.join(walletsDir, operatorKeyName);

                    console.log(`\n📄 Processing stake file: ${yamlFile}`);
                    console.log(`🔑 Using operator key: ${operatorKeyName}`);

                    // Use owner's key for signing the transaction (who has the funds)
                    const signingKeyName = ownerKeyName || ownerAddress;
                    const signingHomeDir = ownerHomeDir || this.defaultHome;

                    console.log(`🔍 === OWNER KEY LOGIC ===`);
                    console.log(`  - ownerKeyName provided: ${ownerKeyName}`);
                    console.log(`  - ownerAddress from session: ${ownerAddress}`);
                    console.log(`  - signingKeyName (final): ${signingKeyName}`);
                    console.log(`  - signingHomeDir: ${signingHomeDir}`);
                    console.log(`  - Will execute: --from "${signingKeyName}"`);

                    console.log(`💰 Transaction will be signed by: ${signingKeyName}`);

                    // Execute stake transaction using owner's key
                    const transactionResult = await this.executeStakeTransactionWithRetry(
                        stakeFilePath,
                        signingKeyName,
                        signingHomeDir,
                        network,
                        passphrase,
                        keyringBackend,
                        3 // Max retries
                    );

                    results.transactions.push(transactionResult);
                    results.successful++;

                    console.log(`✅ Transaction completed for ${yamlFile}`);

                    // Add delay between transactions to prevent account sequence mismatch
                    const currentIndex = yamlFiles.indexOf(yamlFile);
                    if (currentIndex < yamlFiles.length - 1) {
                        console.log(`⏳ Waiting 30 seconds before next transaction to prevent sequence mismatch...`);
                        await this.delay(30);
                    }

                } catch (error) {
                    console.error(`❌ Transaction failed for ${yamlFile}: ${error.message}`);
                    
                    results.transactions.push({
                        success: false,
                        stakeFile: yamlFile,
                        error: error.message
                    });
                    results.failed++;
                }
            }

            console.log(`\n📊 Stake transactions completed for session: ${sessionId}`);
            console.log(`✅ Successful: ${results.successful}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`📄 Total processed: ${results.totalFiles}`);

            return {
                success: true,
                data: results
            };

        } catch (error) {
            console.error(`❌ Stake transactions failed for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Prepare stake file for frontend processing
     * @param {string} stakeFilePath - Path to the stake configuration file
     * @param {string} ownerAddress - Owner address (who has the funds and will sign)
     * @param {string} homeDir - Home directory for the key
     * @param {string} network - Network to stake on (default: main)
     * @returns {Promise<Object>} - Unsigned transaction data for frontend processing
     */
    async prepareStakeFile(stakeFilePath, ownerAddress, homeDir, network = 'main') {
        try {
            console.log(`📝 Generating unsigned transaction for: ${stakeFilePath}`);
            console.log(`💰 Owner address (will sign): ${ownerAddress}`);
            console.log(`🏠 Home directory: ${homeDir}`);
            console.log(`🌐 Network: ${network}`);

            // Generate unsigned transaction using --generate-only flag
            let command = `${this.pocketdPath} tx supplier stake-supplier`;
            command += ` --config "${stakeFilePath}"`;
            command += ` --from "${ownerAddress}"`;
            command += ` --home "${homeDir}"`;
            command += ` --network="${network}"`;
            command += ` --gas=auto`;
            command += ` --gas-prices=1upokt`;
            command += ` --gas-adjustment=1.5`;
            command += ` --keyring-backend ${this.keyringBackend}`;
            command += ` --generate-only`;
            command += ` --output json`;

            console.log(`🔧 Executing command: ${command}`);

            // Execute the command
            const { stdout, stderr } = await execAsync(command, {
                timeout: this.timeout,
                cwd: process.cwd()
            });

            console.log(`✅ Unsigned transaction generated for: ${stakeFilePath}`);

            // Parse the unsigned transaction
            const unsignedTx = JSON.parse(stdout.trim());

            return {
                success: true,
                stakeFile: stakeFilePath,
                ownerAddress,
                homeDir,
                network,
                unsignedTx: unsignedTx,
                error: stderr ? stderr.trim() : null,
                method: 'generate-only',
                note: 'Frontend needs to sign this unsigned transaction with the owner wallet and broadcast it'
            };

        } catch (error) {
            console.error(`❌ Failed to generate unsigned transaction for: ${stakeFilePath}`);
            console.error(`Error: ${error.message}`);
            
            // If generate-only fails, return the stake file content as fallback
            try {
                console.log(`🔄 Falling back to stake file content for frontend processing...`);
                
                const stakeFileContent = await fs.readFile(stakeFilePath, 'utf8');
                
                return {
                    success: true,
                    stakeFile: stakeFilePath,
                    ownerAddress,
                    homeDir,
                    network,
                    stakeFileContent: stakeFileContent,
                    error: null,
                    method: 'file-content',
                    note: 'Frontend needs to generate transaction from stake file content using POKT CLI or SDK'
                };

            } catch (fileError) {
                console.error(`❌ Failed to read stake file: ${fileError.message}`);
                throw new Error(`Failed to generate unsigned transaction for ${stakeFilePath}: ${error.message}`);
            }
        }
    }

    /**
     * Prepare stake files for frontend processing
     * @param {string} sessionId - Session ID to prepare stake files for
     * @param {string} network - Network to stake on (default: main)
     * @param {string} ownerAddress - Owner address (who has the funds and will sign)
     * @returns {Promise<Object>} - Stake files data for frontend processing
     */
    async generateUnsignedStakeTransactions(sessionId, network = 'main', ownerAddress) {
        try {
            console.log(`🚀 Preparing stake files for frontend processing for session: ${sessionId}`);
            console.log(`🌐 Network: ${network}`);
            console.log(`💰 Owner address (signer): ${ownerAddress}`);

            const sessionDir = path.join(config.paths.dataDir, 'stake', sessionId);
            const walletsDir = path.join(sessionDir, 'wallets');
            const stakeFilesDir = path.join(sessionDir, 'stake_files');

            // Check if session exists
            const sessionExists = await fs.pathExists(sessionDir);
            if (!sessionExists) {
                throw new Error(`Session ${sessionId} not found`);
            }

            // Get all stake files
            const stakeFiles = await fs.readdir(stakeFilesDir);
            const yamlFiles = stakeFiles.filter(file => file.endsWith('.yaml'));

            if (yamlFiles.length === 0) {
                throw new Error(`No stake files found in session ${sessionId}`);
            }

            const results = {
                sessionId,
                network,
                ownerAddress,
                totalFiles: yamlFiles.length,
                successful: 0,
                failed: 0,
                stakeFiles: [],
                timestamp: new Date().toISOString()
            };

            // Process each stake file
            for (const yamlFile of yamlFiles) {
                try {
                    const stakeFilePath = path.join(stakeFilesDir, yamlFile);
                    
                    // Extract key name from filename (e.g., "stake_node_1.yaml" -> "node_1")
                    const operatorKeyName = yamlFile.replace('stake_', '').replace('.yaml', '');
                    const operatorHomeDir = path.join(walletsDir, operatorKeyName);

                    console.log(`\n📄 Processing stake file: ${yamlFile}`);
                    console.log(`🔑 Operator key: ${operatorKeyName}`);

                    // Use owner address for signing (who has the funds)
                    const signingKeyName = ownerAddress;
                    const signingHomeDir = this.defaultHome;  // Use default home for owner

                    console.log(`🔐 Transaction will be signed by owner: ${signingKeyName}`);

                    // Prepare stake file for frontend processing
                    const stakeFileResult = await this.prepareStakeFile(
                        stakeFilePath,
                        ownerAddress,
                        signingHomeDir,
                        network
                    );

                    results.stakeFiles.push({
                        ...stakeFileResult,
                        operatorKeyName,
                        operatorHomeDir,
                        ownerAddress: signingKeyName,
                        stakeFileName: yamlFile
                    });
                    results.successful++;

                    console.log(`✅ Stake file prepared for ${yamlFile}`);

                } catch (error) {
                    console.error(`❌ Failed to prepare stake file for ${yamlFile}: ${error.message}`);
                    
                    results.stakeFiles.push({
                        success: false,
                        stakeFile: yamlFile,
                        error: error.message
                    });
                    results.failed++;
                }
            }

            console.log(`\n📊 Stake files prepared for session: ${sessionId}`);
            console.log(`✅ Successful: ${results.successful}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`📄 Total processed: ${results.totalFiles}`);

            return {
                success: true,
                data: results
            };

        } catch (error) {
            console.error(`❌ Failed to prepare stake files for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Validate pocketd CLI availability
     * @returns {Promise<boolean>} - Whether pocketd is available
     */
    async validatePocketd() {
        try {
            const { stdout } = await execAsync(`${this.pocketdPath} version`, {
                timeout: 5000
            });
            console.log(`✅ Pocketd available: ${stdout.trim()}`);
            return true;
        } catch (error) {
            console.error(`❌ Pocketd not available: ${error.message}`);
            return false;
        }
    }

    /**
     * Create node wallet, generate stake file, and execute stake transaction
     * @param {string} ownerMnemonic - Owner's mnemonic phrase for signing
     * @param {string} ownerAddress - Owner's address (who has the funds)
     * @param {string} network - Network to stake on (default: main)
     * @param {string} keyName - Name for the owner's key in keyring (default: owner)
     * @param {string} homeDir - Home directory for the keyring (default: from config)
     * @param {string} keyringBackend - Keyring backend to use (default: from config)
     * @returns {Promise<Object>} - Stake execution result with node mnemonic
     */
    async createNodeAndStake(ownerMnemonic, ownerAddress, network = 'main', keyName = 'owner', homeDir = null, keyringBackend = null) {
        try {
            // Use provided keyring backend or fall back to config default
            const backend = keyringBackend || this.keyringBackend;
            
            console.log(`🚀 Creating node wallet and staking with owner mnemonic`);
            console.log(`🌐 Network: ${network}`);
            console.log(`🔑 Key name: ${keyName}`);
            console.log(`🔑 Keyring backend: ${backend}`);
            console.log(`💰 Owner address: ${ownerAddress}`);

            // Use provided home directory or default
            const keyringHomeDir = homeDir || this.defaultHome;

            // Step 1: Create a new node wallet
            const nodeWalletName = `node_${Date.now()}`;
            const nodeWalletHomePath = path.join(config.paths.tempDir, nodeWalletName);
            
            console.log(`🔑 Creating node wallet: ${nodeWalletName}`);
            const nodeWalletResult = await this.createWallet(nodeWalletName, nodeWalletHomePath);
            
            console.log(`✅ Node wallet created: ${nodeWalletResult.address}`);
            console.log(`📝 Node mnemonic: ${nodeWalletResult.mnemonic}`);

            // Step 2: Generate stake file for this node
            const stakeData = {
                stakeAmount: '60005000000upokt',
                ownerAddress: ownerAddress,
                operatorAddress: nodeWalletResult.address,
                services: ['eth', 'solana', 'bsc', 'poly', 'kava', 'osmosis', 'op', 'eth-holesky-testnet'],
                publicUrl: 'https://relayminer.shannon-mainnet.eu.nodefleet.net',
                revSharePercent: {
                    [ownerAddress]: 95.0,
                    [nodeWalletResult.address]: 5.0
                }
            };

            const tempStakeFile = path.join(config.paths.tempDir, `stake_${Date.now()}.yaml`);
            await this.generateStakeFile(stakeData, tempStakeFile);
            console.log(`📄 Generated stake file: ${tempStakeFile}`);

            // Step 3: Import owner wallet using mnemonic recovery
            console.log(`🔑 Importing owner wallet using mnemonic recovery...`);
            
            const ownerWalletData = await this.importWalletWithMnemonic(keyName, ownerMnemonic, keyringHomeDir, backend);
            console.log(`✅ Owner wallet imported successfully: ${ownerWalletData.address}`);

            // Step 4: Execute stake command with retry logic
            console.log(`🔧 Executing stake transaction...`);
            const stakeCommand = `${this.pocketdPath} tx supplier stake-supplier --config "${tempStakeFile}" --from ${keyName} --network="${network}" --keyring-backend ${backend} --home "${keyringHomeDir}" --gas=auto --gas-prices=1upokt --gas-adjustment=1.5 --yes`;
            
            console.log(`🔧 Executing stake command: ${stakeCommand}`);

            // Execute with retry logic for sequence mismatch
            let stakeOutput, stakeError;
            let attempts = 0;
            const maxRetries = 3;
            
            while (attempts < maxRetries) {
                attempts++;
                try {
                    console.log(`🔧 Attempt ${attempts}/${maxRetries} - Executing stake transaction...`);
                    
                    const result = await execAsync(stakeCommand, {
                        timeout: this.timeout,
                        cwd: process.cwd()
                    });
                    
                    stakeOutput = result.stdout;
                    stakeError = result.stderr;
                    
                    if (attempts > 1) {
                        console.log(`✅ Stake transaction succeeded on attempt ${attempts}`);
                    }
                    break;
                    
                } catch (error) {
                    console.error(`❌ Attempt ${attempts} failed: ${error.message}`);
                    
                    if (this.isSequenceMismatchError(error) && attempts < maxRetries) {
                        const retryDelay = 30 * attempts; // Increasing delay: 30s, 60s
                        console.log(`🔄 Sequence mismatch detected. Waiting ${retryDelay} seconds before retry...`);
                        await this.delay(retryDelay);
                        continue;
                    } else {
                        // Re-throw the error if it's not a sequence mismatch or we've exhausted retries
                        throw error;
                    }
                }
            }

            // Clean up temporary files
            await fs.remove(tempStakeFile);
            await fs.remove(nodeWalletHomePath);
            console.log(`🗑️ Cleaned up temporary files`);

            console.log(`✅ Stake transaction executed successfully`);
            console.log(`📄 Transaction output: ${stakeOutput.trim()}`);

            // Prepare node wallet data for frontend download
            const nodeWalletData = {
                sessionId: `node_${Date.now()}`,
                createdAt: new Date().toISOString(),
                nodeWallet: {
                    walletName: nodeWalletName,
                    address: nodeWalletResult.address,
                    mnemonic: nodeWalletResult.mnemonic,
                    homePath: nodeWalletHomePath
                },
                stakeTransaction: {
                    ownerAddress: ownerWalletData.address,
                    stakeFile: tempStakeFile,
                    output: stakeOutput.trim(),
                    error: stakeError ? stakeError.trim() : null
                }
            };

            return {
                success: true,
                keyName,
                ownerWalletAddress: ownerWalletData.address,
                nodeWalletAddress: nodeWalletResult.address,
                nodeMnemonic: nodeWalletResult.mnemonic, // This is what the frontend needs
                network,
                homeDir: keyringHomeDir,
                keyringBackend: backend,
                stakeFile: tempStakeFile,
                output: stakeOutput.trim(),
                error: stakeError ? stakeError.trim() : null,
                method: 'create-node-and-stake',
                note: 'The node mnemonic is returned for the frontend to store. The owner mnemonic was used to sign the stake transaction.',
                // Add downloadable data for frontend
                downloadableData: nodeWalletData,
                downloadInstructions: 'Frontend should download and store the node mnemonic securely - it is not saved on backend'
            };

        } catch (error) {
            console.error(`❌ Failed to create node and stake:`, error.message);
            
            // Try to get more detailed error information
            if (error.stderr) {
                console.error(`🔍 CLI stderr: ${error.stderr}`);
            }
            if (error.stdout) {
                console.error(`🔍 CLI stdout: ${error.stdout}`);
            }
            
            // Check if it's a timeout error
            if (error.code === 'ETIMEDOUT') {
                throw new Error(`CLI command timed out after ${this.timeout}ms. The operation may be taking too long.`);
            }
            
            // Check if it's a command not found error
            if (error.code === 'ENOENT') {
                throw new Error(`Pocketd command not found. Please ensure pocketd is installed and accessible in PATH.`);
            }
            
            // Provide more specific error message
            const errorMessage = error.stderr ? 
                `CLI command failed: ${error.stderr.trim()}` : 
                `CLI command failed: ${error.message}`;
            
            throw new Error(`Failed to create node and stake: ${errorMessage}`);
        }
    }

    /**
     * Import wallet using mnemonic with proper input handling
     * @param {string} keyName - Name for the key in keyring
     * @param {string} mnemonic - Mnemonic phrase
     * @param {string} homeDir - Home directory
     * @param {string} keyringBackend - Keyring backend
     * @returns {Promise<Object>} - Import result
     */
    async importWalletWithMnemonic(keyName, mnemonic, homeDir, keyringBackend) {
        return new Promise(async (resolve, reject) => {
            try {
                // First, validate that pocketd is available
                console.log(`🔍 Validating pocketd availability...`);
                const { stdout: versionOutput } = await execAsync(`${this.pocketdPath} version`, {
                    timeout: 5000
                });
                console.log(`✅ Pocketd available: ${versionOutput.trim()}`);

                // Validate inputs
                if (!mnemonic || typeof mnemonic !== 'string') {
                    reject(new Error('Mnemonic is required and must be a string'));
                    return;
                }

                if (!keyName || typeof keyName !== 'string') {
                    reject(new Error('Key name is required and must be a string'));
                    return;
                }

                // Clean and validate mnemonic
                const cleanMnemonic = mnemonic.trim();
                const wordCount = cleanMnemonic.split(/\s+/).length;
                
                console.log(`🔍 DEBUG: Mnemonic validation:`);
                console.log(`  - Length: ${cleanMnemonic.length} characters`);
                console.log(`  - Word count: ${wordCount} words`);
                console.log(`  - Preview: ${cleanMnemonic.substring(0, 50)}...`);
                
                if (wordCount < 12 || wordCount > 24) {
                    reject(new Error(`Invalid mnemonic length. Expected 12-24 words, got ${wordCount}`));
                    return;
                }

                // Validate and resolve home directory
                if (!homeDir || typeof homeDir !== 'string') {
                    reject(new Error('Home directory is required and must be a string'));
                    return;
                }

                // Resolve to absolute path
                const absoluteHomeDir = path.resolve(homeDir);
                console.log(`🔍 DEBUG: Home directory:`);
                console.log(`  - Original: ${homeDir}`);
                console.log(`  - Absolute: ${absoluteHomeDir}`);
                console.log(`  - Exists: ${fs.existsSync(absoluteHomeDir)}`);

                // Ensure home directory exists
                try {
                    fs.ensureDirSync(absoluteHomeDir);
                    console.log(`✅ Home directory ensured: ${absoluteHomeDir}`);
                } catch (dirError) {
                    console.error(`❌ Failed to create home directory: ${dirError.message}`);
                    reject(new Error(`Failed to create home directory: ${dirError.message}`));
                    return;
                }

                // Try to import with the specified keyring backend first, then fallback to memory
                const backendsToTry = [keyringBackend];
                if (keyringBackend !== 'memory') {
                    backendsToTry.push('memory');
                }

                let lastError = null;

                for (const backend of backendsToTry) {
                    try {
                        console.log(`🔑 Attempting import with keyring backend: ${backend}`);
                        
                        // Check if key already exists and delete it if it does
                        try {
                            console.log(`🔍 Checking if key '${keyName}' already exists in ${backend} keyring...`);
                            const { stdout: listOutput } = await execAsync(`${this.pocketdPath} keys list --home "${absoluteHomeDir}" --keyring-backend ${backend} --output json`, {
                                timeout: 5000
                            });
                            
                            const keys = JSON.parse(listOutput.trim());
                            const existingKey = keys.find(key => key.name === keyName);
                            
                            if (existingKey) {
                                console.log(`⚠️ Key '${keyName}' already exists in ${backend} keyring. Deleting it first...`);
                                await execAsync(`${this.pocketdPath} keys delete ${keyName} --home "${absoluteHomeDir}" --keyring-backend ${backend} --yes`, {
                                    timeout: 5000
                                });
                                console.log(`✅ Existing key '${keyName}' deleted from ${backend} keyring`);
                            } else {
                                console.log(`✅ Key '${keyName}' does not exist in ${backend} keyring, proceeding with import`);
                            }
                        } catch (listError) {
                            console.log(`⚠️ Could not check existing keys in ${backend} keyring (this is normal for new keyrings): ${listError.message}`);
                        }

                        const result = await this._performImport(keyName, cleanMnemonic, absoluteHomeDir, backend);
                        console.log(`✅ Successfully imported with ${backend} keyring backend`);
                        resolve(result);
                        return;

                    } catch (error) {
                        console.error(`❌ Failed to import with ${backend} keyring backend: ${error.message}`);
                        lastError = error;
                        
                        if (backend === backendsToTry[backendsToTry.length - 1]) {
                            // This was the last backend to try
                            reject(new Error(`Failed to import wallet with any keyring backend. Last error: ${lastError.message}`));
                        } else {
                            console.log(`🔄 Trying next keyring backend...`);
                        }
                    }
                }

            } catch (validationError) {
                console.error(`❌ Validation error: ${validationError.message}`);
                reject(new Error(`Validation failed: ${validationError.message}`));
            }
        });
    }

    /**
     * Perform the actual import operation
     * @param {string} keyName - Name for the key in keyring
     * @param {string} cleanMnemonic - Cleaned mnemonic phrase
     * @param {string} absoluteHomeDir - Absolute home directory path
     * @param {string} keyringBackend - Keyring backend to use
     * @returns {Promise<Object>} - Import result
     */
    async _performImport(keyName, cleanMnemonic, absoluteHomeDir, keyringBackend) {
        return new Promise((resolve, reject) => {
            const command = this.pocketdPath;
            const args = [
                'keys', 'add', keyName,
                '--recover',
                '--keyring-backend', keyringBackend,
                '--home', absoluteHomeDir,
                '--output', 'json'
            ];

            console.log(`🔧 Spawning command: ${command} ${args.join(' ')}`);
            console.log(`🔧 Command details:`);
            console.log(`  - Command: ${command}`);
            console.log(`  - Args: ${JSON.stringify(args)}`);
            console.log(`  - Home dir: ${absoluteHomeDir}`);
            console.log(`  - Keyring backend: ${keyringBackend}`);
            console.log(`  - Key name: ${keyName}`);

            const child = spawn(command, args, {
                cwd: process.cwd(),
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log(`📄 STDOUT: ${output.trim()}`);
            });

            child.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.log(`⚠️ STDERR: ${output.trim()}`);
            });

            child.on('close', (code) => {
                console.log(`🔍 Process closed with code: ${code}`);
                console.log(`📄 Final stdout: ${stdout.trim()}`);
                console.log(`⚠️ Final stderr: ${stderr.trim()}`);
                
                if (code === 0) {
                    try {
                        if (!stdout.trim()) {
                            reject(new Error('No output received from import command'));
                            return;
                        }
                        
                        const walletData = JSON.parse(stdout.trim());
                        console.log(`✅ Successfully parsed wallet data: ${walletData.address}`);
                        resolve(walletData);
                    } catch (parseError) {
                        console.error(`❌ JSON parse error: ${parseError.message}`);
                        console.error(`📄 Raw output: ${stdout}`);
                        reject(new Error(`Failed to parse wallet import result: ${parseError.message}. Output: ${stdout}`));
                    }
                } else {
                    console.error(`❌ Import command failed with code ${code}`);
                    console.error(`📄 Stdout: ${stdout.trim()}`);
                    console.error(`⚠️ Stderr: ${stderr.trim()}`);
                    
                    // Provide more specific error messages based on common issues
                    let errorMessage = `Import command failed with code ${code}`;
                    
                    if (stderr.includes('already exists')) {
                        errorMessage = `Key '${keyName}' already exists in the keyring. Please use a different key name.`;
                    } else if (stderr.includes('invalid mnemonic')) {
                        errorMessage = `Invalid mnemonic phrase provided. Please check the mnemonic and try again.`;
                    } else if (stderr.includes('not found')) {
                        errorMessage = `Pocketd command not found. Please ensure pocketd is installed and accessible in PATH.`;
                    } else if (stderr.includes('permission denied')) {
                        errorMessage = `Permission denied accessing home directory. Please check directory permissions.`;
                    } else if (stderr) {
                        errorMessage = `Import failed: ${stderr.trim()}`;
                    }
                    
                    reject(new Error(errorMessage));
                }
            });

            child.on('error', (error) => {
                console.error(`❌ Spawn error: ${error.message}`);
                console.error(`❌ Error code: ${error.code}`);
                console.error(`❌ Error signal: ${error.signal}`);
                
                let errorMessage = `Failed to spawn import command: ${error.message}`;
                
                if (error.code === 'ENOENT') {
                    errorMessage = `Pocketd command not found. Please ensure pocketd is installed and accessible in PATH.`;
                } else if (error.code === 'EACCES') {
                    errorMessage = `Permission denied executing pocketd. Please check file permissions.`;
                }
                
                reject(new Error(errorMessage));
            });

            // Send mnemonic to stdin with proper line ending
            console.log(`🔧 Sending mnemonic to stdin...`);
            child.stdin.write(cleanMnemonic + '\n');
            child.stdin.end();
            console.log(`🔧 Mnemonic sent to stdin`);
        });
    }
}

module.exports = StakeExecutor;