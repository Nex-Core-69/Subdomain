// ============================================
// SUBDOMAIN MANAGER with Render API Integration
// For Vercel - Works with Render Custom Domains
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://your_username:your_password@cluster.mongodb.net/subdomain_manager?retryWrites=true&w=majority';
const RENDER_API_KEY = process.env.RENDER_API_KEY || 'your_render_api_key';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'your_render_service_id';
const RENDER_OWNER_ID = process.env.RENDER_OWNER_ID || 'your_render_owner_id';

// ============================================
// MONGODB CONNECTION (Cached for Serverless)
// ============================================
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
  },
  cnameTarget: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'pending'
  },
  renderDomainId: {
    type: String,
    default: null
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
// RENDER API FUNCTIONS
// ============================================

// Add custom domain to Render
async function addRenderCustomDomain(subdomain, cnameTarget) {
  try {
    const domain = `${subdomain}.cutehub.top`;
    
    const response = await axios.post(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains`,
      {
        name: domain,
        redirect: null,
        verificationMethod: 'cname'
      },
      {
        headers: {
          'Authorization': `Bearer ${RENDER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      domainId: response.data.id,
      status: response.data.status,
      cnameTarget: response.data.cnameTarget || cnameTarget
    };
  } catch (error) {
    console.error('Render API Error:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message
    };
  }
}

// Verify custom domain on Render
async function verifyRenderDomain(domainId) {
  try {
    const response = await axios.post(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains/${domainId}/verify`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${RENDER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      status: response.data.status
    };
  } catch (error) {
    console.error('Verify Error:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message
    };
  }
}

// Delete custom domain from Render
async function deleteRenderDomain(domainId) {
  try {
    await axios.delete(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains/${domainId}`,
      {
        headers: {
          'Authorization': `Bearer ${RENDER_API_KEY}`
        }
      }
    );
    return { success: true };
  } catch (error) {
    console.error('Delete Domain Error:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message
    };
  }
}

// Get all custom domains from Render
async function getRenderDomains() {
  try {
    const response = await axios.get(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains`,
      {
        headers: {
          'Authorization': `Bearer ${RENDER_API_KEY}`
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Get Domains Error:', error.response?.data || error.message);
    return [];
  }
}

// ============================================
// SERVE INDEX.HTML
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
      render: RENDER_API_KEY ? 'configured' : 'not_configured',
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
    
    // Get Render domains for status sync
    const renderDomains = await getRenderDomains();
    const renderDomainMap = {};
    renderDomains.forEach(d => {
      renderDomainMap[d.name] = d.status;
    });

    // Update status from Render
    const updatedMappings = mappings.map(m => {
      const domainName = `${m.subdomain}.cutehub.top`;
      if (renderDomainMap[domainName]) {
        m.status = renderDomainMap[domainName] === 'verified' ? 'verified' : 'pending';
      }
      return m;
    });

    res.json({ success: true, count: updatedMappings.length, mappings: updatedMappings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/create', async (req, res) => {
  try {
    await connectDB();
    const { subdomain, cnameTarget } = req.body;

    if (!subdomain || !cnameTarget) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
      return res.status(400).json({ success: false, message: 'Invalid subdomain format' });
    }

    if (subdomain.length > 63) {
      return res.status(400).json({ success: false, message: 'Max 63 characters' });
    }

    // Check duplicate
    const existing = await Mapping.findOne({ subdomain: subdomain.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: `"${subdomain}" already exists` });
    }

    // Add domain to Render
    const renderResult = await addRenderCustomDomain(subdomain, cnameTarget);
    
    if (!renderResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: `Render API Error: ${renderResult.message}` 
      });
    }

    // Save to database
    const mapping = new Mapping({
      subdomain: subdomain.toLowerCase(),
      targetUrl: `https://${subdomain}.cutehub.top`,
      cnameTarget: cnameTarget,
      renderDomainId: renderResult.domainId,
      status: 'pending'
    });

    await mapping.save();

    res.status(201).json({ 
      success: true, 
      message: 'Subdomain created! Add this CNAME to your DNS provider:',
      mapping,
      dnsRecord: {
        type: 'CNAME',
        host: subdomain,
        target: cnameTarget
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/verify/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    
    const mapping = await Mapping.findById(id);
    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    if (!mapping.renderDomainId) {
      return res.status(400).json({ success: false, message: 'No Render domain ID' });
    }

    const verifyResult = await verifyRenderDomain(mapping.renderDomainId);
    
    if (verifyResult.success) {
      mapping.status = 'verified';
      await mapping.save();
    }

    res.json({ 
      success: verifyResult.success, 
      status: mapping.status,
      message: verifyResult.success ? 'Verified successfully' : verifyResult.message
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/delete/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    
    const mapping = await Mapping.findById(id);
    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    // Delete from Render
    if (mapping.renderDomainId) {
      await deleteRenderDomain(mapping.renderDomainId);
    }

    // Delete from database
    await Mapping.findByIdAndDelete(id);

    res.json({ success: true, message: 'Deleted successfully' });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// EXPORT FOR VERCEL
// ============================================
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Subdomain Manager running on port ${PORT}`);
    console.log(`📡 Dashboard: http://localhost:${PORT}`);
  });
}
