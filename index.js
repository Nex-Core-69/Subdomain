// ============================================
// COMPLETE SUBDOMAIN MANAGER - index.js
// For cutehub.top
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MONGODB CONNECTION
// ============================================
const MONGODB_URI = 'mongodb+srv://txckibutsujimuzan:muzanbot@cluster0.yjpczpc.mongodb.net/subdomainn?retryWrites=true&w=majority&appName=Cluster0';
// ⚠️ Replace the above URI with your actual MongoDB connection string

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// ============================================
// MONGODB SCHEMA
// ============================================
const mappingSchema = new mongoose.Schema({
  subdomain: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[a-zA-Z0-9-]+$/,
    maxlength: 63
  },
  targetUrl: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const Mapping = mongoose.model('Mapping', mappingSchema);

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// STATIC FILES - Serve index.html
// ============================================
const path = require('path');
app.use(express.static(__dirname));

// ============================================
// API ROUTES
// ============================================

// GET /status - Check MongoDB status
app.get('/status', async (req, res) => {
  try {
    const state = mongoose.connection.readyState;
    const status = state === 1 ? 'connected' : 'disconnected';
    res.json({ 
      status: 'ok', 
      database: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// GET /list - Get all mappings
app.get('/list', async (req, res) => {
  try {
    const mappings = await Mapping.find().sort({ createdAt: -1 });
    res.json({ 
      success: true, 
      count: mappings.length,
      mappings 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch mappings',
      error: error.message 
    });
  }
});

// POST /create - Create new mapping
app.post('/create', async (req, res) => {
  try {
    const { subdomain, targetUrl } = req.body;

    // Validation
    if (!subdomain || !targetUrl) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subdomain and target URL are required' 
      });
    }

    // Validate subdomain format
    if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subdomain can only contain letters, numbers, and hyphens' 
      });
    }

    if (subdomain.length > 63) {
      return res.status(400).json({ 
        success: false, 
        message: 'Subdomain cannot exceed 63 characters' 
      });
    }

    // Validate URL
    try {
      new URL(targetUrl);
    } catch {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid target URL format' 
      });
    }

    // Check for duplicate
    const existing = await Mapping.findOne({ subdomain: subdomain.toLowerCase() });
    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: `Subdomain "${subdomain}" already exists` 
      });
    }

    // Create new mapping
    const mapping = new Mapping({
      subdomain: subdomain.toLowerCase(),
      targetUrl: targetUrl.trim()
    });

    await mapping.save();

    res.status(201).json({ 
      success: true, 
      message: 'Subdomain created successfully',
      mapping 
    });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// DELETE /delete/:id - Delete mapping
app.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid ID format' 
      });
    }

    const deleted = await Mapping.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        message: 'Mapping not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Deleted successfully',
      mapping: deleted 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Delete failed',
      error: error.message 
    });
  }
});

// ============================================
// REVERSE PROXY - The most important part
// ============================================
app.use(async (req, res, next) => {
  // Skip API routes and static files
  if (req.path.startsWith('/api/') || 
      req.path === '/status' || 
      req.path === '/list' || 
      req.path === '/create' ||
      req.path === '/delete/' ||
      req.path === '/index.html' ||
      req.path === '/') {
    return next();
  }

  // Get the hostname from request
  const host = req.headers.host || '';
  const domain = 'cutehub.top';
  
  // Extract subdomain
  let subdomain = '';
  if (host.endsWith(`.${domain}`)) {
    subdomain = host.replace(`.${domain}`, '').toLowerCase();
  } else {
    // Not a subdomain request, serve static files
    return next();
  }

  // Skip if no subdomain (just cutehub.top)
  if (!subdomain || subdomain === 'www' || subdomain === 'cutehub') {
    return next();
  }

  try {
    // Find the mapping in database
    const mapping = await Mapping.findOne({ subdomain });
    
    if (!mapping) {
      // Subdomain not found - 404
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Subdomain Not Found</title>
          <style>
            body { 
              background: #0b0d15; 
              color: #eef2f6; 
              font-family: system-ui, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              padding: 20px;
            }
            .error-box {
              background: rgba(18, 22, 33, 0.8);
              backdrop-filter: blur(10px);
              border-radius: 40px;
              padding: 3rem 4rem;
              max-width: 600px;
              text-align: center;
              border: 1px solid rgba(255, 100, 100, 0.2);
            }
            h1 { font-size: 3rem; margin: 0; color: #ff7a7a; }
            .sub { font-size: 1.5rem; color: #7fc9ff; margin: 0.5rem 0; }
            p { color: #8aa4c0; margin: 1.5rem 0; }
            a { color: #3c8eff; text-decoration: none; }
            .code { background: #0a1420; padding: 0.3rem 1rem; border-radius: 20px; font-family: monospace; color: #b0daff; }
          </style>
        </head>
        <body>
          <div class="error-box">
            <h1>🔍 404</h1>
            <div class="sub">${subdomain}.cutehub.top</div>
            <p>This subdomain has not been configured yet.</p>
            <div class="code">Subdomain not found</div>
            <p style="margin-top:2rem;"><a href="/">← Back to Dashboard</a></p>
          </div>
        </body>
        </html>
      `);
    }

    // Create proxy middleware dynamically
    const targetUrl = mapping.targetUrl;
    
    // Remove trailing slash if exists
    const cleanTarget = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : targetUrl;

    // Create proxy
    const proxy = createProxyMiddleware({
      target: cleanTarget,
      changeOrigin: true,
      secure: true,
      ws: true, // WebSocket support
      xfwd: true,
      proxyReqPathResolver: (req) => {
        // Preserve the original path
        return req.originalUrl || req.url;
      },
      onProxyReq: (proxyReq, req, res) => {
        // Forward all headers
        if (req.headers) {
          Object.keys(req.headers).forEach(key => {
            if (key !== 'host' && key !== 'connection') {
              proxyReq.setHeader(key, req.headers[key]);
            }
          });
        }
      },
      onProxyRes: (proxyRes, req, res) => {
        // Keep the original URL in the browser
        // Remove any location headers that might redirect
        proxyRes.headers['location'] = undefined;
        // Set CORS headers
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Proxy Error</title>
            <style>
              body { background: #0b0d15; color: #eef2f6; font-family: system-ui, sans-serif;
                display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .box { background: rgba(18, 22, 33, 0.8); border-radius: 40px; padding: 3rem; max-width: 500px; text-align: center; border: 1px solid rgba(255, 150, 50, 0.2); }
              h1 { color: #ffa64d; }
              .sub { color: #7fc9ff; }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>⚠️ Proxy Error</h1>
              <div class="sub">${subdomain}.cutehub.top</div>
              <p>Could not reach the target server.</p>
              <p style="font-size:0.8rem;color:#6a8aaa;">${err.message}</p>
              <p><a href="/" style="color:#3c8eff;">← Dashboard</a></p>
            </div>
          </body>
          </html>
        `);
      }
    });

    // Execute the proxy
    return proxy(req, res, next);

  } catch (error) {
    console.error('Proxy setup error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Server Error</title>
        <style>
          body { background: #0b0d15; color: #eef2f6; font-family: system-ui, sans-serif;
            display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .box { background: rgba(18, 22, 33, 0.8); border-radius: 40px; padding: 3rem; max-width: 500px; text-align: center; border: 1px solid rgba(255, 50, 50, 0.2); }
          h1 { color: #ff5a5a; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>⚠️ 500</h1>
          <p>Internal server error</p>
          <p><a href="/" style="color:#3c8eff;">← Dashboard</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Subdomain Manager running on port ${PORT}`);
  console.log(`📡 Dashboard: http://localhost:${PORT}`);
  console.log(`🌐 Domain: cutehub.top`);
  console.log(`💾 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('\n👋 MongoDB connection closed');
  process.exit(0);
});

// ============================================
// ERROR HANDLING
// ============================================
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
