const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

class ImageService {
  constructor(userDataPath) {
    this.baseDir = path.join(userDataPath, 'images')
    this.ensureDirExists(this.baseDir)
  }

  /**
   * Ensure a directory exists, create it if it doesn't
   * @param {string} dir - Directory path
   */
  ensureDirExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Get the base images directory
   * @returns {string} - Full path to base images directory
   */
  getBaseDir() {
    return this.baseDir
  }

  /**
   * Get the directory for a specific note's images
   * @param {string|number} noteId - The note ID
   * @returns {string} - Full path to note's image directory
   */
  getNoteDir(noteId) {
    return path.join(this.baseDir, 'notepad', String(noteId))
  }

  /**
   * Validate image extension
   * @param {string} ext - File extension (with or without dot)
   * @returns {string} - Normalized extension
   */
  validateExtension(ext) {
    // Remove leading dot if present and convert to lowercase
    const cleanExt = ext.replace(/^\./, '').toLowerCase()

    const supportedFormats = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

    if (!supportedFormats.includes(cleanExt)) {
      throw new Error(`Unsupported image format: ${ext}. Supported formats: ${supportedFormats.join(', ')}`)
    }

    return cleanExt
  }

  /**
   * Save an image for a note
   * @param {string|number} noteId - The note ID
   * @param {Buffer|Array} imageData - The image data
   * @param {string} ext - File extension (e.g., 'png', 'jpg')
   * @returns {object} - Result object with relativePath, fullPath, and filename
   */
  saveImage(noteId, imageData, ext) {
    try {
      // Validate noteId
      if (noteId == null || (typeof noteId !== 'string' && typeof noteId !== 'number')) {
        throw new Error('Invalid noteId: must be a non-empty string or number')
      }
      const safeNoteId = String(noteId)

      // Validate imageData
      if (!imageData) {
        throw new Error('Invalid imageData: data is required')
      }

      // Convert array to Buffer if necessary
      let buffer = imageData
      if (Array.isArray(imageData)) {
        buffer = Buffer.from(imageData)
      } else if (typeof imageData === 'string') {
        const base64 = imageData.includes(',') ? imageData.split(',').pop() : imageData
        buffer = Buffer.from(base64, 'base64')
      }

      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Invalid imageData: must be a Buffer, Array, or base64 string')
      }

      // Validate extension
      const validExt = this.validateExtension(ext)

      // Create note directory
      const noteDir = this.getNoteDir(safeNoteId)
      this.ensureDirExists(noteDir)

      // Generate unique filename
      const filename = `${uuidv4()}.${validExt}`
      const fullPath = path.join(noteDir, filename)

      // Write the file
      fs.writeFileSync(fullPath, buffer)

      // Return relative path for Markdown usage
      // baseDir already is <userData>/images, so path should be /notepad/<noteId>/<filename>
      const relativePath = `/notepad/${safeNoteId}/${filename}`

      return {
        success: true,
        relativePath,
        fullPath,
        filename
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get the full path for an image
   * @param {string} noteId - The note ID
   * @param {string} filename - The image filename
   * @returns {object} - Result object with fullPath and exists flag
   */
  getImagePath(noteId, filename) {
    try {
      // Validate inputs
      if (noteId == null || (typeof noteId !== 'string' && typeof noteId !== 'number')) {
        throw new Error('Invalid noteId: must be a non-empty string or number')
      }

      if (!filename || typeof filename !== 'string') {
        throw new Error('Invalid filename: must be a non-empty string')
      }

      // Prevent directory traversal
      const cleanFilename = path.basename(filename)
      const noteDir = this.getNoteDir(noteId)
      const fullPath = path.join(noteDir, cleanFilename)

      // Check if file exists
      const exists = fs.existsSync(fullPath)

      return {
        success: true,
        fullPath,
        exists
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Delete all images for a note
   * @param {string} noteId - The note ID
   * @returns {object} - Result object with deleted count
   */
  deleteNoteImages(noteId) {
    try {
      // Validate noteId
      if (noteId == null || (typeof noteId !== 'string' && typeof noteId !== 'number')) {
        throw new Error('Invalid noteId: must be a non-empty string or number')
      }

      const noteDir = this.getNoteDir(noteId)

      // Check if directory exists
      if (!fs.existsSync(noteDir)) {
        return {
          success: true,
          deleted: 0,
          message: 'No images directory found for this note'
        }
      }

      // Get all files in the directory
      const files = fs.readdirSync(noteDir)
      let deleted = 0
      const errors = []

      // Delete each file
      for (const file of files) {
        const filePath = path.join(noteDir, file)
        try {
          const stat = fs.statSync(filePath)
          if (stat.isFile()) {
            fs.unlinkSync(filePath)
            deleted++
          }
        } catch (err) {
          errors.push(`Failed to delete ${file}: ${err.message}`)
        }
      }

      // Remove the directory
      try {
        fs.rmdirSync(noteDir)
      } catch (err) {
        // Directory might not be empty or other error
        errors.push(`Failed to remove directory: ${err.message}`)
      }

      return {
        success: true,
        deleted,
        errors: errors.length > 0 ? errors : undefined,
        message: `Deleted ${deleted} image(s) for note ${noteId}`
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Copy an image file from source path to note images directory
   * @param {string} noteId - The note ID
   * @param {string} sourcePath - Source file path
   * @returns {object} - Result object with relativePath, fullPath, and filename
   */
  copyImage(noteId, sourcePath) {
    try {
      // Validate noteId
      if (noteId == null || (typeof noteId !== 'string' && typeof noteId !== 'number')) {
        throw new Error('Invalid noteId: must be a non-empty string or number')
      }
      const safeNoteId = String(noteId)

      // Validate sourcePath
      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error('Invalid sourcePath: must be a non-empty string')
      }

      // Check if source file exists
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file does not exist: ${sourcePath}`)
      }

      // Get file extension
      const ext = path.extname(sourcePath).toLowerCase()
      if (!ext) {
        throw new Error('Source file has no extension')
      }

      // Validate extension
      const validExt = this.validateExtension(ext)

      // Create note directory
      const noteDir = this.getNoteDir(safeNoteId)
      this.ensureDirExists(noteDir)

      // Generate unique filename
      const filename = `${uuidv4()}.${validExt}`
      const fullPath = path.join(noteDir, filename)

      // Copy the file
      fs.copyFileSync(sourcePath, fullPath)

      // Return relative path for Markdown usage
      const relativePath = `/notepad/${safeNoteId}/${filename}`

      return {
        success: true,
        relativePath,
        fullPath,
        filename
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

module.exports = { ImageService }
