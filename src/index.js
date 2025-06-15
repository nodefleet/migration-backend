const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs-extra');

// Load configuration
const config = require('./config/config');

// Middleware imports
const corsMiddleware = require('./middleware/cors');
const { createRateLimitMiddleware } = require('./middleware/rate-limit');

// Routes imports
const migrationRoutes = require('./routes/migration');

// Validate configuration on startup
config.validateConfig();

// Create Express app
const app = express();
let server; // Declare server variable here

// Trust proxy if configured (for rate limiting behind reverse proxies)
if (config.security.trustProxy) {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet(config.security.helmet));

// CORS middleware
app.use(corsMiddleware);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General rate limiting
app.use(createRateLimitMiddleware('general'));

// Request logging middleware
if (config.logging.enableAccessLog) {
    app.use((req, res, next) => {
        const timestamp = new Date().toISOString();
        const method = req.method;
        const url = req.originalUrl;
        const ip = req.ip;

        console.log(`${timestamp} - ${method} ${url} from ${ip}`);
        next();
    });
}

// Health check endpoint (before rate limiting)
app.get('/health', createRateLimitMiddleware('health'), (req, res) => {
    res.json({
        success: true,
        service: 'migration-backend',
        status: 'running',
        timestamp: new Date().toISOString(),
        version: require('../package.json').version,
        environment: config.server.env
    });
});

// API routes with appropriate rate limiting
app.use('/api/migration', migrationRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'POKT Migration Backend Service',
        version: require('../package.json').version,
        endpoints: {
            health: '/health',
            migration: '/api/migration/migrate',
            validation: '/api/migration/validate',
            status: '/api/migration/status/:sessionId'
        },
        documentation: 'https://github.com/pokt-network/pokt-ui/blob/main/migration-backend/README.md'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `The requested endpoint ${req.originalUrl} does not exist`,
        availableEndpoints: [
            '/',
            '/health',
            '/api/migration/migrate',
            '/api/migration/validate',
            '/api/migration/status/:sessionId'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);

    // Don't leak error details in production
    const isDevelopment = config.server.env === 'development';

    res.status(error.status || 500).json({
        success: false,
        error: 'Internal server error',
        message: isDevelopment ? error.message : 'An unexpected error occurred',
        ...(isDevelopment && { stack: error.stack })
    });
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);

    if (server) {
        server.close((err) => {
            if (err) {
                console.error('❌ Error during server shutdown:', err);
                process.exit(1);
            }

            console.log('✅ Server closed successfully');
            process.exit(0);
        });
    } else {
        console.log('✅ Server was not running');
        process.exit(0);
    }

    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('⚠️  Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
};

// Setup directory structure
const setupDirectories = async () => {
    try {
        console.log('📁 Setting up directory structure...');

        await fs.ensureDir(config.paths.dataDir);
        await fs.ensureDir(config.paths.inputDir);
        await fs.ensureDir(config.paths.outputDir);
        await fs.ensureDir(config.paths.tempDir);
        await fs.ensureDir(config.paths.logsDir);

        console.log('✅ Directory structure ready');
    } catch (error) {
        console.error('❌ Failed to setup directories:', error);
        process.exit(1);
    }
};

// Cleanup old temporary files on startup
const cleanupTempFiles = async () => {
    try {
        console.log('🧹 Cleaning up old temporary files...');

        const tempDir = config.paths.tempDir;
        const files = await fs.readdir(tempDir);
        const now = Date.now();

        let cleaned = 0;
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = await fs.stat(filePath);

            // Remove files older than retention period
            if (now - stats.mtime.getTime() > config.migration.tempFileRetention) {
                await fs.remove(filePath);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🗑️  Cleaned up ${cleaned} old temporary files`);
        } else {
            console.log('✨ No old temporary files found');
        }
    } catch (error) {
        console.warn('⚠️  Failed to cleanup temporary files:', error.message);
    }
};

// Start server
const startServer = async () => {
    try {
        // Setup directories first
        await setupDirectories();

        // Cleanup old files
        await cleanupTempFiles();

        // Start the server
        server = app.listen(config.server.port, config.server.host, () => {
            console.log('\n🚀 POKT Migration Backend Service Started');
            console.log(`📡 Server running on http://${config.server.host}:${config.server.port}`);
            console.log(`🌍 Environment: ${config.server.env}`);
            console.log(`📂 Data directory: ${config.paths.dataDir}`);
            console.log(`🔐 CORS origins: ${config.cors.allowedOrigins.join(', ')}`);
            console.log('\n📋 Available endpoints:');
            console.log(`  - GET  /               - Service information`);
            console.log(`  - GET  /health         - Health check`);
            console.log(`  - POST /api/migration/migrate  - Execute migration`);
            console.log(`  - POST /api/migration/validate - Validate data`);
            console.log(`  - GET  /api/migration/status/:id - Check status`);
            console.log('\n✅ Ready to process migration requests\n');
        });

        // Setup shutdown handlers
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        return server;

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

// Start the server
startServer();

module.exports = app; 