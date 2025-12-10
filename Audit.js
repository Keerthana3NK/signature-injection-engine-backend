import mongoose from 'mongoose'

const coordinateSchema = new mongoose.Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  page: { type: Number, required: true, min: 1 }
})

const fieldSchema = new mongoose.Schema({
  type: { 
    type: String, 
    required: true,
    enum: ['signature', 'text', 'date', 'radio', 'image']
  },
  coordinates: { type: coordinateSchema, required: true },
  value: { type: String, default: '' }
})

const auditSchema = new mongoose.Schema({
  pdfId: { 
    type: String, 
    required: true,
    index: true 
  },
  originalHash: { 
    type: String, 
    required: true,
    index: true 
  },
  signedHash: { 
    type: String, 
    required: true,
    index: true 
  },
  fields: [fieldSchema],
  timestamp: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  ipAddress: String,
  userAgent: String,
  metadata: {
    totalFields: { type: Number, default: 0 },
    hasSignature: { type: Boolean, default: false },
    pageCount: { type: Number, default: 1 }
  }
}, {
  timestamps: true
})

// Pre-save middleware to update metadata
auditSchema.pre('save', function(next) {
  this.metadata = {
    totalFields: this.fields.length,
    hasSignature: this.fields.some(f => f.type === 'signature'),
    pageCount: Math.max(...this.fields.map(f => f.coordinates.page), 1)
  }
  next()
})

// Static method to find by hash
auditSchema.statics.findByHash = function(hash) {
  return this.find({ 
    $or: [
      { originalHash: hash },
      { signedHash: hash }
    ]
  }).sort({ timestamp: -1 })
}

// Static method to get recent audits
auditSchema.statics.getRecent = function(limit = 50) {
  return this.find().sort({ timestamp: -1 }).limit(limit)
}

// Instance method to verify integrity
auditSchema.methods.verifyIntegrity = function() {
  return this.originalHash !== this.signedHash
}

// Create indexes
auditSchema.index({ pdfId: 1, timestamp: -1 })
auditSchema.index({ originalHash: 1, signedHash: 1 })

const Audit = mongoose.model('Audit', auditSchema)

export default Audit