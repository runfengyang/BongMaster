import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAiStore = defineStore('ai', () => {
  // State
  const config = ref({
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 20000,
    enabled: false
  })
  const loading = ref(false)
  const error = ref(null)
  const messages = ref([])
  const showChat = ref(false)
  const showSettings = ref(false)

  // Getters
  const isConfigured = computed(() => !!config.value.apiKey)

  // Quick commands
  const quickCommands = [
    {
      id: 'summarize_project',
      name: '总结项目',
      icon: 'fa-list',
      prompt: '请总结以下项目的当前状态，包括整体进度、未完成任务、潜在风险和建议的下一步行动。'
    },
    {
      id: 'generate_weekly',
      name: '生成周报',
      icon: 'fa-file-alt',
      prompt: '请根据以下任务完成情况，生成一份工作周报，包括本周完成的工作、进行中的工作和下周计划。'
    },
    {
      id: 'plan_tasks',
      name: '规划任务',
      icon: 'fa-tasks',
      prompt: '请为以下项目制定一个合理的任务执行计划，包括优先级排序、时间估算和依赖关系建议。'
    },
    {
      id: 'analyze_risks',
      name: '风险分析',
      icon: 'fa-exclamation-triangle',
      prompt: '请分析以下项目的潜在风险（如进度延迟、资源不足等），并给出应对建议。'
    }
  ]

  // Actions
  const fetchConfig = async () => {
    try {
      const result = await window.electronAPI.getAiConfig()
      if (result) {
        config.value = { ...config.value, ...result }
      }
    } catch (err) {
      console.error('[AiStore] fetchConfig error:', err)
    }
  }

  const saveConfig = async (newConfig) => {
    loading.value = true
    error.value = null
    try {
      const result = await window.electronAPI.saveAiConfig(newConfig)
      if (result.success) {
        config.value = { ...config.value, ...newConfig }
        return true
      } else {
        error.value = result.error
        return false
      }
    } catch (err) {
      error.value = err.message
      return false
    } finally {
      loading.value = false
    }
  }

  const pendingActions = ref(null)

  const sendMessage = async (content, context = {}, interactive = true) => {
    if (!config.value.apiKey) {
      error.value = '请先配置 API Key'
      return null
    }

    loading.value = true
    error.value = null
    pendingActions.value = null

    const userMessage = { role: 'user', content, timestamp: Date.now() }
    messages.value.push(userMessage)

    try {
      const plainContext = JSON.parse(JSON.stringify(context || {}))
      const result = await window.electronAPI.chatWithAI(
        messages.value.map(m => ({ role: m.role, content: m.content })),
        plainContext,
        true,
        interactive
      )

      if (result.success) {
        if (result.type === 'pending' && interactive) {
          pendingActions.value = result.actions
          const aiMessage = {
            role: 'assistant',
            content: result.assistantMessage?.content || '需要您确认以下操作：',
            timestamp: Date.now(),
            pending: true,
            actions: result.actions
          }
          messages.value.push(aiMessage)
          return aiMessage
        }

        const aiMessage = {
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          usage: result.usage
        }
        messages.value.push(aiMessage)
        return aiMessage
      } else {
        if (result.stopped) {
          messages.value.push({
            role: 'assistant',
            content: '已中断。',
            timestamp: Date.now()
          })
        } else {
          error.value = result.error
          messages.value.pop()
        }
        return null
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('中断')) {
        messages.value.push({
          role: 'assistant',
          content: '已中断。',
          timestamp: Date.now()
        })
      } else {
        error.value = err.message
        messages.value.pop()
      }
      return null
    } finally {
      loading.value = false
    }
  }

  const stopGeneration = async () => {
    try {
      await window.electronAPI.stopChat()
    } catch (err) {
      console.error('[AiStore] stopGeneration error:', err)
    }
  }

  const executeActions = async (actions) => {
    if (!actions || actions.length === 0) return null

    loading.value = true
    error.value = null

    try {
      const plainContext = {}
      const lastUserMsg = messages.value.slice().reverse().find(m => m.role === 'user')
      const assistantMsg = messages.value[messages.value.length - 1]

      const messagesForExecution = []
      if (lastUserMsg) messagesForExecution.push({ role: 'user', content: lastUserMsg.content })
      if (assistantMsg?.pending) {
        messagesForExecution.push({
          role: 'assistant',
          content: assistantMsg.content,
          tool_calls: actions.map((a, idx) => ({
            id: a.id || `action_${idx}`,
            type: 'function',
            function: { name: a.tool, arguments: JSON.stringify(a.args) }
          }))
        })
      }

      const result = await window.electronAPI.executeActions(messagesForExecution, plainContext)

      if (result.success) {
        const finalMessage = {
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          usage: result.usage
        }
        messages.value.push(finalMessage)
        pendingActions.value = null
        return finalMessage
      } else {
        error.value = result.error
        return null
      }
    } catch (err) {
      error.value = err.message
      return null
    } finally {
      loading.value = false
    }
  }

  const testConnection = async () => {
    if (!config.value.apiKey) {
      return { success: false, error: '请先配置 API Key' }
    }

    try {
      const result = await window.electronAPI.chatWithAI(
        [{ role: 'user', content: 'Hello, this is a test message. Please respond with "OK".' }],
        {},
        false
      )
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const executeQuickCommand = async (commandId, context = {}) => {
    const command = quickCommands.find(c => c.id === commandId)
    if (!command) return null

    return sendMessage(command.prompt, context, true)
  }

  const clearMessages = () => {
    messages.value = []
  }

  const openChat = () => {
    showChat.value = true
    showSettings.value = false
  }

  const closeChat = () => {
    showChat.value = false
  }

  const openSettings = () => {
    showSettings.value = true
    showChat.value = false
  }

  const closeSettings = () => {
    showSettings.value = false
  }

  return {
    config,
    loading,
    error,
    messages,
    showChat,
    showSettings,
    quickCommands,
    isConfigured,
    fetchConfig,
    saveConfig,
    sendMessage,
    testConnection,
    executeQuickCommand,
    clearMessages,
    openChat,
    closeChat,
    openSettings,
    closeSettings,
    pendingActions,
    executeActions,
    stopGeneration
  }
})
