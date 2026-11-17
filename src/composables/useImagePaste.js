import { ref } from 'vue'

/**
 * Composable for handling image paste and drop in notepad editor
 * @param {Object} options - Configuration options
 * @param {string} options.noteId - The ID of the current note
 * @param {Ref<HTMLTextAreaElement>} options.textareaRef - Reference to the textarea element
 * @param {Function} options.onImageSaved - Callback function called after image is saved, receives the markdown image syntax
 * @returns {Object} Composable methods for handling paste, drop, and dragover events
 */
export function useImagePaste(options) {
  const { noteId, textareaRef, onImageSaved } = options

  const SUPPORTED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
  ]

  const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - The MIME type
   * @returns {string} The file extension without dot
   */
  function getExtensionFromMimeType(mimeType) {
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg'
    }
    return mimeToExt[mimeType] || 'png'
  }

  /**
   * Check if file is a supported image type
   * @param {File} file - The file to check
   * @returns {boolean} True if supported
   */
  function isSupportedImage(file) {
    return SUPPORTED_IMAGE_TYPES.includes(file.type)
  }

  /**
   * Convert image file to base64 data
   * @param {File} file - The image file
   * @returns {Promise<string>} Base64 encoded image data
   */
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /**
   * Insert markdown image syntax at cursor position in textarea
   * @param {string} imagePath - The path to the saved image
   */
  function insertMarkdownImage(imagePath) {
    if (!textareaRef.value) return

    const textarea = textareaRef.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value

    const markdownImage = `![](${imagePath})`

    // Insert at cursor position
    textarea.value = value.substring(0, start) + markdownImage + value.substring(end)

    // Update cursor position to after the inserted image
    const newCursorPos = start + markdownImage.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
    textarea.focus()

    // Trigger input event for reactive updates
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /**
   * Process and save image file
   * @param {File} file - The image file to process
   * @returns {Promise<boolean>} True if successful
   */
  async function processImageFile(file) {
    if (!isSupportedImage(file)) {
      console.warn('Unsupported image type:', file.type)
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      console.warn('Image file too large:', file.size, 'max:', MAX_FILE_SIZE)
      alert('Image file too large. Maximum size is 20MB.')
      return false
    }

    if (!window.electronAPI?.saveImage) {
      console.error('electronAPI.saveImage is not available')
      return false
    }

    try {
      const imageData = await fileToBase64(file)
      const ext = getExtensionFromMimeType(file.type)

      const currentNoteId = noteId?.value || noteId
      const result = await window.electronAPI.saveImage(currentNoteId, imageData, ext)
      const savedPath = result?.relativePath || result

      if (savedPath) {
        insertMarkdownImage(savedPath)

        if (onImageSaved) {
          onImageSaved(savedPath)
        }

        return true
      }
    } catch (error) {
      console.error('Failed to save image:', error)
    }

    return false
  }

  /**
   * Extract image file from clipboard items
   * @param {DataTransferItemList} items - Clipboard items
   * @returns {File|null} The first image file found or null
   */
  function getImageFromClipboardItems(items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      if (item.kind === 'file' && isSupportedImage(item.getAsFile())) {
        return item.getAsFile()
      }
    }
    return null
  }

  /**
   * Handle clipboard paste events
   * @param {ClipboardEvent} event - The paste event
   */
  async function handlePaste(event) {
    const clipboardData = event.clipboardData || window.clipboardData

    if (!clipboardData) return

    // Check for image files in clipboard items
    if (clipboardData.items && clipboardData.items.length > 0) {
      const imageFile = getImageFromClipboardItems(clipboardData.items)

      if (imageFile) {
        event.preventDefault()
        await processImageFile(imageFile)
        return
      }
    }

    // Fallback: check files array
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i]

        if (isSupportedImage(file)) {
          event.preventDefault()
          await processImageFile(file)
          return
        }
      }
    }
  }

  /**
   * Handle drag over events - prevent default to allow dropping
   * @param {DragEvent} event - The dragover event
   */
  function handleDragOver(event) {
    event.preventDefault()
    event.stopPropagation()

    // Set drop effect for visual feedback
    if (event.dataTransfer) {
      // Check if any files are images
      const files = event.dataTransfer.files
      let hasImage = false

      for (let i = 0; i < files.length; i++) {
        if (isSupportedImage(files[i])) {
          hasImage = true
          break
        }
      }

      // Also check items if available
      if (!hasImage && event.dataTransfer.items) {
        for (let i = 0; i < event.dataTransfer.items.length; i++) {
          if (event.dataTransfer.items[i].kind === 'file') {
            const file = event.dataTransfer.items[i].getAsFile()
            if (file && isSupportedImage(file)) {
              hasImage = true
              break
            }
          }
        }
      }

      event.dataTransfer.dropEffect = hasImage ? 'copy' : 'none'
    }
  }

  /**
   * Handle drag-and-drop events
   * @param {DragEvent} event - The drop event
   */
  async function handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()

    const dataTransfer = event.dataTransfer

    if (!dataTransfer) return

    // Process dropped files
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const file = dataTransfer.files[i]

        if (isSupportedImage(file)) {
          await processImageFile(file)
          // Only process first image for now
          return
        }
      }
    }

    // Fallback: check items
    if (dataTransfer.items && dataTransfer.items.length > 0) {
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i]

        if (item.kind === 'file') {
          const file = item.getAsFile()

          if (file && isSupportedImage(file)) {
            await processImageFile(file)
            return
          }
        }
      }
    }
  }

  return {
    handlePaste,
    handleDrop,
    handleDragOver
  }
}
