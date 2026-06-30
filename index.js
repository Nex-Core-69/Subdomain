// ============================================
// SUBDOMAIN MANAGER - Simple Version
// No Render API needed - Just DNS records
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ============================================
// MONGODB CONNECTION
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
  notes: {
    type: String,
    default: ''
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

// Serve static files
app.use(express.static(__dirname));

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

    // Save to database
    const mapping = new Mapping({
      subdomain: subdomain.toLowerCase(),
      cnameTarget: cnameTarget.trim(),
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
        target: cnameTarget.trim(),
        fullDomain: `${subdomain}.cutehub.top`
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/update-status/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'verified', 'failed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const mapping = await Mapping.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    res.json({ success: true, mapping });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/delete/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    
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
