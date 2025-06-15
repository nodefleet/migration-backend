const rateLimit = require('express-rate-limit');

// General API rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
        console.warn(`🚨 Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            success: false,
            error: 'Rate limit exceeded',
            message: 'Too many requests from this IP. Please try again later.',
            retryAfter: Math.ceil(req.rateLimit.msBeforeNext / 1000)
        });
    }
});

// Stricter rate limiting for migration endpoints
const migrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 migration requests per hour
    message: {
        success: false,
        error: 'Migration rate limit exceeded',
        message: 'Too many migration requests. Please wait before trying again.',
        retryAfter: '1 hour'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use IP + User-Agent for more specific rate limiting
        return `${req.ip}-${req.get('User-Agent') || 'unknown'}`;
    },
    handler: (req, res) => {
        console.warn(`🚨 Migration rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            success: false,
            error: 'Migration rate limit exceeded',
            message: 'You have exceeded the migration request limit. Migrations are intensive operations. Please wait before trying again.',
            retryAfter: Math.ceil(req.rateLimit.msBeforeNext / 1000),
            tip: 'Consider batching multiple wallets in a single migration request.'
        });
    }
});

// Very strict rate limiting for validation endpoints
const validationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // Limit each IP to 20 validation requests per 5 minutes
    message: {
        success: false,
        error: 'Validation rate limit exceeded',
        message: 'Too many validation requests. Please slow down.',
        retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`🚨 Validation rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            success: false,
            error: 'Validation rate limit exceeded',
            message: 'Too many validation requests. Please wait before validating again.',
            retryAfter: Math.ceil(req.rateLimit.msBeforeNext / 1000)
        });
    }
});

// Health check rate limiting (more lenient)
const healthLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Limit each IP to 30 health checks per minute
    message: {
        success: false,
        error: 'Health check rate limit exceeded',
        message: 'Too many health check requests.',
        retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            error: 'Health check rate limit exceeded',
            message: 'Too many health check requests. Please wait.',
            retryAfter: Math.ceil(req.rateLimit.msBeforeNext / 1000)
        });
    }
});

// Create a function to apply appropriate rate limiting based on endpoint
const createRateLimitMiddleware = (type = 'general') => {
    switch (type) {
        case 'migration':
            return migrationLimiter;
        case 'validation':
            return validationLimiter;
        case 'health':
            return healthLimiter;
        case 'general':
        default:
            return generalLimiter;
    }
};

module.exports = {
    generalLimiter,
    migrationLimiter,
    validationLimiter,
    healthLimiter,
    createRateLimitMiddleware
}; 