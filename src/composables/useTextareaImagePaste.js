import { ref } from 'vue'

/**
 * Composable for handling image paste/drop in a textarea Markdown editor.
 * Ensures the note is saved before uploading images for unsaved notes.
 */
export function useTextareaImagePaste(options) {
  const {
    textareaRef,
    noteId,
    ensureNoteSaved,
    setContent,
    markDirty,
    onError
  } = options

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

  const isDraggingImage = ref(false)
  const isProcessing = ref(false)

  function resolveNoteId() {
    if (typeof noteId === 'function') return noteId() ?? null
    if (noteId && typeof noteId === 'object' && 'value' in noteId) return noteId.value ?? null
    return noteId ?? null
  }

  function isSupportedImage(file) {
    return SUPPORTED_IMAGE_TYPES.includes(file.type)
  }

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

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function getImageFilesFromDataTransfer(dataTransfer) {
    const images = []
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const file = dataTransfer.files[i]
        if (isSupportedImage(file)) images.push(file)
      }
    }
    if (images.length === 0 && dataTransfer.items) {
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && isSupportedImage(file)) images.push(file)
        }
      }
    }
    return images
  }

  function insertMarkdownImages(textarea, imagePaths) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value

    const before = value.slice(0, start)
    const after = value.slice(end)

    let prefix = ''
    if (before.length > 0 && !before.endsWith('\n')) {
      prefix = '\n'
    }

    const markdown = imagePaths.map(path => `![](${path})`).join('\n') + '\n'
    const newValue = before + prefix + markdown + after

    const newCursor = start + prefix.length + markdown.length

    setContent(newValue)

    // Selection must be restored after Vue updates the controlled textarea.
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursor, newCursor)
    })
  }

  async function processImageFile(file) {
    if (!isSupportedImage(file)) {
      return { success: false, error: '不支持的图片格式' }
    }

    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: '图片文件过大，最大支持 20MB' }
    }

    if (!window.electronAPI?.saveImage) {
      return { success: false, error: '图片保存接口不可用' }
    }

    const imageData = await fileToBase64(file)
    const ext = getExtensionFromMimeType(file.type)
    const currentNoteId = resolveNoteId()

    const result = await window.electronAPI.saveImage(currentNoteId, imageData, ext)
    const savedPath = result?.relativePath || result

    if (!savedPath) {
      return { success: false, error: '图片保存失败' }
    }

    return { success: true, path: savedPath }
  }

  async function handleImages(files, event) {
    if (!files || files.length === 0) return false

    if (isProcessing.value) {
      onError?.('图片正在处理中，请稍候')
      return true
    }

    isProcessing.value = true

    try {
      let resolvedNoteId = resolveNoteId()

      if (!resolvedNoteId && ensureNoteSaved) {
        resolvedNoteId = await ensureNoteSaved()
      }

      if (!resolvedNoteId) {
        onError?.('请先保存便签后再插入图片')
        return true
      }

      const results = []
      for (const file of files) {
        const result = await processImageFile(file)
        if (result.success) {
          results.push(result.path)
        } else {
          onError?.(result.error)
        }
      }

      if (results.length > 0) {
        const textarea = textareaRef.value
        if (textarea) {
          insertMarkdownImages(textarea, results)
          markDirty?.()
        }
      }

      return true
    } catch (error) {
      console.error('[useTextareaImagePaste] handleImages error:', error)
      onError?.(error.message || '图片处理失败')
      return true
    } finally {
      isProcessing.value = false
      isDraggingImage.value = false
    }
  }

  async function handlePaste(event) {
    const clipboardData = event.clipboardData || window.clipboardData
    if (!clipboardData) return

    const images = getImageFilesFromDataTransfer(clipboardData)
    if (images.length === 0) return

    event.preventDefault()
    await handleImages(images, event)
  }

  function handleDragOver(event) {
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return

    const images = getImageFilesFromDataTransfer(dataTransfer)
    if (images.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      dataTransfer.dropEffect = 'copy'
      isDraggingImage.value = true
    }
  }

  function handleDragLeave(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX
    const y = event.clientY
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      isDraggingImage.value = false
    }
  }

  async function handleDrop(event) {
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return

    const images = getImageFilesFromDataTransfer(dataTransfer)
    if (images.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    await handleImages(images, event)
  }

  return {
    isDraggingImage,
    isProcessing,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop
  }
}
