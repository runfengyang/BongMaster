const { app, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

class AiService {
  constructor(dbService) {
    this.config = this.loadConfig()
    this.dbService = dbService
    this.currentAbortController = null
    this.shouldStop = false
  }

  stopChat() {
    this.shouldStop = true
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  getConfigPath() {
    return path.join(app.getPath('userData'), 'ai-config.json')
  }

  loadConfig() {
    try {
      const configPath = this.getConfigPath()
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (err) {
      console.error('[AiService] Failed to load config:', err)
    }
    return this.getDefaultConfig()
  }

  saveConfig(config) {
    try {
      config = { ...config }
      // 如果 UI 回传的是脱敏 key，不要覆盖真实 key
      if (!config.apiKey || config.apiKey.includes('****')) {
        delete config.apiKey
      }
      this.config = { ...this.config, ...config }
      const configPath = this.getConfigPath()
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2))
      return { success: true }
    } catch (err) {
      console.error('[AiService] Failed to save config:', err)
      return { success: false, error: err.message }
    }
  }

  getDefaultConfig() {
    return {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048,
      enabled: false
    }
  }

  getConfig() {
    const config = { ...this.config }
    if (config.apiKey) {
      config.apiKey = this.maskApiKey(config.apiKey)
    }
    return config
  }

  maskApiKey(key) {
    if (key.length <= 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'createDailyTask',
          description: '创建一个新的每日任务',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '任务标题' },
              date: { type: 'string', description: '任务日期，格式YYYY-MM-DD，默认为今天' }
            },
            required: ['title']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'createProject',
          description: '创建一个新项目',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '项目名称' },
              description: { type: 'string', description: '项目描述' },
              status: { type: 'string', enum: ['未开始', '进行中', '已暂停', '已完成'], description: '项目状态' },
              priority: { type: 'string', enum: ['低', '中', '高'], description: '优先级' }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'updateProject',
          description: '更新项目信息，包括名称、描述、状态、优先级、项目概况、项目进展等',
          parameters: {
            type: 'object',
            properties: {
              project_id: { type: 'number', description: '项目ID' },
              name: { type: 'string', description: '项目名称' },
              description: { type: 'string', description: '项目描述' },
              status: { type: 'string', enum: ['未开始', '进行中', '已暂停', '已完成'], description: '项目状态' },
              priority: { type: 'string', enum: ['低', '中', '高'], description: '优先级' },
              overview: { type: 'string', description: '项目概况' },
              progress: { type: 'string', description: '项目进展' }
            },
            required: ['project_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'createTask',
          description: '为指定项目创建一个任务。如果不确定项目ID，可以先使用 getProjects 查询',
          parameters: {
            type: 'object',
            properties: {
              project_id: { type: 'number', description: '项目ID' },
              name: { type: 'string', description: '任务名称' },
              status: { type: 'string', enum: ['待办', '进行中', '已完成'], description: '任务状态，默认为待办' },
              priority: { type: 'string', enum: ['低', '中', '高'], description: '优先级，默认为中' },
              due_date: { type: 'string', description: '截止日期，格式YYYY-MM-DD' },
              assignee: { type: 'string', description: '负责人姓名' },
              description: { type: 'string', description: '任务描述或上下文' },
              tags: { type: 'string', description: '标签，多个用逗号分隔' }
            },
            required: ['project_id', 'name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'updateTask',
          description: '更新任务信息，包括名称、状态、优先级、截止日期、负责人、描述、标签等',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'number', description: '任务ID' },
              name: { type: 'string', description: '任务名称' },
              status: { type: 'string', enum: ['待办', '进行中', '已完成'], description: '任务状态' },
              priority: { type: 'string', enum: ['低', '中', '高'], description: '优先级' },
              due_date: { type: 'string', description: '截止日期，格式YYYY-MM-DD' },
              assignee: { type: 'string', description: '负责人姓名' },
              description: { type: 'string', description: '任务描述或上下文' },
              tags: { type: 'string', description: '标签，多个用逗号分隔' }
            },
            required: ['task_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'deleteProject',
          description: '删除一个项目及其所有任务和附件',
          parameters: {
            type: 'object',
            properties: {
              project_id: { type: 'number', description: '项目ID' }
            },
            required: ['project_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'deleteTask',
          description: '删除一个任务',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'number', description: '任务ID' }
            },
            required: ['task_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getProjects',
          description: '获取所有项目列表',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getTasksByProjectId',
          description: '获取指定项目的所有任务',
          parameters: {
            type: 'object',
            properties: {
              project_id: { type: 'number', description: '项目ID' }
            },
            required: ['project_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'updateDailyTask',
          description: '更新每日任务的标题或日期',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'number', description: '每日任务ID' },
              title: { type: 'string', description: '新的任务标题' },
              date: { type: 'string', description: '新的任务日期，格式YYYY-MM-DD' }
            },
            required: ['task_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'updateDailyTaskStatus',
          description: '更新每日任务的完成状态',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'number', description: '每日任务ID' },
              is_completed: { type: 'boolean', description: '是否完成' }
            },
            required: ['task_id', 'is_completed']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'deleteDailyTask',
          description: '删除一个每日任务',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'number', description: '每日任务ID' }
            },
            required: ['task_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getDailyTasks',
          description: '获取指定日期的所有每日任务',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: '日期，格式YYYY-MM-DD，默认为今天' }
            }
          }
        }
      }
    ]
  }

  async executeTool(name, args) {
    try {
      switch (name) {
        case 'createDailyTask': {
          // 计算本地今天的日期
          const now = new Date()
          const localYear = now.getFullYear()
          const localMonth = String(now.getMonth() + 1).padStart(2, '0')
          const localDay = String(now.getDate()).padStart(2, '0')
          const localToday = `${localYear}-${localMonth}-${localDay}`

          // UTC 今天的日期（AI 可能使用这个）
          const utcToday = new Date().toISOString().split('T')[0]

          let date = args.date || localToday

          // 修正 AI 可能的时区错误或幻觉日期
          if (date === utcToday && date !== localToday) {
            // AI 使用了 UTC 的"今天"，替换为本地的"今天"
            console.log(`[AiService] Correcting UTC date ${date} to local date ${localToday}`)
            date = localToday
          } else if (args.date && Math.abs(new Date(args.date) - new Date(localToday)) > 30 * 24 * 60 * 60 * 1000) {
            // AI 传入了距离今天超过 30 天的日期，可能是幻觉，使用今天
            console.log(`[AiService] AI date ${args.date} is too far from today ${localToday}, using today`)
            date = localToday
          }

          console.log(`[AiService] Creating daily task: title="${args.title}", date=${date}, args.date=${args.date}, localToday=${localToday}, utcToday=${utcToday}`)

          const result = this.dbService.createDailyTask({
            title: args.title,
            date,
            is_completed: false
          })
          console.log(`[AiService] Daily task created:`, result)
          return { success: true, data: result, action: `创建了每日任务 "${args.title}"` }
        }
        case 'createProject': {
          const result = this.dbService.createProject({
            name: args.name,
            description: args.description || '',
            status: args.status || '未开始',
            priority: args.priority || '中'
          })
          return { success: true, data: result, action: `创建了项目 "${args.name}"` }
        }
        case 'updateProject': {
          const existing = this.dbService.getProjectById(args.project_id)
          if (!existing) return { success: false, error: `项目ID ${args.project_id} 不存在` }
          const updateData = {}
          if (args.name !== undefined) updateData.name = args.name
          if (args.description !== undefined) updateData.description = args.description
          if (args.status !== undefined) updateData.status = args.status
          if (args.priority !== undefined) updateData.priority = args.priority
          if (args.overview !== undefined) updateData.overview = args.overview
          if (args.progress !== undefined) updateData.progress = args.progress
          const result = this.dbService.updateProject(args.project_id, updateData)
          return { success: true, data: result, action: `更新了项目 "${existing.name}"` }
        }
        case 'createTask': {
          const result = this.dbService.createTask({
            project_id: args.project_id,
            name: args.name,
            status: args.status || '待办',
            priority: args.priority || '中',
            due_date: args.due_date || null,
            assignee: args.assignee || '',
            description: args.description || '',
            tags: args.tags || ''
          })
          return { success: true, data: result, action: `创建了任务 "${args.name}"` }
        }
        case 'updateTask': {
          const existing = this.dbService.getTaskById(args.task_id)
          if (!existing) return { success: false, error: `任务ID ${args.task_id} 不存在` }
          const updateData = {}
          if (args.name !== undefined) updateData.name = args.name
          if (args.status !== undefined) updateData.status = args.status
          if (args.priority !== undefined) updateData.priority = args.priority
          if (args.due_date !== undefined) updateData.due_date = args.due_date
          if (args.assignee !== undefined) updateData.assignee = args.assignee
          if (args.description !== undefined) updateData.description = args.description
          if (args.tags !== undefined) updateData.tags = args.tags
          const result = this.dbService.updateTask(args.task_id, updateData)
          return { success: true, data: result, action: `更新了任务 "${existing.name}"` }
        }
        case 'deleteProject': {
          const existing = this.dbService.getProjectById(args.project_id)
          if (!existing) return { success: false, error: `项目ID ${args.project_id} 不存在` }
          this.dbService.deleteProject(args.project_id)
          return { success: true, action: `删除了项目 "${existing.name}"` }
        }
        case 'deleteTask': {
          const existing = this.dbService.getTaskById(args.task_id)
          if (!existing) return { success: false, error: `任务ID ${args.task_id} 不存在` }
          this.dbService.deleteTask(args.task_id)
          return { success: true, action: `删除了任务 "${existing.name}"` }
        }
        case 'getProjects': {
          const result = this.dbService.getAllProjects()
          return { success: true, data: result }
        }
        case 'getTasksByProjectId': {
          const result = this.dbService.getTasksByProjectId(args.project_id)
          return { success: true, data: result }
        }
        case 'updateDailyTask': {
          const existing = this.dbService.getDailyTaskById(args.task_id)
          if (!existing) return { success: false, error: `每日任务ID ${args.task_id} 不存在` }
          const updateData = {}
          if (args.title !== undefined) updateData.title = args.title
          if (args.date !== undefined) updateData.date = args.date
          const result = this.dbService.updateDailyTask(args.task_id, updateData)
          return { success: true, data: result, action: `更新了每日任务 "${result.title}"` }
        }
        case 'updateDailyTaskStatus': {
          const result = this.dbService.toggleDailyTaskComplete(args.task_id, args.is_completed)
          return { success: true, data: result, action: `将每日任务标记为${args.is_completed ? '已完成' : '未完成'}` }
        }
        case 'deleteDailyTask': {
          const existing = this.dbService.getDailyTaskById(args.task_id)
          if (!existing) return { success: false, error: `每日任务ID ${args.task_id} 不存在` }
          this.dbService.deleteDailyTask(args.task_id)
          return { success: true, action: `删除了每日任务 "${existing.title}"` }
        }
        case 'getDailyTasks': {
          // 计算本地今天的日期
          const now = new Date()
          const year = now.getFullYear()
          const month = String(now.getMonth() + 1).padStart(2, '0')
          const day = String(now.getDate()).padStart(2, '0')
          const localToday = `${year}-${month}-${day}`

          let date = args.date || localToday

          // 修正 AI 可能的幻觉日期（超过30天的视为错误）
          if (args.date && Math.abs(new Date(args.date) - new Date(localToday)) > 30 * 24 * 60 * 60 * 1000) {
            console.log(`[AiService] AI query date ${args.date} is too far from today ${localToday}, using today`)
            date = localToday
          }

          const result = this.dbService.getDailyTasksByDate(date)
          return { success: true, data: result, action: `获取了 ${date} 的 ${result.length} 个每日任务` }
        }
        default:
          return { success: false, error: `未知工具: ${name}` }
      }
    } catch (err) {
      console.error(`[AiService] Tool execution error (${name}):`, err)
      return { success: false, error: err.message }
    }
  }

  extractToolCalls(assistantMessage) {
    let toolCalls = assistantMessage.tool_calls
    let isLegacyFormat = false

    if (!toolCalls && assistantMessage.function_call) {
      isLegacyFormat = true
      toolCalls = [{
        id: 'legacy_0',
        type: 'function',
        function: assistantMessage.function_call
      }]
    }

    if (!toolCalls && assistantMessage.content) {
      const extracted = this.extractToolCallFromContent(assistantMessage.content)
      if (extracted) {
        toolCalls = [{
          id: 'extracted_0',
          type: 'function',
          function: extracted
        }]
      }
    }

    return { toolCalls, isLegacyFormat }
  }

  async chat(messages, context = {}, enableTools = true, interactive = false) {
    if (!this.config.apiKey) {
      return { success: false, error: 'API Key not configured' }
    }

    this.shouldStop = false

    try {
      const systemPrompt = this.buildSystemPrompt(context)
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ]

      let url = this.config.endpoint
      if (!url.includes('/chat/completions')) {
        url = url.replace(/\/$/, '') + '/v1/chat/completions'
      }

      const tools = this.getTools()
      const QUERY_TOOLS = ['getProjects', 'getTasksByProjectId']
      const maxIterations = interactive ? 10 : 5
      let iteration = 0

      while (iteration < maxIterations) {
        if (this.shouldStop) {
          return { success: false, error: '已中断', stopped: true }
        }

        iteration++

        const requestBody = {
          model: this.config.model,
          messages: fullMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens
        }

        if (enableTools) {
          requestBody.tools = tools
          requestBody.tool_choice = 'auto'
        }

        this.currentAbortController = new AbortController()

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: this.currentAbortController.signal
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`API error (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const assistantMessage = data.choices?.[0]?.message

        if (!assistantMessage) {
          throw new Error('Empty response from API')
        }

        fullMessages.push(assistantMessage)

        const { toolCalls, isLegacyFormat } = this.extractToolCalls(assistantMessage)

        if (!toolCalls || toolCalls.length === 0) {
          return {
            success: true,
            content: String(assistantMessage.content || ''),
            usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : null
          }
        }

        if (interactive) {
          const hasModifyTool = toolCalls.some(tc => !QUERY_TOOLS.includes(tc.function.name))

          if (hasModifyTool) {
            // Only return pending for modify tools; auto-execute query tools first
            const queryToolCalls = toolCalls.filter(tc => QUERY_TOOLS.includes(tc.function.name))
            const modifyToolCalls = toolCalls.filter(tc => !QUERY_TOOLS.includes(tc.function.name))

            for (const toolCall of queryToolCalls) {
              if (toolCall.type === 'function') {
                let functionArgs
                try {
                  functionArgs = JSON.parse(toolCall.function.arguments)
                } catch (e) {
                  functionArgs = {}
                }
                const toolResult = await this.executeTool(toolCall.function.name, functionArgs)
                fullMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult)
                })
              }
            }

            let displayContent = assistantMessage.content || ''
            if (displayContent.length > 200 && (displayContent.includes('让我') || displayContent.includes('我需要') || displayContent.includes('工具'))) {
              displayContent = ''
            }

            return {
              success: true,
              type: 'pending',
              actions: modifyToolCalls.map(tc => ({
                id: tc.id,
                tool: tc.function.name,
                args: JSON.parse(tc.function.arguments || '{}')
              })),
              assistantMessage: {
                role: 'assistant',
                content: displayContent,
                tool_calls: modifyToolCalls
              }
            }
          }
          // If only query tools, auto-execute and continue loop like non-interactive
        }

        for (const toolCall of toolCalls) {
          if (toolCall.type === 'function') {
            const functionName = toolCall.function.name
            let functionArgs
            try {
              functionArgs = JSON.parse(toolCall.function.arguments)
            } catch (e) {
              functionArgs = {}
            }

            const toolResult = await this.executeTool(functionName, functionArgs)

            if (isLegacyFormat) {
              fullMessages.push({
                role: 'function',
                name: functionName,
                content: JSON.stringify(toolResult)
              })
            } else {
              fullMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult)
              })
            }
          }
        }
      }

      return { success: false, error: 'Tool call loop exceeded maximum iterations' }
    } catch (err) {
      if (this.shouldStop || err.name === 'AbortError' || err.message?.includes('abort')) {
        return { success: false, error: '已中断', stopped: true }
      }
      console.error('[AiService] Chat error:', err)
      return { success: false, error: String(err.message || err) }
    }
  }

  async executeActions(messages, context = {}) {
    if (!this.config.apiKey) {
      return { success: false, error: 'API Key not configured' }
    }

    try {
      const systemPrompt = this.buildExecutePrompt(context)
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ]

      let lastAssistantIndex = -1
      for (let i = fullMessages.length - 1; i >= 0; i--) {
        if (fullMessages[i].role === 'assistant') {
          if (fullMessages[i].tool_calls) {
            lastAssistantIndex = i
            break
          }
          const extracted = this.extractToolCallFromContent(fullMessages[i].content)
          if (extracted) {
            fullMessages[i] = {
              ...fullMessages[i],
              tool_calls: [{
                id: 'extracted_0',
                type: 'function',
                function: extracted
              }]
            }
            lastAssistantIndex = i
            break
          }
        }
      }

      if (lastAssistantIndex === -1) {
        return { success: false, error: '未找到待执行的操作' }
      }

      const assistantMsg = fullMessages[lastAssistantIndex]
      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type === 'function') {
          let functionArgs
          try {
            functionArgs = JSON.parse(toolCall.function.arguments)
          } catch (e) {
            functionArgs = {}
          }
          const toolResult = await this.executeTool(toolCall.function.name, functionArgs)
          fullMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          })
        }
      }

      let url = this.config.endpoint
      if (!url.includes('/chat/completions')) {
        url = url.replace(/\/$/, '') + '/v1/chat/completions'
      }

      this.currentAbortController = new AbortController()

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: fullMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens
        }),
        signal: this.currentAbortController.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API error (${response.status}): ${errorText}`)
      }

      const data = await response.json()
      const finalMessage = data.choices?.[0]?.message

      return {
        success: true,
        content: String(finalMessage?.content || ''),
        usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : null
      }
    } catch (err) {
      console.error('[AiService] Execute actions error:', err)
      return { success: false, error: String(err.message || err) }
    }
  }

  extractToolCallFromContent(content) {
    const trimmed = content.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
    try {
      const parsed = JSON.parse(trimmed)
      const knownTools = ['createDailyTask', 'createProject', 'updateProject', 'createTask', 'updateTask', 'deleteProject', 'deleteTask', 'getProjects', 'getTasksByProjectId', 'updateDailyTask', 'updateDailyTaskStatus', 'deleteDailyTask', 'getDailyTasks']

      const explicitName = parsed.tool || parsed.function
      if (explicitName && knownTools.includes(explicitName)) {
        return { name: explicitName, arguments: JSON.stringify(parsed.arguments || parsed.args || parsed) }
      }

      for (const tool of knownTools) {
        if (this.isValidToolArgs(tool, parsed)) {
          return { name: tool, arguments: JSON.stringify(parsed) }
        }
      }
    } catch (e) {
      // Not valid JSON
    }
    return null
  }

  isValidToolArgs(toolName, args) {
    switch (toolName) {
      case 'createDailyTask': return !!args.title
      case 'createProject': return !!args.name
      case 'updateProject': return !!args.project_id && (args.name !== undefined || args.overview !== undefined || args.progress !== undefined || args.status !== undefined || args.priority !== undefined || args.description !== undefined)
      case 'createTask': return !!args.project_id && !!args.name
      case 'updateTask': return !!args.task_id && (args.name !== undefined || args.status !== undefined || args.priority !== undefined || args.due_date !== undefined || args.assignee !== undefined || args.description !== undefined || args.tags !== undefined)
      case 'deleteProject': return !!args.project_id
      case 'deleteTask': return !!args.task_id
      case 'getProjects': return true
      case 'getTasksByProjectId': return !!args.project_id
      case 'updateDailyTask': return !!args.task_id && (args.title !== undefined || args.date !== undefined)
      case 'updateDailyTaskStatus': return args.task_id !== undefined && args.is_completed !== undefined
      case 'deleteDailyTask': return !!args.task_id
      case 'getDailyTasks': return true
      default: return false
    }
  }

  buildSystemPrompt(context) {
    const parts = []
    parts.push('你是一个专业的项目管理助手。')
    parts.push('重要规则：')
    parts.push('1. 你可以使用工具直接操作用户的数据。')
    parts.push('2. 当用户要求你执行数据操作时（创建、修改、删除项目/任务/每日任务），你必须直接调用对应工具。')
    parts.push('3. 不要输出思考过程，不要解释你为什么选择某个工具，不要反复检查工具列表。')
    parts.push('4. 如果需要调用工具，消息正文(content)保持为空或极简，不要写长篇大论。')
    parts.push('5. 查询类请求（如"列出所有项目"）可以直接执行并给出结果。')
    parts.push('6. 操作完成后，用一句话中文告诉用户结果。')

    if (context.currentProject) {
      parts.push(`\n当前项目: ${context.currentProject.name}`)
      parts.push(`项目状态: ${context.currentProject.status}`)
      if (context.currentProject.description) {
        parts.push(`项目描述: ${context.currentProject.description}`)
      }
    }

    if (context.tasks && context.tasks.length > 0) {
      parts.push(`\n相关任务 (${context.tasks.length}个):`)
      context.tasks.forEach(task => {
        parts.push(`- [${task.status}] ${task.name}`)
      })
    }

    if (context.dailyTasks && context.dailyTasks.length > 0) {
      parts.push(`\n今日任务 (${context.dailyTasks.length}个):`)
      context.dailyTasks.forEach(task => {
        parts.push(`- [${task.is_completed ? 'x' : ' '}] ${task.title}`)
      })
    }

    return parts.join('\n')
  }

  buildExecutePrompt(context) {
    const parts = []
    parts.push('你是一个专业的项目管理助手。')
    parts.push('工具已经执行完毕，结果已返回给你。')
    parts.push('请根据执行结果，用一句话中文简洁地告诉用户操作完成情况。')
    parts.push('不要输出思考过程，不要重复工具参数，不要建议用户做其他事情。')

    if (context.currentProject) {
      parts.push(`\n当前项目: ${context.currentProject.name}`)
    }

    return parts.join('\n')
  }
}

module.exports = { AiService }
