const cors = require('cors');

// CORS configuration for migration backend - ALLOW ALL ORIGINS
const corsOptions = {
    origin: '*', // Allow all origins
    credentials: true, // Allow cookies and authorization headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Cache-Control',
        'X-Session-ID'
    ],
    exposedHeaders: [
        'X-Session-ID',
        'X-Total-Count',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining'
    ],
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
    maxAge: 86400 // Cache preflight response for 24 hours
};

// Create CORS middleware
const corsMiddleware = cors(corsOptions);

// Enhanced CORS middleware with logging
const enhancedCorsMiddleware = (req, res, next) => {
    // Log CORS requests in development
    if (process.env.NODE_ENV === 'development') {
        console.log(`🌐 CORS request from origin: ${req.get('origin') || 'no-origin'}`);
    }

    // Apply CORS
    corsMiddleware(req, res, (err) => {
        if (err) {
            console.error('❌ CORS error:', err.message);
            return res.status(403).json({
                success: false,
                error: 'CORS policy violation',
                message: 'Origin not allowed'
            });
        }
        next();
    });
};

module.exports = enhancedCorsMiddleware; 