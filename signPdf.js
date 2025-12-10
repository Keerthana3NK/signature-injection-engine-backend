import express from 'express'
import { PDFDocument, rgb } from 'pdf-lib'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { calculateSHA256 } from '../utils/hash.js'
import Audit from '../models/Audit.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Ensure directories exist
const UPLOADS_DIR = path.join(__dirname, '../uploads')
const SIGNED_DIR = path.join(__dirname, '../signed-pdfs')
const PUBLIC_DIR = path.join(__dirname, '../public')

await fs.ensureDir(UPLOADS_DIR)
await fs.ensureDir(SIGNED_DIR)
await fs.ensureDir(PUBLIC_DIR)

// ----------------- Helpers -----------------

// Validate coordinates
const validateCoordinates = (coordinates) => {
  if (!coordinates || typeof coordinates !== 'object') return false
  const { x, y, width, height, page } = coordinates
  return (
    typeof x === 'number' && x >= 0 &&
    typeof y === 'number' && y >= 0 &&
    typeof width === 'number' && width > 0 &&
    typeof height === 'number' && height > 0 &&
    typeof page === 'number' && page >= 1
  )
}

// Calculate image dimensions preserving aspect ratio
const calculateImageDimensions = (image, maxWidth, maxHeight) => {
  const imageAspectRatio = image.width / image.height
  const boxAspectRatio = maxWidth / maxHeight

  let width, height

  if (imageAspectRatio > boxAspectRatio) {
    width = maxWidth
    height = maxWidth / imageAspectRatio
  } else {
    height = maxHeight
    width = maxHeight * imageAspectRatio
  }

  const xOffset = (maxWidth - width) / 2
  const yOffset = (maxHeight - height) / 2

  return { width, height, xOffset, yOffset }
}

// ----------------- Main signing endpoint -----------------

router.post('/sign-pdf', async (req, res) => {
  try {
    const { pdfId, fields, signatureImage } = req.body

    if (!pdfId || !Array.isArray(fields)) {
      return res.status(400).json({
        error: 'Missing required fields: pdfId and fields array are required'
      })
    }

    // Validate coordinates
    const invalidFields = fields.filter(f => !validateCoordinates(f.pdfCoordinates))
    if (invalidFields.length > 0) {
      return res.status(400).json({
        error: `Invalid coordinates for ${invalidFields.length} field(s)`
      })
    }

    // Original PDF path
    const originalPdfPath = path.join(PUBLIC_DIR, 'sample.pdf')
    if (!await fs.pathExists(originalPdfPath)) {
      return res.status(404).json({ error: 'Sample PDF not found' })
    }

    const originalPdfBytes = await fs.readFile(originalPdfPath)
    const originalHash = calculateSHA256(originalPdfBytes)
    console.log('📄 Original PDF Hash:', originalHash)

    const pdfDoc = await PDFDocument.load(originalPdfBytes)
    const pages = pdfDoc.getPages()

    for (const field of fields) {
      const { pdfCoordinates, type, value } = field
      if (!pdfCoordinates) continue

      const { x, y, width, height, page } = pdfCoordinates
      const pageIndex = Math.min(page - 1, pages.length - 1)
      const pdfPage = pages[pageIndex]

      switch (type) {
        case 'signature':
          if (signatureImage) {
            try {
              const base64Data = signatureImage.replace(/^data:image\/(png|jpeg);base64,/, '')
              const isPng = signatureImage.startsWith('data:image/png')
              const image = isPng
                ? await pdfDoc.embedPng(Buffer.from(base64Data, 'base64'))
                : await pdfDoc.embedJpg(Buffer.from(base64Data, 'base64'))

              const { width: imgWidth, height: imgHeight, xOffset, yOffset } =
                calculateImageDimensions(image, width, height)

              pdfPage.drawImage(image, {
                x: x + xOffset,
                y: y + yOffset,
                width: imgWidth,
                height: imgHeight,
                opacity: 0.9
              })

              console.log(`✅ Added signature at (${x}, ${y}) on page ${page}`)
            } catch (imgErr) {
              console.error('Error processing signature image:', imgErr)
              pdfPage.drawRectangle({
                x, y, width, height,
                borderColor: rgb(1, 0, 0),
                borderWidth: 1,
                color: rgb(1, 0.9, 0.9)
              })
              pdfPage.drawText('SIGNATURE', { x: x + 5, y: y + height / 2 - 6, size: 10, color: rgb(1, 0, 0) })
            }
          }
          break

        case 'text':
          if (value) {
            pdfPage.drawRectangle({ x, y, width, height, borderColor: rgb(0, 0, 0), borderWidth: 0.5, color: rgb(1, 1, 1) })
            pdfPage.drawText(value, { x: x + 5, y: y + height / 2 - 6, size: 12, color: rgb(0, 0, 0) })
          }
          break

        case 'date':
          const currentDate = new Date().toLocaleDateString()
          pdfPage.drawRectangle({ x, y, width, height, borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 1, color: rgb(0.95, 0.95, 1) })
          pdfPage.drawText(currentDate, { x: x + 5, y: y + height / 2 - 6, size: 10, color: rgb(0.2, 0.4, 0.8) })
          break

        case 'radio':
          const centerX = x + width / 2
          const centerY = y + height / 2
          const radius = Math.min(width, height) / 2 - 2
          pdfPage.drawCircle({ x: centerX, y: centerY, size: radius, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) })
          break

        case 'image':
          pdfPage.drawRectangle({ x, y, width, height, borderColor: rgb(0.8, 0.2, 0.8), borderWidth: 1, color: rgb(1, 0.95, 1) })
          pdfPage.drawText('[IMAGE]', { x: x + width / 2 - 20, y: y + height / 2 - 6, size: 10, color: rgb(0.8, 0.2, 0.8) })
          break
      }
    }

    // Save signed PDF
    const signedPdfBytes = await pdfDoc.save()
    const signedHash = calculateSHA256(signedPdfBytes)
    const timestamp = Date.now()
    const signedPdfFilename = `signed_${timestamp}.pdf`
    const signedPdfPath = path.join(SIGNED_DIR, signedPdfFilename)

    await fs.writeFile(signedPdfPath, signedPdfBytes)

    // Copy to public folder for frontend access
    const publicPath = path.join(PUBLIC_DIR, signedPdfFilename)
    await fs.copy(signedPdfPath, publicPath, { overwrite: true })
    const publicUrl = `/pdfs/${signedPdfFilename}`

    // Save audit
    const audit = new Audit({
      pdfId,
      originalHash,
      signedHash,
      fields: fields.map(f => ({
        type: f.type,
        coordinates: f.pdfCoordinates,
        value: f.type === 'text' ? f.value : undefined
      })),
      timestamp: new Date(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    })
    await audit.save()

    res.json({
      success: true,
      message: 'PDF signed successfully',
      signedPdfUrl: publicUrl,
      originalHash,
      signedHash,
      auditId: audit._id,
      downloadUrl: `/api/download/${signedPdfFilename}`
    })
  } catch (error) {
    console.error('Error in sign-pdf endpoint:', error)
    res.status(500).json({ error: 'Failed to sign PDF', details: error.message })
  }
})

// ----------------- Download endpoint -----------------

router.get('/download/:filename', async (req, res) => {
  try {
    const filePath = path.join(SIGNED_DIR, req.params.filename)
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'File not found' })
    res.download(filePath, `signed-document-${Date.now()}.pdf`)
  } catch (err) {
    console.error('Error downloading file:', err)
    res.status(500).json({ error: 'Failed to download file' })
  }
})

// ----------------- Audit endpoints -----------------

router.get('/audit/:id', async (req, res) => {
  try {
    const audit = await Audit.findById(req.params.id)
    if (!audit) return res.status(404).json({ error: 'Audit trail not found' })
    res.json(audit)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch audit trail' })
  }
})

router.get('/audits', async (req, res) => {
  try {
    const audits = await Audit.find().sort({ timestamp: -1 }).limit(50)
    res.json(audits)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch audits' })
  }
})

export default router
