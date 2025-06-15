require('dotenv').config();

const config = {
    // Server configuration
    server: {
        port: process.env.PORT || 3001,
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development'
    },

    // CORS configuration
    cors: {
        allowedOrigins: process.env.ALLOWED_ORIGINS ?
            process.env.ALLOWED_ORIGINS.split(',') :
            ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true
    },

    // Pocket CLI configuration
    pocketd: {
        command: process.env.POCKETD_COMMAND || 'pocketd',
        defaultHome: process.env.POCKETD_HOME || './localnet/pocketd',
        defaultKeyringBackend: process.env.POCKETD_KEYRING_BACKEND || 'test',
        timeout: parseInt(process.env.POCKETD_TIMEOUT) || 60000, // 60 seconds
        maxRetries: parseInt(process.env.POCKETD_MAX_RETRIES) || 3
    },

    // Migration settings
    migration: {
        maxConcurrentMigrations: parseInt(process.env.MAX_CONCURRENT_MIGRATIONS) || 1,
        sessionTimeout: parseInt(process.env.MIGRATION_SESSION_TIMEOUT) || 3600000, // 1 hour
        cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 300000, // 5 minutes
        maxWalletsPerRequest: parseInt(process.env.MAX_WALLETS_PER_REQUEST) || 10,
        tempFileRetention: parseInt(process.env.TEMP_FILE_RETENTION) || 3600000 // 1 hour
    },

    // File system paths
    paths: {
        dataDir: process.env.DATA_DIR || './data',
        inputDir: process.env.INPUT_DIR || './data/input',
        outputDir: process.env.OUTPUT_DIR || './data/output',
        tempDir: process.env.TEMP_DIR || './data/temp',
        logsDir: process.env.LOGS_DIR || './logs'
    },

    // Rate limiting
    rateLimit: {
        general: {
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15 minutes
            max: parseInt(process.env.RATE_LIMIT_MAX) || 100
        },
        migration: {
            windowMs: parseInt(process.env.MIGRATION_RATE_WINDOW) || 3600000, // 1 hour
            max: parseInt(process.env.MIGRATION_RATE_MAX) || 5
        },
        validation: {
            windowMs: parseInt(process.env.VALIDATION_RATE_WINDOW) || 300000, // 5 minutes
            max: parseInt(process.env.VALIDATION_RATE_MAX) || 20
        }
    },

    // Security settings
    security: {
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"]
                }
            },
            crossOriginEmbedderPolicy: false
        },
        trustProxy: process.env.TRUST_PROXY === 'true',
        sessionSecret: process.env.SESSION_SECRET || 'migration-backend-secret-key-change-in-production'
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined',
        enableAccessLog: process.env.ENABLE_ACCESS_LOG !== 'false',
        enableErrorLog: process.env.ENABLE_ERROR_LOG !== 'false'
    },

    // Health check configuration
    health: {
        enableDetailedCheck: process.env.ENABLE_DETAILED_HEALTH_CHECK !== 'false',
        checkInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
        pocketdCheckTimeout: parseInt(process.env.POCKETD_HEALTH_TIMEOUT) || 5000 // 5 seconds
    },

    // Development settings
    development: {
        enableMockMode: process.env.ENABLE_MOCK_MODE === 'true',
        mockDelay: parseInt(process.env.MOCK_DELAY) || 2000,
        verboseLogging: process.env.VERBOSE_LOGGING === 'true'
    }
};

// Validation function
const validateConfig = () => {
    const errors = [];

    // Check required environment variables in production
    if (config.server.env === 'production') {
        if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === config.security.sessionSecret) {
            errors.push('SESSION_SECRET must be set in production');
        }
        if (!process.env.ALLOWED_ORIGINS) {
            errors.push('ALLOWED_ORIGINS should be set in production');
        }
    }

    // Validate numeric values
    if (config.migration.maxWalletsPerRequest < 1 || config.migration.maxWalletsPerRequest > 100) {
        errors.push('MAX_WALLETS_PER_REQUEST must be between 1 and 100');
    }

    if (config.pocketd.timeout < 1000 || config.pocketd.timeout > 300000) {
        errors.push('POCKETD_TIMEOUT must be between 1000ms and 300000ms');
    }

    if (errors.length > 0) {
        console.error('❌ Configuration validation failed:');
        errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
    }

    console.log('✅ Configuration validated successfully');
};

// Export configuration
module.exports = {
    ...config,
    validateConfig
}; 