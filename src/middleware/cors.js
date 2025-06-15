const cors = require('cors');

// CORS configuration for migration backend
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (e.g., mobile apps, Electron)
        if (!origin) return callback(null, true);

        // Define allowed origins
        const allowedOrigins = [
            'http://localhost:3000',  // React development server
            'http://localhost:5173',  // Vite development server  
            'http://localhost:4173',  // Vite preview server
            'https://pokt-ui.vercel.app',  // Production deployment
            'https://*.vercel.app',    // Vercel preview deployments
            process.env.FRONTEND_URL  // Environment variable for custom domain
        ].filter(Boolean); // Remove any undefined values

        // Check if origin is allowed
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (allowedOrigin.includes('*')) {
                // Handle wildcard patterns
                const pattern = allowedOrigin.replace(/\*/g, '.*');
                const regex = new RegExp(`^${pattern}$`);
                return regex.test(origin);
            }
            return allowedOrigin === origin;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`🚫 CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS policy'));
        }
    },
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