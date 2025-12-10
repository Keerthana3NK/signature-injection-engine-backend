import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import signPdfRouter from './routes/signPdf.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5001

// ----------------- Middleware -----------------
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ----------------- Ensure directories exist -----------------
const directories = [
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'signed-pdfs'),
  path.join(__dirname, 'public')
]

directories.forEach(async (dir) => {
  try {
    await fs.ensureDir(dir)
    console.log(`📁 Directory ensured: ${dir}`)
  } catch (err) {
    console.error(`❌ Failed to ensure directory ${dir}:`, err)
  }
})

// ----------------- MongoDB Connection -----------------
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/signature-engine', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    console.log('✅ MongoDB connected successfully')
  } catch (err) {
    console.error('❌ MongoDB connection error:', err)
    process.exit(1)
  }
}
connectDB()

// ----------------- Routes -----------------
app.use('/api', signPdfRouter)

// Serve static PDFs for frontend
app.use('/pdfs', express.static(path.join(__dirname, 'public')))

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Signature Injection Engine API'
  })
})

// ----------------- Error handling middleware -----------------
app.use((err, req, res, next) => {
  console.error('Server Error:', err)
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

// ----------------- Start server -----------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📄 Health check: http://localhost:${PORT}/health`)
})
