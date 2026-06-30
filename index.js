// ============================================
// SUBDOMAIN MANAGER - Vercel Serverless
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();

// ============================================
// MONGODB CONNECTION (Cached for Serverless)
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://txckibutsujimuzan:muzanbot@cluster0.yjpczpc.mongodb.net/subdomainn?retryWrites=true&w=majority&appName=Cluster0';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      bufferCommands: false,
      maxPoolSize: 1,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log('✅ MongoDB connected');
      return mongoose;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ============================================
// SCHEMA
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
  }
}, {
  timestamps: true
});

const Mapping = mongoose.models.Mapping || mongoose.model('Mapping', mappingSchema);

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// SERVE INDEX.HTML (Root route)
// ============================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// API ROUTES
// ============================================

app.get('/status', async (req, res) => {
  try {
    await connectDB();
    const state = mongoose.connection.readyState;
    res.json({ 
      status: 'ok', 
      database: state === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/list', async (req, res) => {
  try {
    await connectDB();
    const mappings = await Mapping.find().sort({ createdAt: -1 });
    res.json({ success: true, count: mappings.length, mappings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/create', async (req, res) => {
  try {
    await connectDB();
    const { subdomain, targetUrl } = req.body;

    if (!subdomain || !targetUrl) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
      return res.status(400).json({ success: false, message: 'Invalid subdomain format' });
    }

    if (subdomain.length > 63) {
      return res.status(400).json({ success: false, message: 'Max 63 characters' });
    }

    try {
      new URL(targetUrl);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    const existing = await Mapping.findOne({ subdomain: subdomain.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: `"${subdomain}" already exists` });
    }

    const mapping = new Mapping({
      subdomain: subdomain.toLowerCase(),
      targetUrl: targetUrl.trim()
    });

    await mapping.save();

    res.status(201).json({ success: true, message: 'Created successfully', mapping });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/delete/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const deleted = await Mapping.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    res.json({ success: true, message: 'Deleted successfully' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// REVERSE PROXY
// ============================================
app.use(async (req, res, next) => {
  // Skip if not a subdomain request
  if (req.path !== '/' && !req.path.startsWith('/')) {
    return next();
  }

  const host = req.headers.host || '';
  const domain = 'cutehub.top';
  
  // Check if it's a subdomain request
  if (!host.endsWith(`.${domain}`) || host === domain || host === `www.${domain}`) {
    return next();
  }

  const subdomain = host.replace(`.${domain}`, '').toLowerCase();

  try {
    await connectDB();
    const mapping = await Mapping.findOne({ subdomain });
    
    if (!mapping) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Subdomain Not Found</title>
          <style>
            body { background: #0b0d15; color: #eef2f6; font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; }
            .box { background: rgba(18, 22, 33, 0.8); backdrop-filter: blur(10px); border-radius: 40px; padding: 3rem; max-width: 600px; text-align: center; border: 1px solid rgba(255, 100, 100, 0.2); }
            h1 { font-size: 3rem; margin: 0; color: #ff7a7a; }
            .sub { font-size: 1.5rem; color: #7fc9ff; margin: 0.5rem 0; }
            p { color: #8aa4c0; margin: 1.5rem 0; }
            a { color: #3c8eff; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>🔍 404</h1>
            <div class="sub">${subdomain}.cutehub.top</div>
            <p>This subdomain has not been configured yet.</p>
            <p><a href="/">← Back to Dashboard</a></p>
          </div>
        </body>
        </html>
      `);
    }

    const targetUrl = mapping.targetUrl;
    const cleanTarget = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : targetUrl;

    const proxy = createProxyMiddleware({
      target: cleanTarget,
      changeOrigin: true,
      secure: true,
      ws: true,
      xfwd: true,
      proxyReqPathResolver: (req) => req.originalUrl || req.url,
      onProxyReq: (proxyReq, req) => {
        if (req.headers) {
          Object.keys(req.headers).forEach(key => {
            if (key !== 'host' && key !== 'connection') {
              proxyReq.setHeader(key, req.headers[key]);
            }
          });
        }
      },
      onProxyRes: (proxyRes) => {
        proxyRes.headers['location'] = undefined;
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
      },
      onError: (err, req, res) => {
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Proxy Error</title>
            <style>body{background:#0b0d15;color:#eef2f6;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
            .box{background:rgba(18,22,33,0.8);border-radius:40px;padding:3rem;max-width:500px;text-align:center;border:1px solid rgba(255,150,50,0.2);}
            h1{color:#ffa64d;}</style>
          </head>
          <body>
            <div class="box"><h1>⚠️ Proxy Error</h1><p>Could not reach target server.</p><p><a href="/" style="color:#3c8eff;">← Dashboard</a></p></div>
          </body>
          </html>
        `);
      }
    });

    return proxy(req, res, next);

  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Server Error</title>
        <style>body{background:#0b0d15;color:#eef2f6;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
        .box{background:rgba(18,22,33,0.8);border-radius:40px;padding:3rem;max-width:500px;text-align:center;border:1px solid rgba(255,50,50,0.2);}
        h1{color:#ff5a5a;}</style>
      </head>
      <body>
        <div class="box"><h1>⚠️ 500</h1><p>Internal server error</p><p><a href="/" style="color:#3c8eff;">← Dashboard</a></p></div>
      </body>
      </html>
    `);
  }
});

// ============================================
// EXPORT FOR VERCEL
// ============================================
module.exports = app;
