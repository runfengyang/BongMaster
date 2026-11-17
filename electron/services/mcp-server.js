const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema
} = require('@modelcontextprotocol/sdk/types.js')
const { z } = require('zod')
const fs = require('fs')
const path = require('path')
const { DatabaseService } = require('./database-service')
const { grantBalatroReward } = require('./balatro-reward.cjs')

// §19 Balatro 金币：MCP 路径（绕过渲染进程挂接点）的生产力事件在此补发奖励。
// 静默兜底：发放失败绝不打断工具响应；发放成功在回复末尾附金币提示，方便业主感知。
function withBalatroReward(dbService, source, opts, message) {
  try {
    const r = grantBalatroReward(dbService, source, opts)
    if (r && r.gold > 0) return `${message}（🪙 +${r.gold} 金币）`
  } catch { /* 静默 */ }
  return message
}

class McpServerService {
  constructor(dbService) {
    this.dbService = dbService
    this.server = new Server(
      {
        name: 'bongmaster',
        version: '1.0.0'
      },
      {
        capabilities: { tools: {} }
      }
    )
    this.setupHandlers()
  }

  setupHandlers() {
    // 注册 initialize 处理
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'bongmaster',
          version: '1.0.0'
        }
      }
    })

    // 注册 list_tools 处理
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.getTools() }
    })

    // 注册 call_tool 处理
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await this.executeTool(request.params.name, request.params.arguments)
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `错误: ${error.message}`
            }
          ],
          isError: true
        }
      }
    })
  }

  getTools() {
    return [
      {
        name: 'list_projects',
        description: '获取所有项目列表',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_project',
        description: '获取项目详情，包括项目信息和任务列表',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'create_project',
        description: '创建一个新项目',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '项目名称'
            },
            description: {
              type: 'string',
              description: '项目描述'
            },
            status: {
              type: 'string',
              enum: ['未开始', '进行中', '已暂停', '已完成'],
              description: '项目状态，默认为"未开始"'
            },
            priority: {
              type: 'string',
              enum: ['低', '中', '高'],
              description: '优先级，默认为"中"'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'update_project',
        description: '更新项目信息，包括名称、描述、状态、优先级、项目概况、项目进展等',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            },
            name: {
              type: 'string',
              description: '项目名称'
            },
            description: {
              type: 'string',
              description: '项目描述'
            },
            status: {
              type: 'string',
              enum: ['未开始', '进行中', '已暂停', '已完成'],
              description: '项目状态'
            },
            priority: {
              type: 'string',
              enum: ['低', '中', '高'],
              description: '优先级'
            },
            overview: {
              type: 'string',
              description: '项目概况'
            },
            progress: {
              type: 'string',
              description: '项目进展'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'delete_project',
        description: '删除一个项目及其所有任务和附件',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'list_tasks',
        description: '获取指定项目的所有任务',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'get_task',
        description: '获取单个任务详情',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '任务ID'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'create_task',
        description: '为指定项目创建一个任务',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            },
            name: {
              type: 'string',
              description: '任务名称'
            },
            status: {
              type: 'string',
              enum: ['待办', '进行中', '已完成'],
              description: '任务状态，默认为"待办"'
            },
            priority: {
              type: 'string',
              enum: ['低', '中', '高'],
              description: '优先级，默认为"中"'
            },
            due_date: {
              type: 'string',
              description: '截止日期，格式YYYY-MM-DD'
            },
            assignee: {
              type: 'string',
              description: '负责人姓名'
            },
            description: {
              type: 'string',
              description: '任务描述或上下文'
            },
            tags: {
              type: 'string',
              description: '标签，多个用逗号分隔'
            }
          },
          required: ['project_id', 'name']
        }
      },
      {
        name: 'update_task',
        description: '更新任务信息，包括名称、状态、优先级、截止日期、负责人、描述、标签等',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '任务ID'
            },
            name: {
              type: 'string',
              description: '任务名称'
            },
            status: {
              type: 'string',
              enum: ['待办', '进行中', '已完成'],
              description: '任务状态'
            },
            priority: {
              type: 'string',
              enum: ['低', '中', '高'],
              description: '优先级'
            },
            due_date: {
              type: 'string',
              description: '截止日期，格式YYYY-MM-DD'
            },
            assignee: {
              type: 'string',
              description: '负责人姓名'
            },
            description: {
              type: 'string',
              description: '任务描述或上下文'
            },
            tags: {
              type: 'string',
              description: '标签，多个用逗号分隔'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'delete_task',
        description: '删除一个任务',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '任务ID'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'get_daily_tasks',
        description: '获取指定日期的所有每日任务，包含优先级、标签、关联项目、置顶、完成状态、子任务进度',
        inputSchema: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: '日期，格式YYYY-MM-DD，默认为今天'
            }
          },
          required: []
        }
      },
      {
        name: 'create_daily_task',
        description: '创建一个新的每日任务',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '任务标题'
            },
            date: {
              type: 'string',
              description: '任务日期，格式YYYY-MM-DD，默认为今天'
            },
            priority: {
              type: 'string',
              enum: ['高', '中', '低'],
              description: '优先级，默认为中'
            },
            tags: {
              type: 'string',
              description: '标签，多个用逗号分隔（旧字段，保留兼容）'
            },
            project_id: {
              type: ['number', 'null'],
              description: '关联项目ID，只能关联未开始/进行中的项目；不填则不关联'
            },
            notes: {
              type: 'string',
              description: '备注'
            },
            is_pinned: {
              type: 'boolean',
              description: '是否置顶'
            }
          },
          required: ['title']
        }
      },
      {
        name: 'update_daily_task',
        description: '更新每日任务，支持标题、日期、优先级、标签、关联项目、备注、置顶、完成状态',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '每日任务ID'
            },
            title: {
              type: 'string',
              description: '新的任务标题'
            },
            date: {
              type: 'string',
              description: '新的任务日期，格式YYYY-MM-DD'
            },
            priority: {
              type: 'string',
              enum: ['高', '中', '低'],
              description: '优先级'
            },
            tags: {
              type: 'string',
              description: '标签，多个用逗号分隔（旧字段，保留兼容）'
            },
            project_id: {
              type: ['number', 'null'],
              description: '关联项目ID；null 表示解除关联；只能关联未开始/进行中的项目'
            },
            notes: {
              type: 'string',
              description: '备注'
            },
            is_pinned: {
              type: 'boolean',
              description: '是否置顶'
            },
            is_completed: {
              type: 'boolean',
              description: '是否完成'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'update_daily_task_status',
        description: '更新每日任务的完成状态',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '每日任务ID'
            },
            is_completed: {
              type: 'boolean',
              description: '是否完成'
            }
          },
          required: ['task_id', 'is_completed']
        }
      },
      {
        name: 'delete_daily_task',
        description: '删除一个每日任务',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '每日任务ID'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'list_daily_subtasks',
        description: '获取指定每日任务的子任务列表',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '每日任务ID'
            }
          },
          required: ['task_id']
        }
      },
      {
        name: 'create_daily_subtask',
        description: '为指定每日任务创建一个子任务',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'number',
              description: '每日任务ID'
            },
            title: {
              type: 'string',
              description: '子任务标题'
            }
          },
          required: ['task_id', 'title']
        }
      },
      {
        name: 'update_daily_subtask',
        description: '更新每日任务子任务，支持标题和完成状态',
        inputSchema: {
          type: 'object',
          properties: {
            subtask_id: {
              type: 'number',
              description: '子任务ID'
            },
            title: {
              type: 'string',
              description: '新的子任务标题'
            },
            is_completed: {
              type: 'boolean',
              description: '是否完成'
            }
          },
          required: ['subtask_id']
        }
      },
      {
        name: 'delete_daily_subtask',
        description: '删除一个每日任务子任务',
        inputSchema: {
          type: 'object',
          properties: {
            subtask_id: {
              type: 'number',
              description: '子任务ID'
            }
          },
          required: ['subtask_id']
        }
      },
      // 提醒事项：列表 / 分区 / 提醒 / 附件
      {
        name: 'list_reminder_lists',
        description: '列出提醒事项列表，包含未完成数量',
        inputSchema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'create_reminder_list',
        description: '创建提醒事项列表',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '列表名称' },
            color: { type: 'string', description: '颜色 key，如 red/orange/green/blue/purple/gray' },
            icon: { type: 'string', description: '图标名，默认 list' },
            kind: { type: 'string', enum: ['standard', 'shopping'], description: '列表类型，默认 standard' }
          },
          required: ['name']
        }
      },
      {
        name: 'update_reminder_list',
        description: '修改提醒事项列表名称、颜色、图标、置顶或排序',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '列表ID' },
            name: { type: 'string', description: '新名称' },
            color: { type: 'string', description: '颜色 key' },
            icon: { type: 'string', description: '图标名' },
            is_pinned: { type: 'boolean', description: '是否置顶' },
            sort_order: { type: 'number', description: '排序值' }
          },
          required: ['list_id']
        }
      },
      {
        name: 'delete_reminder_list',
        description: '删除提醒事项列表，其中的提醒会移到最近删除',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '列表ID' }
          },
          required: ['list_id']
        }
      },
      {
        name: 'reorder_reminder_lists',
        description: '按给定顺序重排提醒事项列表',
        inputSchema: {
          type: 'object',
          properties: {
            list_ids: { type: 'array', items: { type: 'number' }, description: '按新顺序排列的列表ID数组' }
          },
          required: ['list_ids']
        }
      },
      {
        name: 'list_reminder_sections',
        description: '列出提醒事项分区，可按列表筛选',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '列表ID，不填则列出全部分区' }
          },
          required: []
        }
      },
      {
        name: 'create_reminder_section',
        description: '在指定列表中创建分区',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '列表ID' },
            name: { type: 'string', description: '分区名称' }
          },
          required: ['list_id', 'name']
        }
      },
      {
        name: 'update_reminder_section',
        description: '修改分区名称或折叠状态',
        inputSchema: {
          type: 'object',
          properties: {
            section_id: { type: 'number', description: '分区ID' },
            name: { type: 'string', description: '新名称' },
            is_collapsed: { type: 'boolean', description: '是否折叠' }
          },
          required: ['section_id']
        }
      },
      {
        name: 'delete_reminder_section',
        description: '删除分区，其中的提醒会回到未分区',
        inputSchema: {
          type: 'object',
          properties: {
            section_id: { type: 'number', description: '分区ID' }
          },
          required: ['section_id']
        }
      },
      {
        name: 'restore_reminder_section',
        description: '恢复刚删除的分区，并可把原提醒放回分区',
        inputSchema: {
          type: 'object',
          properties: {
            section_id: { type: 'number', description: '分区ID' },
            reminder_ids: { type: 'array', items: { type: 'number' }, description: '要放回分区的提醒ID数组' }
          },
          required: ['section_id']
        }
      },
      {
        name: 'list_reminders',
        description: '列出提醒事项，可按列表、完成状态、旗标、日期范围或关键词筛选',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '列表ID' },
            completed: { type: 'boolean', description: '按完成状态筛选' },
            flagged: { type: 'boolean', description: '按旗标筛选' },
            query: { type: 'string', description: '标题/备注/标签关键词' },
            date_from: { type: 'string', description: '开始日期 YYYY-MM-DD' },
            date_to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
            limit: { type: 'number', description: '返回上限，默认 200' }
          },
          required: []
        }
      },
      {
        name: 'get_reminder',
        description: '获取单条提醒的完整信息，含分区、子任务、附件',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_id: { type: 'number', description: '提醒ID（daily_tasks.id）' }
          },
          required: ['reminder_id']
        }
      },
      {
        name: 'create_reminder',
        description: '创建提醒事项，支持列表、分区、截止日期、提醒时间、优先级、旗标、标签、链接和重复规则',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            list_id: { type: 'number', description: '列表ID，不填使用默认列表' },
            section_id: { type: 'number', description: '分区ID' },
            project_id: { type: ['number', 'null'], description: '关联项目ID，null 表示不关联' },
            date: { type: 'string', description: '截止日期 YYYY-MM-DD，可留空表示无日期' },
            due_time: { type: 'string', description: '截止时间 HH:mm' },
            remind_time: { type: 'string', description: '提醒时间 HH:mm' },
            priority: { type: 'string', enum: ['无', '低', '中', '高'], description: '优先级，默认无' },
            is_flagged: { type: 'boolean', description: '是否加旗标' },
            tags: { type: 'string', description: '标签，多个用逗号分隔' },
            notes: { type: 'string', description: '备注' },
            url: { type: 'string', description: '关联链接' },
            recurrence_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'], description: '重复方式' },
            recurrence_value: { type: 'string', description: 'weekly 用 1,3,5；custom 用 数量:单位（day/week/month/year）' },
            recurrence_end_date: { type: 'string', description: '重复截止日期 YYYY-MM-DD' },
            repeat_from_completion: { type: 'boolean', description: '是否完成后才开始下一次' }
          },
          required: ['title']
        }
      },
      {
        name: 'update_reminder',
        description: '修改提醒事项的任意字段，包含完成状态（会自动生成下一次重复提醒）',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_id: { type: 'number', description: '提醒ID' },
            title: { type: 'string', description: '新标题' },
            list_id: { type: 'number', description: '移动到列表ID' },
            section_id: { type: 'number', description: '移动到分区ID，传 null 表示取消分区' },
            project_id: { type: ['number', 'null'], description: '关联项目ID，null 表示取消关联' },
            date: { type: 'string', description: '截止日期 YYYY-MM-DD，传空字符串表示清除' },
            due_time: { type: 'string', description: '截止时间 HH:mm' },
            remind_time: { type: 'string', description: '提醒时间 HH:mm' },
            priority: { type: 'string', enum: ['无', '低', '中', '高'], description: '优先级' },
            is_flagged: { type: 'boolean', description: '是否加旗标' },
            tags: { type: 'string', description: '标签' },
            notes: { type: 'string', description: '备注' },
            url: { type: 'string', description: '关联链接' },
            recurrence_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'], description: '重复方式' },
            recurrence_value: { type: 'string', description: '重复参数' },
            recurrence_end_date: { type: 'string', description: '重复截止日期' },
            repeat_from_completion: { type: 'boolean', description: '是否完成后才开始下一次' },
            is_completed: { type: 'boolean', description: '完成状态' }
          },
          required: ['reminder_id']
        }
      },
      {
        name: 'complete_reminder',
        description: '完成或取消完成提醒；完成重复提醒会生成下一次',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_id: { type: 'number', description: '提醒ID' },
            is_completed: { type: 'boolean', description: '是否完成，默认 true' }
          },
          required: ['reminder_id']
        }
      },
      {
        name: 'delete_reminder',
        description: '删除提醒（软删除，可在最近删除中恢复）',
        inputSchema: {
          type: 'object',
          properties: { reminder_id: { type: 'number', description: '提醒ID' } },
          required: ['reminder_id']
        }
      },
      {
        name: 'restore_reminder',
        description: '恢复最近删除的提醒',
        inputSchema: {
          type: 'object',
          properties: { reminder_id: { type: 'number', description: '提醒ID' } },
          required: ['reminder_id']
        }
      },
      {
        name: 'purge_reminder',
        description: '永久删除提醒及其子任务、附件，不可恢复',
        inputSchema: {
          type: 'object',
          properties: { reminder_id: { type: 'number', description: '提醒ID' } },
          required: ['reminder_id']
        }
      },
      {
        name: 'list_recently_deleted_reminders',
        description: '列出最近删除的提醒',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回上限，默认 50' }
          },
          required: []
        }
      },
      {
        name: 'move_reminders',
        description: '批量把提醒移动到另一个列表或分区',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_ids: { type: 'array', items: { type: 'number' }, description: '提醒ID数组' },
            list_id: { type: 'number', description: '目标列表ID' },
            section_id: { type: 'number', description: '目标分区ID，可空' }
          },
          required: ['reminder_ids', 'list_id']
        }
      },
      {
        name: 'duplicate_reminder',
        description: '复制一条提醒',
        inputSchema: {
          type: 'object',
          properties: { reminder_id: { type: 'number', description: '提醒ID' } },
          required: ['reminder_id']
        }
      },
      {
        name: 'clear_completed_reminders',
        description: '清理已完成的提醒（软删除）',
        inputSchema: {
          type: 'object',
          properties: {
            list_id: { type: 'number', description: '只清理指定列表，不填则全部' },
            before: { type: 'string', description: '只清理该时间之前完成的，格式 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss' }
          },
          required: []
        }
      },
      {
        name: 'reorder_reminders',
        description: '按给定顺序重排提醒，可同时指定分区',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_ids: { type: 'array', items: { type: 'number' }, description: '按新顺序排列的提醒ID数组' },
            section_id: { type: 'number', description: '分区ID；不填则保持原分区' }
          },
          required: ['reminder_ids']
        }
      },
      {
        name: 'list_reminder_attachments',
        description: '列出提醒的附件',
        inputSchema: {
          type: 'object',
          properties: { reminder_id: { type: 'number', description: '提醒ID' } },
          required: ['reminder_id']
        }
      },
      {
        name: 'add_reminder_attachment',
        description: '把本机文件作为附件添加到提醒（最大 50MB）',
        inputSchema: {
          type: 'object',
          properties: {
            reminder_id: { type: 'number', description: '提醒ID' },
            file_path: { type: 'string', description: '本机文件绝对路径' }
          },
          required: ['reminder_id', 'file_path']
        }
      },
      {
        name: 'delete_reminder_attachment',
        description: '删除提醒附件',
        inputSchema: {
          type: 'object',
          properties: { attachment_id: { type: 'number', description: '附件ID' } },
          required: ['attachment_id']
        }
      },
      {
        name: 'list_project_documents',
        description: '列出项目附件记录',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'create_document',
        description: '创建项目附件元数据记录（不上传文件内容）',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'number',
              description: '项目ID'
            },
            filename: {
              type: 'string',
              description: '存储文件名'
            },
            original_filename: {
              type: 'string',
              description: '原始文件名'
            },
            file_size: {
              type: 'number',
              description: '文件大小，单位字节'
            },
            mime_type: {
              type: 'string',
              description: 'MIME 类型'
            }
          },
          required: ['project_id', 'filename', 'original_filename']
        }
      },
      {
        name: 'update_document',
        description: '修改项目附件，可更新显示文件名、MIME 类型、文件大小，或用 base64 内容替换本地文件',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: {
              type: 'number',
              description: '附件ID'
            },
            original_filename: {
              type: 'string',
              description: '新的显示文件名'
            },
            mime_type: {
              type: 'string',
              description: '新的 MIME 类型'
            },
            file_size: {
              type: 'number',
              description: '文件大小，单位字节；未替换文件内容时可手动更新'
            },
            data_base64: {
              type: 'string',
              description: '新的文件内容，base64 编码；传入后文件大小自动按实际内容更新'
            }
          },
          required: ['document_id']
        }
      },
      {
        name: 'delete_document',
        description: '删除一个项目附件记录及其本地文件（如果存在）',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: {
              type: 'number',
              description: '附件ID'
            }
          },
          required: ['document_id']
        }
      },
      {
        name: 'get_statistics',
        description: '获取任务完成统计数据',
        inputSchema: {
          type: 'object',
          properties: {
            days: {
              type: 'number',
              description: '统计天数，默认为30天'
            }
          },
          required: []
        }
      },

      // 习惯
      {
        name: 'list_habits',
        description: '获取所有习惯列表（不含已归档）',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_habit',
        description: '获取习惯详情，包括最近打卡记录',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            }
          },
          required: ['habit_id']
        }
      },
      {
        name: 'create_habit',
        description: '创建一个新习惯',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '习惯名称'
            },
            color: {
              type: 'string',
              description: '颜色，例如 #10b981'
            },
            icon: {
              type: 'string',
              description: 'FontAwesome 图标类，例如 fas fa-fire'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'update_habit',
        description: '更新习惯信息',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            },
            name: {
              type: 'string',
              description: '习惯名称'
            },
            color: {
              type: 'string',
              description: '颜色'
            },
            icon: {
              type: 'string',
              description: '图标类'
            }
          },
          required: ['habit_id']
        }
      },
      {
        name: 'delete_habit',
        description: '删除一个习惯及其所有打卡记录',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            }
          },
          required: ['habit_id']
        }
      },
      {
        name: 'archive_habit',
        description: '归档或取消归档习惯',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            },
            is_archived: {
              type: 'boolean',
              description: '是否归档'
            }
          },
          required: ['habit_id', 'is_archived']
        }
      },

      // 习惯打卡
      {
        name: 'list_habit_checkins',
        description: '列出习惯打卡记录，可按习惯ID和日期范围筛选',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID（可选）'
            },
            start_date: {
              type: 'string',
              description: '开始日期 YYYY-MM-DD（可选）'
            },
            end_date: {
              type: 'string',
              description: '结束日期 YYYY-MM-DD（可选）'
            }
          },
          required: []
        }
      },
      {
        name: 'create_habit_checkin',
        description: '为习惯添加一条打卡记录',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            },
            checkin_date: {
              type: 'string',
              description: '打卡日期 YYYY-MM-DD，默认为今天'
            },
            level: {
              type: 'number',
              description: '打卡等级 1-4，默认为2'
            },
            note: {
              type: 'string',
              description: '备注'
            }
          },
          required: ['habit_id']
        }
      },
      {
        name: 'update_habit_checkin',
        description: '更新打卡记录的等级或备注',
        inputSchema: {
          type: 'object',
          properties: {
            checkin_id: {
              type: 'number',
              description: '打卡ID'
            },
            level: {
              type: 'number',
              description: '等级 1-4'
            },
            note: {
              type: 'string',
              description: '备注'
            }
          },
          required: ['checkin_id']
        }
      },
      {
        name: 'delete_habit_checkin',
        description: '删除一条打卡记录',
        inputSchema: {
          type: 'object',
          properties: {
            checkin_id: {
              type: 'number',
              description: '打卡ID'
            }
          },
          required: ['checkin_id']
        }
      },
      {
        name: 'checkin_today',
        description: '为指定习惯进行今日打卡（如果已存在则更新）',
        inputSchema: {
          type: 'object',
          properties: {
            habit_id: {
              type: 'number',
              description: '习惯ID'
            },
            level: {
              type: 'number',
              description: '等级 1-4，默认为2'
            },
            note: {
              type: 'string',
              description: '备注'
            }
          },
          required: ['habit_id']
        }
      },

      // 桌面便签
      {
        name: 'list_desktop_notes',
        description: '列出桌面便签，可按分类或项目筛选',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: '分类名称（可选）'
            },
            project_id: {
              type: 'number',
              description: '项目ID（可选）'
            }
          },
          required: []
        }
      },
      {
        name: 'get_desktop_note',
        description: '获取桌面便签详情',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'number',
              description: '便签ID'
            }
          },
          required: ['note_id']
        }
      },
      {
        name: 'create_desktop_note',
        description: '创建一个桌面便签',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: '标题'
            },
            content: {
              type: 'string',
              description: '内容'
            },
            category: {
              type: 'string',
              description: '分类'
            },
            project_ids: {
              type: 'array',
              items: { type: 'number' },
              description: '关联项目ID列表'
            }
          },
          required: ['content']
        }
      },
      {
        name: 'update_desktop_note',
        description: '更新桌面便签',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'number',
              description: '便签ID'
            },
            title: {
              type: 'string',
              description: '标题'
            },
            content: {
              type: 'string',
              description: '内容'
            },
            category: {
              type: 'string',
              description: '分类'
            },
            is_pinned: {
              type: 'boolean',
              description: '是否置顶'
            },
            project_ids: {
              type: 'array',
              items: { type: 'number' },
              description: '关联项目ID列表。传空数组表示取消所有项目关联'
            }
          },
          required: ['note_id']
        }
      },
      {
        name: 'patch_desktop_note',
        description: '对便签正文做精确局部替换：把 find 这段原文整体换成 replace，正文其他内容不动（比 update_desktop_note 传整段 content 安全）。默认要求 find 在正文中恰好出现一次，出现多次时须用更长的上下文、occurrence 指定第几次或 replace_all',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'number',
              description: '便签ID'
            },
            find: {
              type: 'string',
              description: '要被替换的原文片段，必须与便签正文完全一致'
            },
            replace: {
              type: 'string',
              description: '替换后的文本；传空字符串表示删除该片段'
            },
            occurrence: {
              type: 'number',
              description: 'find 出现多次时替换第几次（从 1 开始计），与 replace_all 互斥'
            },
            replace_all: {
              type: 'boolean',
              description: '是否替换全部匹配，默认 false，与 occurrence 互斥'
            },
            expected_content_hash: {
              type: 'string',
              description: '可选乐观并发校验：必须等于当前正文的内容哈希（get_desktop_note 会返回），不一致则拒绝替换'
            },
            expected_updated_at: {
              type: 'string',
              description: '可选乐观并发校验：必须等于当前便签更新时间（get_desktop_note 会返回）。注意精度为秒，同一秒内多次修改区分不了，优先用 expected_content_hash'
            }
          },
          required: ['note_id', 'find', 'replace']
        }
      },
      {
        name: 'delete_desktop_note',
        description: '删除一个桌面便签',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'number',
              description: '便签ID'
            }
          },
          required: ['note_id']
        }
      },

      // 分类
      {
        name: 'list_categories',
        description: '列出所有便签分类',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'create_category',
        description: '创建一个便签分类',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '分类名称'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'delete_category',
        description: '删除一个便签分类',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '分类名称'
            }
          },
          required: ['name']
        }
      },

      // 日历
      {
        name: 'list_calendar_labels',
        description: '列出本地日历标签（日程、课程、提醒事项及自定义标签），创建日程前可先查看可用标签',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'create_calendar_label',
        description: '创建本地日历标签（分类）',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '标签名称' },
            color: { type: 'string', description: '十六进制颜色，如 #3b82f6' },
            is_visible: { type: 'boolean', description: '是否显示，默认显示' },
            sort_order: { type: 'number', description: '排序值' }
          },
          required: ['name']
        }
      },
      {
        name: 'update_calendar_label',
        description: '修改日历标签名称、颜色、可见性或排序',
        inputSchema: {
          type: 'object',
          properties: {
            calendar_id: { type: 'number', description: '日历标签ID' },
            name: { type: 'string', description: '新名称' },
            color: { type: 'string', description: '十六进制颜色，如 #3b82f6' },
            is_visible: { type: 'boolean', description: '是否显示' },
            sort_order: { type: 'number', description: '排序值' }
          },
          required: ['calendar_id']
        }
      },
      {
        name: 'delete_calendar_label',
        description: '删除日历标签，其中的日程会移到「日程」；内置的日程/课程/提醒事项不能删除',
        inputSchema: {
          type: 'object',
          properties: {
            calendar_id: { type: 'number', description: '日历标签ID' }
          },
          required: ['calendar_id']
        }
      },
      {
        name: 'get_calendar_event',
        description: '获取单个日程的完整信息（含标签、重复规则、备注、地点）',
        inputSchema: {
          type: 'object',
          properties: {
            event_id: { type: 'number', description: '日程ID' }
          },
          required: ['event_id']
        }
      },
      {
        name: 'search_calendar_events',
        description: '按关键词搜索日程标题、备注和地点',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' }
          },
          required: ['query']
        }
      },
      {
        name: 'list_calendar_events',
        description: '按日期范围列出日历日程、课程或提醒事项。日期格式 YYYY-MM-DD',
        inputSchema: {
          type: 'object',
          properties: {
            start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
            end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
            calendar: { type: 'string', description: '可选：标签名，如 日程、课程、提醒事项' }
          },
          required: ['start_date', 'end_date']
        }
      },
      {
        name: 'create_calendar_event',
        description: '创建日历日程、课程或提醒事项。支持每天/工作日/每周/每月/每年/每年农历重复；农历重复用 recurrence_value="8,13"（农历月,农历日）',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
            end_date: { type: 'string', description: '结束日期 YYYY-MM-DD，可选，默认同开始日期' },
            start_time: { type: 'string', description: '开始时间 HH:mm，全天可省略' },
            end_time: { type: 'string', description: '结束时间 HH:mm，全天可省略' },
            all_day: { type: 'boolean', description: '是否全天；提醒事项会自动设为全天' },
            kind: { type: 'string', enum: ['event', 'class', 'reminder'], description: '类型，默认 event' },
            calendar: { type: 'string', description: '标签名，默认按 kind 选择 日程/课程/提醒事项' },
            location: { type: 'string', description: '地点' },
            notes: { type: 'string', description: '备注' },
            recurrence_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'lunarYearly'], description: '重复方式，默认 none' },
            recurrence_value: { type: 'string', description: 'weekly 用 1,3,5；lunarYearly 用 农历月,农历日，如 8,13' },
            recurrence_end_date: { type: 'string', description: '重复截止日期 YYYY-MM-DD，可选' }
          },
          required: ['title', 'start_date']
        }
      },
      {
        name: 'update_calendar_event',
        description: '修改日历日程、课程或提醒事项；重复日程可用 scope 指定仅此次/此次及未来/整个系列',
        inputSchema: {
          type: 'object',
          properties: {
            event_id: { type: 'number', description: '日程ID' },
            title: { type: 'string', description: '新标题' },
            start_date: { type: 'string', description: '新开始日期 YYYY-MM-DD' },
            end_date: { type: 'string', description: '新结束日期 YYYY-MM-DD' },
            start_time: { type: 'string', description: '新开始时间 HH:mm' },
            end_time: { type: 'string', description: '新结束时间 HH:mm' },
            all_day: { type: 'boolean', description: '是否全天' },
            calendar: { type: 'string', description: '新标签名' },
            location: { type: 'string', description: '地点' },
            notes: { type: 'string', description: '备注' },
            recurrence_type: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'lunarYearly'], description: '重复方式' },
            recurrence_value: { type: 'string', description: 'weekly 用 1,3,5；lunarYearly 用 农历月,农历日' },
            recurrence_end_date: { type: 'string', description: '重复截止日期 YYYY-MM-DD' },
            scope: { type: 'string', enum: ['this', 'future', 'all'], description: '重复日程修改范围，默认 all' },
            occurrence_date: { type: 'string', description: '重复日程的原日期 YYYY-MM-DD（scope 为 this/future 时必填）' }
          },
          required: ['event_id']
        }
      },
      {
        name: 'delete_calendar_event',
        description: '删除日历日程、课程或提醒事项；重复日程可只删某一次',
        inputSchema: {
          type: 'object',
          properties: {
            event_id: { type: 'number', description: '日程ID' },
            scope: { type: 'string', enum: ['this', 'future', 'all'], description: '删除范围，默认 all' },
            occurrence_date: { type: 'string', description: '重复日程的原日期 YYYY-MM-DD（scope 为 this/future 时必填）' }
          },
          required: ['event_id']
        }
      },
      {
        name: 'convert_lunar_date',
        description: '把农历日期转换成对应的阳历日期，用于创建每年农历重复的提醒（如农历生日）',
        inputSchema: {
          type: 'object',
          properties: {
            lunar_year: { type: 'number', description: '农历年，如 2026' },
            lunar_month: { type: 'number', description: '农历月 1-12' },
            lunar_day: { type: 'number', description: '农历日 1-30' }
          },
          required: ['lunar_year', 'lunar_month', 'lunar_day']
        }
      }
    ]
  }

  formatCalendarEvent(event, calendars = []) {
    const calendarName = calendars.find(item => item.id === event.calendar_id)?.name || ''
    const range = event.end_date !== event.start_date
      ? `${event.start_date} 至 ${event.end_date}`
      : event.start_date
    const time = event.all_day ? '全天' : `${event.start_time || ''}-${event.end_time || ''}`
    const recurrence = event.recurrence_type && event.recurrence_type !== 'none'
      ? ` | 重复: ${event.recurrence_type}${event.recurrence_value ? ` ${event.recurrence_value}` : ''}${event.recurrence_end_date ? ` 至 ${event.recurrence_end_date}` : ''}`
      : ''
    return `ID: ${event.id} | ${range} | ${time} | ${event.title} | 标签: ${calendarName}${event.location ? ` | 地点: ${event.location}` : ''}${event.notes ? ` | 备注: ${event.notes}` : ''}${recurrence}`
  }

  formatReminderLine(item) {
    const meta = []
    if (item.list_name) meta.push(`列表:${item.list_name}`)
    if (item.section_name) meta.push(`分区:${item.section_name}`)
    if (item.is_flagged) meta.push('旗标')
    if (item.priority && item.priority !== '无') meta.push(item.priority)
    if (item.tags) meta.push(item.tags)
    const due = item.date ? `${item.date}${item.due_time ? ` ${item.due_time}` : ''}` : '无日期'
    const recurrence = item.recurrence_type && item.recurrence_type !== 'none'
      ? ` | 重复:${item.recurrence_type}${item.recurrence_value ? ` ${item.recurrence_value}` : ''}`
      : ''
    const notes = item.notes ? ` | 备注: ${String(item.notes).replace(/\n/g, ' ').slice(0, 80)}` : ''
    return `[${item.is_completed ? 'x' : ' '}] ID:${item.id} | ${item.title} | ${due}${meta.length ? ` | ${meta.join(' | ')}` : ''}${notes}${recurrence}`
  }

  async executeTool(name, args) {
    switch (name) {
      case 'list_projects': {
        const projects = this.dbService.getAllProjects()
        if (projects.length === 0) {
          return '暂无项目'
        }
        return projects.map(p =>
          `ID: ${p.id} | 名称: ${p.name} | 状态: ${p.status} | 优先级: ${p.priority} | 任务数: ${p.task_count || 0}`
        ).join('\n')
      }

      case 'get_project': {
        const project = this.dbService.getProjectById(args.project_id)
        if (!project) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
        let result = `项目详情:\n` +
          `ID: ${project.id}\n` +
          `名称: ${project.name}\n` +
          `描述: ${project.description || '无'}\n` +
          `状态: ${project.status}\n` +
          `优先级: ${project.priority}\n` +
          `概况: ${project.overview || '无'}\n` +
          `进展: ${project.progress || '无'}\n` +
          `创建时间: ${project.created_at}\n`
        if (project.tasks && project.tasks.length > 0) {
          result += `\n任务列表 (${project.tasks.length}个):\n` +
            project.tasks.map(t =>
              `  - [${t.status}] ${t.name} (ID: ${t.id}, 优先级: ${t.priority})`
            ).join('\n')
        } else {
          result += '\n暂无任务'
        }
        return result
      }

      case 'create_project': {
        const result = this.dbService.createProject({
          name: args.name,
          description: args.description || '',
          status: args.status || '未开始',
          priority: args.priority || '中'
        })
        return `成功创建项目: ${result.name} (ID: ${result.id})`
      }

      case 'update_project': {
        const existing = this.dbService.getProjectById(args.project_id)
        if (!existing) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
        const updateData = {}
        if (args.name !== undefined) updateData.name = args.name
        if (args.description !== undefined) updateData.description = args.description
        if (args.status !== undefined) updateData.status = args.status
        if (args.priority !== undefined) updateData.priority = args.priority
        if (args.overview !== undefined) updateData.overview = args.overview
        if (args.progress !== undefined) updateData.progress = args.progress
        this.dbService.updateProject(args.project_id, updateData)
        return `成功更新项目 "${existing.name}"`
      }

      case 'delete_project': {
        const existing = this.dbService.getProjectById(args.project_id)
        if (!existing) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
        this.dbService.deleteProject(args.project_id)
        return `成功删除项目 "${existing.name}"`
      }

      case 'list_tasks': {
        const tasks = this.dbService.getTasksByProjectId(args.project_id)
        if (tasks.length === 0) {
          return '该项目暂无任务'
        }
        return tasks.map(t =>
          `ID: ${t.id} | 名称: ${t.name} | 状态: ${t.status} | 优先级: ${t.priority} | 负责人: ${t.assignee || '未分配'}`
        ).join('\n')
      }

      case 'get_task': {
        const task = this.dbService.getTaskById(args.task_id)
        if (!task) {
          throw new Error(`任务ID ${args.task_id} 不存在`)
        }
        return `任务详情:\n` +
          `ID: ${task.id}\n` +
          `名称: ${task.name}\n` +
          `状态: ${task.status}\n` +
          `优先级: ${task.priority}\n` +
          `负责人: ${task.assignee || '未分配'}\n` +
          `截止日期: ${task.due_date || '未设置'}\n` +
          `项目ID: ${task.project_id}\n` +
          `创建时间: ${task.created_at || '未知'}`
      }

      case 'create_task': {
        const project = this.dbService.getProjectById(args.project_id)
        if (!project) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
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
        return `成功创建任务: ${result.name} (ID: ${result.id})`
      }

      case 'update_task': {
        const existing = this.dbService.getTaskById(args.task_id)
        if (!existing) {
          throw new Error(`任务ID ${args.task_id} 不存在`)
        }
        const updateData = {}
        if (args.name !== undefined) updateData.name = args.name
        if (args.status !== undefined) updateData.status = args.status
        if (args.priority !== undefined) updateData.priority = args.priority
        if (args.due_date !== undefined) updateData.due_date = args.due_date
        if (args.assignee !== undefined) updateData.assignee = args.assignee
        if (args.description !== undefined) updateData.description = args.description
        if (args.tags !== undefined) updateData.tags = args.tags
        this.dbService.updateTask(args.task_id, updateData)
        // §19：项目任务「未完成 → 已完成」跃迁发金币（状态值与渲染端 task-store 一致：'已完成'）
        if (updateData.status === '已完成' && existing.status !== '已完成') {
          return withBalatroReward(this.dbService, 'project_task', {}, `成功更新任务 "${existing.name}"`)
        }
        return `成功更新任务 "${existing.name}"`
      }

      case 'delete_task': {
        const existing = this.dbService.getTaskById(args.task_id)
        if (!existing) {
          throw new Error(`任务ID ${args.task_id} 不存在`)
        }
        this.dbService.deleteTask(args.task_id)
        return `成功删除任务 "${existing.name}"`
      }

      case 'get_daily_tasks': {
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const localToday = `${year}-${month}-${day}`
        const date = args.date || localToday
        const tasks = this.dbService.getDailyTasksByDate(date)
        if (tasks.length === 0) {
          return `${date} 暂无每日任务`
        }
        const formatTask = (t) => {
          const badges = []
          if (t.priority) badges.push(t.priority)
          if (t.project_name) badges.push(`项目:${t.project_name}`)
          else if (t.project_id) badges.push(`项目#${t.project_id}`)
          if (t.tags) badges.push(t.tags)
          if (t.is_pinned) badges.push('置顶')
          const badgeStr = badges.length ? ` [${badges.join(', ')}]` : ''
          return `[${t.is_completed ? 'x' : ' '}] ${t.title}${badgeStr} (ID: ${t.id})`
        }
        return `每日任务 (${date}):\n` + tasks.map(formatTask).join('\n')
      }

      case 'create_daily_task': {
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const localToday = `${year}-${month}-${day}`
        const date = args.date || localToday
        const result = this.dbService.createDailyTask({
          title: args.title,
          date: date,
          is_completed: false,
          priority: args.priority,
          tags: args.tags,
          notes: args.notes,
          is_pinned: args.is_pinned,
          project_id: args.project_id
        })
        const projectNote = result.project_name ? `，关联项目「${result.project_name}」` : ''
        return `成功创建每日任务: ${result.title} (ID: ${result.id})${projectNote}`
      }

      case 'update_daily_task': {
        const existing = this.dbService.getDailyTaskById(args.task_id)
        if (!existing) {
          throw new Error(`每日任务ID ${args.task_id} 不存在`)
        }
        const updateData = {}
        if (args.title !== undefined) updateData.title = args.title
        if (args.date !== undefined) updateData.date = args.date
        if (args.priority !== undefined) updateData.priority = args.priority
        if (args.tags !== undefined) updateData.tags = args.tags
        if (args.notes !== undefined) updateData.notes = args.notes
        if (args.is_pinned !== undefined) updateData.is_pinned = args.is_pinned
        if (args.is_completed !== undefined) updateData.is_completed = args.is_completed
        if (args.project_id !== undefined) updateData.project_id = args.project_id
        const updated = this.dbService.updateDailyTask(args.task_id, updateData)
        const projectNote = args.project_id === undefined
          ? ''
          : (updated?.project_name ? `，关联项目「${updated.project_name}」` : '，已解除项目关联')
        // §19：仅「未完成 → 完成」跃迁发金币
        if (updateData.is_completed && !existing.is_completed) {
          return withBalatroReward(this.dbService, 'task', {}, `成功更新每日任务${projectNote}`)
        }
        return `成功更新每日任务${projectNote}`
      }

      case 'update_daily_task_status': {
        const before = this.dbService.getDailyTaskById(args.task_id)
        this.dbService.toggleDailyTaskComplete(args.task_id, args.is_completed)
        const msg = `每日任务已标记为${args.is_completed ? '已完成' : '未完成'}`
        // §19：仅「未完成 → 完成」跃迁发金币（与渲染端 reminder-store 语义一致）
        if (args.is_completed && before && !before.is_completed) {
          return withBalatroReward(this.dbService, 'task', {}, msg)
        }
        return msg
      }

      case 'delete_daily_task': {
        const existing = this.dbService.getDailyTaskById(args.task_id)
        if (!existing) {
          throw new Error(`每日任务ID ${args.task_id} 不存在`)
        }
        this.dbService.deleteDailyTask(args.task_id)
        return `成功删除每日任务 "${existing.title}"`
      }

      case 'list_daily_subtasks': {
        const existing = this.dbService.getDailyTaskById(args.task_id)
        if (!existing) {
          throw new Error(`每日任务ID ${args.task_id} 不存在`)
        }
        const subtasks = this.dbService.getDailySubtasks(args.task_id)
        if (subtasks.length === 0) {
          return '暂无子任务'
        }
        return `子任务列表:\n` +
          subtasks.map(s =>
            `[${s.is_completed ? 'x' : ' '}] ${s.title} (ID: ${s.id})`
          ).join('\n')
      }

      case 'create_daily_subtask': {
        const existing = this.dbService.getDailyTaskById(args.task_id)
        if (!existing) {
          throw new Error(`每日任务ID ${args.task_id} 不存在`)
        }
        const result = this.dbService.createDailySubtask(args.task_id, { title: args.title })
        return `成功创建子任务: ${result.title} (ID: ${result.id})`
      }

      case 'update_daily_subtask': {
        const existing = this.dbService.getDailySubtaskById(args.subtask_id)
        if (!existing) {
          throw new Error(`子任务ID ${args.subtask_id} 不存在`)
        }
        const updateData = {}
        if (args.title !== undefined) updateData.title = args.title
        if (args.is_completed !== undefined) updateData.is_completed = args.is_completed
        this.dbService.updateDailySubtask(args.subtask_id, updateData)
        return `成功更新子任务`
      }

      case 'delete_daily_subtask': {
        const existing = this.dbService.getDailySubtaskById(args.subtask_id)
        if (!existing) {
          throw new Error(`子任务ID ${args.subtask_id} 不存在`)
        }
        this.dbService.deleteDailySubtask(args.subtask_id)
        return `成功删除子任务 "${existing.title}"`
      }

      // ===== 提醒事项（列表 / 分区 / 提醒 / 附件） =====

      case 'list_reminder_lists': {
        const lists = this.dbService.getReminderLists()
        if (!lists.length) return '暂无提醒列表'
        return lists.map(list =>
          `ID: ${list.id} | ${list.name} | 颜色: ${list.color || 'blue'} | 未完成: ${list.open_count || 0}${list.is_pinned ? ' | 置顶' : ''}`
        ).join('\n')
      }

      case 'create_reminder_list': {
        const list = this.dbService.createReminderList({
          name: args.name,
          color: args.color,
          icon: args.icon,
          kind: args.kind
        })
        return `成功创建提醒列表: ${list.name} (ID: ${list.id})`
      }

      case 'update_reminder_list': {
        const existing = this.dbService.getReminderListById(args.list_id)
        if (!existing) throw new Error(`提醒列表ID ${args.list_id} 不存在`)
        const updated = this.dbService.updateReminderList(args.list_id, {
          name: args.name,
          color: args.color,
          icon: args.icon,
          is_pinned: args.is_pinned,
          sort_order: args.sort_order
        })
        return `成功更新提醒列表: ${updated.name} (ID: ${updated.id})`
      }

      case 'delete_reminder_list': {
        const existing = this.dbService.getReminderListById(args.list_id)
        if (!existing) throw new Error(`提醒列表ID ${args.list_id} 不存在`)
        const result = this.dbService.deleteReminderList(args.list_id)
        return `成功删除提醒列表 "${existing.name}"${result?.moved ? `，${result.moved} 条提醒已移到最近删除` : ''}`
      }

      case 'reorder_reminder_lists': {
        this.dbService.reorderReminderLists(args.list_ids)
        return `成功重排 ${args.list_ids.length} 个提醒列表`
      }

      case 'list_reminder_sections': {
        const sections = this.dbService.getReminderSections(args.list_id || null)
        if (!sections.length) return '暂无提醒分区'
        const lists = new Map(this.dbService.getReminderLists().map(list => [list.id, list.name]))
        return sections.map(section =>
          `ID: ${section.id} | ${section.name} | 列表: ${lists.get(section.list_id) || section.list_id}${section.is_collapsed ? ' | 折叠' : ''}`
        ).join('\n')
      }

      case 'create_reminder_section': {
        const list = this.dbService.getReminderListById(args.list_id)
        if (!list) throw new Error(`提醒列表ID ${args.list_id} 不存在`)
        const section = this.dbService.createReminderSection(args.list_id, { name: args.name })
        return `成功创建分区: ${section.name} (ID: ${section.id})`
      }

      case 'update_reminder_section': {
        const existing = this.dbService.getReminderSectionById(args.section_id)
        if (!existing) throw new Error(`分区ID ${args.section_id} 不存在`)
        const updated = this.dbService.updateReminderSection(args.section_id, {
          name: args.name,
          is_collapsed: args.is_collapsed
        })
        return `成功更新分区: ${updated.name} (ID: ${updated.id})`
      }

      case 'delete_reminder_section': {
        const existing = this.dbService.getReminderSectionById(args.section_id)
        if (!existing) throw new Error(`分区ID ${args.section_id} 不存在`)
        const result = this.dbService.deleteReminderSection(args.section_id)
        const ids = result?.reminderIds || []
        return `成功删除分区 "${existing.name}"${ids.length ? `，${ids.length} 条提醒已回到未分区（提醒ID: ${ids.join(',')}）` : ''}`
      }

      case 'restore_reminder_section': {
        const restored = this.dbService.restoreReminderSection(args.section_id, args.reminder_ids || [])
        if (!restored) throw new Error('分区不存在或已永久删除')
        return `成功恢复分区 "${restored.name}" (ID: ${restored.id})`
      }

      case 'list_reminders': {
        let items = this.dbService.getAllReminders()
        if (args.list_id !== undefined) items = items.filter(item => item.list_id === Number(args.list_id))
        if (args.completed !== undefined) items = items.filter(item => Boolean(item.is_completed) === Boolean(args.completed))
        if (args.flagged !== undefined) items = items.filter(item => Boolean(item.is_flagged) === Boolean(args.flagged))
        if (args.date_from) items = items.filter(item => item.date && item.date >= args.date_from)
        if (args.date_to) items = items.filter(item => item.date && item.date <= args.date_to)
        if (args.query) {
          const query = String(args.query).toLowerCase()
          items = items.filter(item => [item.title, item.notes, item.tags].some(value => String(value || '').toLowerCase().includes(query)))
        }
        if (!items.length) return '没有符合条件的提醒'
        const limit = Math.max(1, Math.min(Number(args.limit) || 200, 500))
        const shown = items.slice(0, limit)
        return `提醒事项 (${shown.length}/${items.length}, 未完成 ${items.filter(item => !item.is_completed).length}):\n` +
          shown.map(item => this.formatReminderLine(item)).join('\n')
      }

      case 'get_reminder': {
        const reminder = this.dbService.getReminderById(args.reminder_id)
        if (!reminder) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        const subtasks = this.dbService.getDailySubtasks(args.reminder_id)
        const attachments = this.dbService.getReminderAttachments(args.reminder_id)
        const lines = [
          `ID: ${reminder.id}`,
          `标题: ${reminder.title}`,
          `列表: ${reminder.list_name || '无'} (${reminder.list_id || '-'})`,
          `分区: ${reminder.section_name || '无'}`,
          `项目: ${reminder.project_id ? (this.dbService.getProjectById(reminder.project_id)?.name || `#${reminder.project_id}`) : '无'}`,
          `日期: ${reminder.date || '无'}${reminder.due_time ? ` ${reminder.due_time}` : ''}`,
          `提醒时间: ${reminder.remind_time || '无'}`,
          `优先级: ${reminder.priority || '无'}`,
          `旗标: ${reminder.is_flagged ? '是' : '否'}`,
          `完成: ${reminder.is_completed ? '是' : '否'}${reminder.completed_at ? ` (${reminder.completed_at})` : ''}`,
          `标签: ${reminder.tags || '无'}`,
          `链接: ${reminder.url || '无'}`,
          `重复: ${reminder.recurrence_type || 'none'}${reminder.recurrence_value ? ` ${reminder.recurrence_value}` : ''}${reminder.recurrence_end_date ? ` 至 ${reminder.recurrence_end_date}` : ''}`,
          `备注: ${reminder.notes || '无'}`,
          `创建: ${reminder.created_at}`,
          `更新: ${reminder.updated_at}`
        ]
        if (subtasks.length) {
          lines.push('子任务:', ...subtasks.map(subtask => `  [${subtask.is_completed ? 'x' : ' '}] ${subtask.title} (ID: ${subtask.id})`))
        }
        if (attachments.length) {
          lines.push('附件:', ...attachments.map(file => `  ${file.original_filename} (ID: ${file.id})`))
        }
        return lines.join('\n')
      }

      case 'create_reminder': {
        const payload = { title: args.title }
        for (const key of ['list_id', 'section_id', 'project_id', 'date', 'due_time', 'remind_time', 'priority', 'is_flagged', 'tags', 'notes', 'url', 'recurrence_type', 'recurrence_value', 'recurrence_end_date', 'repeat_from_completion']) {
          if (args[key] !== undefined) payload[key] = args[key]
        }
        const created = this.dbService.createReminder(payload)
        return `成功创建提醒: ${created.title} (ID: ${created.id}, 列表: ${created.list_name || '默认'})`
      }

      case 'update_reminder': {
        const existing = this.dbService.getReminderById(args.reminder_id)
        if (!existing) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        const patch = {}
        for (const key of ['title', 'list_id', 'section_id', 'project_id', 'date', 'due_time', 'remind_time', 'priority', 'is_flagged', 'tags', 'notes', 'url', 'recurrence_type', 'recurrence_value', 'recurrence_end_date', 'repeat_from_completion']) {
          if (args[key] !== undefined) patch[key] = args[key]
        }
        if (Object.keys(patch).length) this.dbService.updateReminder(args.reminder_id, patch)
        let result = this.dbService.getReminderById(args.reminder_id)
        let next = null
        if (args.is_completed !== undefined) {
          const toggle = this.dbService.toggleReminderComplete(args.reminder_id, args.is_completed)
          result = toggle?.reminder || result
          next = toggle?.next || null
        }
        let message = `成功更新提醒: ${result.title} (ID: ${result.id})`
        if (next) message += `\n已生成下一次提醒: ${next.title} (ID: ${next.id}, ${next.date || '无日期'})`
        if (args.is_completed === true && !existing.is_completed) {
          message = withBalatroReward(this.dbService, 'task', {}, message)
        }
        return message
      }

      case 'complete_reminder': {
        const existing = this.dbService.getReminderById(args.reminder_id)
        if (!existing) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        const target = args.is_completed !== false
        const result = this.dbService.toggleReminderComplete(args.reminder_id, target)
        if (!result?.reminder) throw new Error('更新完成状态失败')
        let message = `提醒 "${result.reminder.title}" 已标记为${target ? '已完成' : '未完成'}`
        if (result.next) message += `\n已生成下一次提醒: ${result.next.title} (ID: ${result.next.id}, ${result.next.date || '无日期'})`
        if (target && !existing.is_completed) {
          message = withBalatroReward(this.dbService, 'task', {}, message)
        }
        return message
      }

      case 'delete_reminder': {
        const existing = this.dbService.getReminderById(args.reminder_id)
        if (!existing) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        this.dbService.deleteReminder(args.reminder_id)
        return `成功删除提醒 "${existing.title}"，已移入最近删除，可用 restore_reminder 恢复`
      }

      case 'restore_reminder': {
        const result = this.dbService.restoreReminders([args.reminder_id])
        if (!result?.restored) throw new Error('恢复失败，提醒可能不在最近删除中')
        return `成功恢复 ${result.restored} 条提醒`
      }

      case 'purge_reminder': {
        const existing = this.dbService.getReminderById(args.reminder_id)
        if (existing) {
          this.dbService.purgeReminder(args.reminder_id)
          return `已永久删除提醒 "${existing.title}"`
        }
        this.dbService.purgeReminder(args.reminder_id)
        return `已永久删除提醒ID ${args.reminder_id}`
      }

      case 'list_recently_deleted_reminders': {
        const limit = Math.max(1, Math.min(Number(args.limit) || 50, 300))
        const items = this.dbService.getRecentlyDeletedReminders(limit)
        if (!items.length) return '最近删除为空'
        return `最近删除 (${items.length}):\n` + items.map(item =>
          `ID:${item.id} | ${item.title} | 删除于: ${item.deleted_at || '-'}${item.list_name ? ` | 列表:${item.list_name}` : ''}`
        ).join('\n')
      }

      case 'move_reminders': {
        this.dbService.moveRemindersToList(args.reminder_ids, args.list_id, args.section_id ?? null)
        return `成功移动 ${args.reminder_ids.length} 条提醒`
      }

      case 'duplicate_reminder': {
        const created = this.dbService.duplicateReminder(args.reminder_id)
        if (!created) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        return `成功复制提醒: ${created.title} (新ID: ${created.id})`
      }

      case 'clear_completed_reminders': {
        const result = this.dbService.clearCompletedReminders(args.list_id || null, args.before || null)
        return `已清理 ${result.ids?.length || 0} 条已完成提醒（移入最近删除）`
      }

      case 'reorder_reminders': {
        this.dbService.reorderReminders(args.reminder_ids, args.section_id)
        return `成功重排 ${args.reminder_ids.length} 条提醒`
      }

      case 'list_reminder_attachments': {
        const attachments = this.dbService.getReminderAttachments(args.reminder_id)
        if (!attachments.length) return '该提醒暂无附件'
        return attachments.map(file =>
          `ID: ${file.id} | ${file.original_filename} | ${file.file_size || 0} B | ${file.mime_type || ''}`
        ).join('\n')
      }

      case 'add_reminder_attachment': {
        const reminder = this.dbService.getReminderById(args.reminder_id)
        if (!reminder) throw new Error(`提醒ID ${args.reminder_id} 不存在`)
        const filePath = path.resolve(String(args.file_path || ''))
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          throw new Error(`文件不存在: ${filePath}`)
        }
        const stat = fs.statSync(filePath)
        if (stat.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50MB')
        const attachment = this.dbService.addReminderAttachment(args.reminder_id, {
          name: path.basename(filePath),
          buffer: fs.readFileSync(filePath),
          mime_type: 'application/octet-stream'
        })
        return `成功添加附件: ${attachment.original_filename} (ID: ${attachment.id})`
      }

      case 'delete_reminder_attachment': {
        const existing = this.dbService.getReminderAttachmentById(args.attachment_id)
        if (!existing) throw new Error(`附件ID ${args.attachment_id} 不存在`)
        this.dbService.deleteReminderAttachment(args.attachment_id)
        return `成功删除附件 "${existing.original_filename}"`
      }

      case 'list_project_documents': {
        const project = this.dbService.getProjectById(args.project_id)
        if (!project) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
        const documents = this.dbService.getDocumentsByProjectId(args.project_id)
        if (documents.length === 0) {
          return '该项目暂无附件'
        }
        return documents.map(d =>
          `ID: ${d.id} | ${d.original_filename} | 存储名: ${d.filename} | 大小: ${Math.round((d.file_size || 0) / 1024)}KB | 类型: ${d.mime_type || '未知'}`
        ).join('\n')
      }

      case 'create_document': {
        const project = this.dbService.getProjectById(args.project_id)
        if (!project) {
          throw new Error(`项目ID ${args.project_id} 不存在`)
        }
        const doc = this.dbService.createDocument({
          project_id: args.project_id,
          filename: args.filename,
          original_filename: args.original_filename,
          file_size: args.file_size || 0,
          mime_type: args.mime_type || ''
        })
        return `成功创建附件元数据: ${doc.original_filename} (ID: ${doc.id})`
      }

      case 'update_document': {
        const existing = this.dbService.getDocumentById(args.document_id)
        if (!existing) {
          throw new Error(`附件ID ${args.document_id} 不存在`)
        }
        const doc = this.dbService.updateDocument(args.document_id, {
          original_filename: args.original_filename,
          mime_type: args.mime_type,
          file_size: args.file_size,
          data_base64: args.data_base64
        })
        return `成功更新附件: ${doc.original_filename} (ID: ${doc.id})`
      }

      case 'delete_document': {
        const existing = this.dbService.getDocumentById(args.document_id)
        if (!existing) {
          throw new Error(`附件ID ${args.document_id} 不存在`)
        }
        this.dbService.deleteDocument(args.document_id)
        return `成功删除附件 "${existing.original_filename}"`
      }

      case 'get_statistics': {
        const days = args.days || 30
        const stats = this.dbService.getTaskCompletionStats(days)
        const avgTime = this.dbService.getAverageCompletionTime()
        const busiestDays = this.dbService.getBusiestDays(days)

        let result = `任务统计 (最近${days}天):\n`
        if (stats.length > 0) {
          const totalCompleted = stats.reduce((sum, s) => sum + s.count, 0)
          result += `完成总数: ${totalCompleted} 个任务\n`
        } else {
          result += '暂无完成数据\n'
        }

        if (avgTime > 0) {
          result += `平均完成时间: ${Math.round(avgTime)} 分钟\n`
        }

        if (busiestDays.length > 0) {
          result += `\n最忙的日子:\n`
          busiestDays.forEach(d => {
            result += `  ${d.completed_date}: ${d.count} 个任务\n`
          })
        }

        return result
      }

      // 习惯
      case 'list_habits': {
        const habits = this.dbService.getAllHabits()
        if (habits.length === 0) {
          return '暂无习惯'
        }
        return habits.map(h =>
          `ID: ${h.id} | 名称: ${h.name} | 图标: ${h.icon} | 颜色: ${h.color} | 打卡次数: ${h.checkin_count || 0}`
        ).join('\n')
      }

      case 'get_habit': {
        const habit = this.dbService.getHabitById(args.habit_id)
        if (!habit) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        const checkins = this.dbService.getHabitCheckins(args.habit_id)
        let result = `习惯详情:\n` +
          `ID: ${habit.id}\n` +
          `名称: ${habit.name}\n` +
          `图标: ${habit.icon}\n` +
          `颜色: ${habit.color}\n` +
          `总打卡次数: ${checkins.length}\n` +
          `状态: ${habit.is_archived ? '已归档' : '活跃'}\n`
        if (checkins.length > 0) {
          result += `\n最近打卡记录:\n` +
            checkins.slice(0, 10).map(c =>
              `  - ${c.checkin_date} | 等级 ${c.level}${c.note ? ` | ${c.note}` : ''}`
            ).join('\n')
        }
        return result
      }

      case 'create_habit': {
        const result = this.dbService.createHabit({
          name: args.name,
          color: args.color,
          icon: args.icon
        })
        return `成功创建习惯: ${result.name} (ID: ${result.id})`
      }

      case 'update_habit': {
        const existing = this.dbService.getHabitById(args.habit_id)
        if (!existing) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        const updateData = {}
        if (args.name !== undefined) updateData.name = args.name
        if (args.color !== undefined) updateData.color = args.color
        if (args.icon !== undefined) updateData.icon = args.icon
        this.dbService.updateHabit(args.habit_id, updateData)
        return `成功更新习惯 "${existing.name}"`
      }

      case 'delete_habit': {
        const existing = this.dbService.getHabitById(args.habit_id)
        if (!existing) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        this.dbService.deleteHabit(args.habit_id)
        return `成功删除习惯 "${existing.name}"`
      }

      case 'archive_habit': {
        const existing = this.dbService.getHabitById(args.habit_id)
        if (!existing) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        this.dbService.archiveHabit(args.habit_id, args.is_archived)
        return `习惯 "${existing.name}" 已${args.is_archived ? '归档' : '取消归档'}`
      }

      // 习惯打卡
      case 'list_habit_checkins': {
        const checkins = args.habit_id
          ? this.dbService.getHabitCheckins(args.habit_id, args.start_date, args.end_date)
          : this.dbService.getAllCheckins(args.start_date, args.end_date)
        if (checkins.length === 0) {
          return '暂无打卡记录'
        }
        return checkins.map(c =>
          `ID: ${c.id} | 习惯: ${c.habit_name} | 日期: ${c.checkin_date} | 等级: ${c.level}${c.note ? ` | 备注: ${c.note}` : ''}`
        ).join('\n')
      }

      case 'create_habit_checkin': {
        const habit = this.dbService.getHabitById(args.habit_id)
        if (!habit) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const localToday = `${year}-${month}-${day}`
        const result = this.dbService.createHabitCheckin({
          habit_id: args.habit_id,
          checkin_date: args.checkin_date || localToday,
          level: args.level || 2,
          note: args.note || ''
        })
        return withBalatroReward(this.dbService, 'checkin',
          { habitId: args.habit_id, date: result.checkin_date },
          `成功为 "${habit.name}" 打卡: ${result.checkin_date} (等级 ${result.level})`)
      }

      case 'update_habit_checkin': {
        const existing = this.dbService.getHabitCheckinById(args.checkin_id)
        if (!existing) {
          throw new Error(`打卡ID ${args.checkin_id} 不存在`)
        }
        const updateData = {}
        if (args.level !== undefined) updateData.level = args.level
        if (args.note !== undefined) updateData.note = args.note
        this.dbService.updateHabitCheckin(args.checkin_id, updateData)
        return `成功更新打卡记录 (ID: ${args.checkin_id})`
      }

      case 'delete_habit_checkin': {
        const existing = this.dbService.getHabitCheckinById(args.checkin_id)
        if (!existing) {
          throw new Error(`打卡ID ${args.checkin_id} 不存在`)
        }
        this.dbService.deleteHabitCheckin(args.checkin_id)
        return `成功删除打卡记录 (ID: ${args.checkin_id})`
      }

      case 'checkin_today': {
        const habit = this.dbService.getHabitById(args.habit_id)
        if (!habit) {
          throw new Error(`习惯ID ${args.habit_id} 不存在`)
        }
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const today = `${year}-${month}-${day}`
        const existing = this.dbService.getCheckinByDate(args.habit_id, today)
        if (existing) {
          this.dbService.updateHabitCheckin(existing.id, {
            level: args.level || existing.level,
            note: args.note !== undefined ? args.note : existing.note
          })
          return `更新 "${habit.name}" 今日打卡 (等级 ${args.level || existing.level})`
        }
        const result = this.dbService.createHabitCheckin({
          habit_id: args.habit_id,
          checkin_date: today,
          level: args.level || 2,
          note: args.note || ''
        })
        return withBalatroReward(this.dbService, 'checkin',
          { habitId: args.habit_id, date: today },
          `成功为 "${habit.name}" 今日打卡 (等级 ${result.level})`)
      }

      // 桌面便签
      case 'list_desktop_notes': {
        const notes = args.project_id
          ? this.dbService.getDesktopNotesByProject(args.project_id)
          : this.dbService.getDesktopNotes(args.category)
        if (notes.length === 0) {
          return '暂无便签'
        }
        return notes.map(n => {
          const content = n.content || ''
          let text = `ID: ${n.id} | ${n.title || '无标题'} | ${content.substring(0, 40)}${content.length > 40 ? '...' : ''}`
          if (n.category) text += ` | 分类: ${n.category}`
          if (n.linked_projects?.length) text += ` | 项目: ${n.linked_projects.map(p => `${p.name}(ID:${p.id})`).join(', ')}`
          if (n.is_pinned) text += ` [置顶]`
          return text
        }).join('\n')
      }

      case 'get_desktop_note': {
        const note = this.dbService.getDesktopNoteById(args.note_id)
        if (!note) {
          throw new Error(`便签ID ${args.note_id} 不存在`)
        }
        return `便签详情:\n` +
          `ID: ${note.id}\n` +
          `标题: ${note.title || '无标题'}\n` +
          `分类: ${note.category || '无'}\n` +
          `关联项目: ${note.linked_projects?.length ? note.linked_projects.map(p => `${p.name}(ID:${p.id})`).join(', ') : '无'}\n` +
          `置顶: ${note.is_pinned ? '是' : '否'}\n` +
          `更新时间: ${note.updated_at}\n` +
          `内容哈希: ${note.content_hash}\n` +
          `内容:\n${note.content}`
      }

      case 'create_desktop_note': {
        const result = this.dbService.createDesktopNote({
          title: args.title || '',
          content: args.content,
          category: args.category || '',
          project_ids: Array.isArray(args.project_ids) ? args.project_ids : []
        })
        return `成功创建便签: ${result.title || '无标题'} (ID: ${result.id})`
      }

      case 'update_desktop_note': {
        const existing = this.dbService.getDesktopNoteById(args.note_id)
        if (!existing) {
          throw new Error(`便签ID ${args.note_id} 不存在`)
        }
        const updateData = {}
        if (args.title !== undefined) updateData.title = args.title
        if (args.content !== undefined) updateData.content = args.content
        if (args.category !== undefined) updateData.category = args.category
        if (args.is_pinned !== undefined) updateData.is_pinned = args.is_pinned
        if (args.project_ids !== undefined) updateData.project_ids = args.project_ids
        this.dbService.updateDesktopNote(args.note_id, updateData)
        return `成功更新便签 (ID: ${args.note_id})`
      }

      case 'patch_desktop_note': {
        const noteId = Number(args.note_id)
        if (!Number.isInteger(noteId) || noteId <= 0) {
          throw new Error('note_id 必须是正整数')
        }
        if (typeof args.find !== 'string' || args.find.length === 0) {
          throw new Error('find 不能为空字符串')
        }
        if (typeof args.replace !== 'string') {
          throw new Error('replace 必须是字符串（删除片段时传空字符串）')
        }
        const occurrence = args.occurrence ?? undefined
        const replaceAll = args.replace_all ?? undefined
        const expectedHash = args.expected_content_hash ?? undefined
        const expectedUpdatedAt = args.expected_updated_at ?? undefined
        if (replaceAll !== undefined && typeof replaceAll !== 'boolean') {
          throw new Error('replace_all 必须是布尔值')
        }
        if (occurrence !== undefined) {
          if (!Number.isInteger(occurrence) || occurrence < 1) {
            throw new Error('occurrence 必须是从 1 开始的整数')
          }
          if (replaceAll === true) {
            throw new Error('occurrence 与 replace_all 互斥，只能指定一个')
          }
        }
        if (expectedHash !== undefined && typeof expectedHash !== 'string') {
          throw new Error('expected_content_hash 必须是字符串')
        }
        if (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') {
          throw new Error('expected_updated_at 必须是字符串')
        }

        const result = this.dbService.patchDesktopNote(noteId, {
          find: args.find,
          replace: args.replace,
          occurrence,
          replace_all: replaceAll === true,
          expected_content_hash: expectedHash,
          expected_updated_at: expectedUpdatedAt
        })
        const note = result.note
        const content = note.content || ''
        const preview = content.slice(0, 60)
        return `成功替换 ${result.replaced} 处 (ID: ${noteId})\n` +
          `标题: ${note.title || '无标题'}\n` +
          `分类: ${note.category || '无'}\n` +
          `正文长度: ${content.length} 字符\n` +
          `更新时间: ${note.updated_at}\n` +
          `内容哈希: ${note.content_hash}\n` +
          `摘要: ${preview}${content.length > 60 ? '...' : ''}`
      }

      case 'delete_desktop_note': {
        const existing = this.dbService.getDesktopNoteById(args.note_id)
        if (!existing) {
          throw new Error(`便签ID ${args.note_id} 不存在`)
        }
        this.dbService.deleteDesktopNote(args.note_id)
        return `成功删除便签 (ID: ${args.note_id})`
      }

      // 分类
      case 'list_categories': {
        const categories = this.dbService.getAllCategories()
        if (categories.length === 0) {
          return '暂无分类'
        }
        return categories.map(c => c.name).join('\n')
      }

      case 'create_category': {
        const result = this.dbService.createCategory(args.name)
        if (!result.success) {
          throw new Error(result.error || '创建分类失败')
        }
        return `成功创建分类: ${result.name} (ID: ${result.id})`
      }

      case 'delete_category': {
        if (!args.name || typeof args.name !== 'string') {
          throw new Error('分类名称不能为空')
        }
        const existing = this.dbService.getAllCategories().find(c => c.name === args.name)
        if (!existing) {
          throw new Error(`分类 "${args.name}" 不存在`)
        }
        this.dbService.deleteCategory(args.name)
        return `成功删除分类 "${args.name}"`
      }

      // 日历
      case 'list_calendar_labels': {
        const calendars = this.dbService.getCalendarCalendars()
        if (!calendars.length) return '暂无日历标签'
        return calendars.map(calendar =>
          `ID: ${calendar.id} | ${calendar.name} | 颜色: ${calendar.color} | ${calendar.is_visible ? '显示' : '隐藏'}`
        ).join('\n')
      }

      case 'create_calendar_label': {
        const calendar = this.dbService.createCalendar({
          name: args.name,
          color: args.color,
          is_visible: args.is_visible,
          sort_order: args.sort_order
        })
        return `成功创建日历标签: ${calendar.name} (ID: ${calendar.id})`
      }

      case 'update_calendar_label': {
        const calendars = this.dbService.getCalendarCalendars()
        const existing = calendars.find(item => item.id === Number(args.calendar_id))
        if (!existing) throw new Error(`日历标签ID ${args.calendar_id} 不存在`)
        const updated = this.dbService.updateCalendar(args.calendar_id, {
          name: args.name,
          color: args.color,
          is_visible: args.is_visible,
          sort_order: args.sort_order
        })
        return `成功更新日历标签: ${updated.name} (ID: ${updated.id})`
      }

      case 'delete_calendar_label': {
        const calendars = this.dbService.getCalendarCalendars()
        const existing = calendars.find(item => item.id === Number(args.calendar_id))
        if (!existing) throw new Error(`日历标签ID ${args.calendar_id} 不存在`)
        this.dbService.deleteCalendar(args.calendar_id)
        return `成功删除日历标签 "${existing.name}"，其中的日程已移到「日程」`
      }

      case 'get_calendar_event': {
        const event = this.dbService.getCalendarEventById(args.event_id)
        if (!event) throw new Error(`日程ID ${args.event_id} 不存在`)
        return this.formatCalendarEvent(event, this.dbService.getCalendarCalendars())
      }

      case 'search_calendar_events': {
        const events = this.dbService.searchCalendarEvents(args.query)
        if (!events.length) return `没有找到匹配 "${args.query}" 的日程`
        const calendars = this.dbService.getCalendarCalendars()
        return events.map(event => this.formatCalendarEvent(event, calendars)).join('\n')
      }

      case 'list_calendar_events': {
        const data = this.dbService.getCalendarData(args.start_date, args.end_date)
        let events = data.events
        if (args.calendar) {
          const calendar = data.calendars.find(item => item.name === args.calendar)
          if (!calendar) throw new Error(`日历标签 "${args.calendar}" 不存在`)
          events = events.filter(item => item.calendar_id === calendar.id)
        }
        if (!events.length) return '该日期范围内暂无日程'
        return events.map(event => this.formatCalendarEvent(event, data.calendars)).join('\n')
      }

      case 'create_calendar_event': {
        const kind = args.kind || 'event'
        const defaultName = kind === 'class' ? '课程' : kind === 'reminder' ? '提醒事项' : '日程'
        const calendarName = args.calendar || defaultName
        const calendar = this.dbService.getCalendarCalendars().find(item => item.name === calendarName)
        if (!calendar) throw new Error(`日历标签 "${calendarName}" 不存在，可用标签：${this.dbService.getCalendarCalendars().map(item => item.name).join('、')}`)
        const isAllDay = kind === 'reminder' ? true : Boolean(args.all_day)
        const event = this.dbService.createCalendarEvent({
          calendar_id: calendar.id,
          title: args.title,
          kind,
          start_date: args.start_date,
          end_date: args.end_date || args.start_date,
          start_time: isAllDay ? null : (args.start_time || '09:00'),
          end_time: isAllDay ? null : (args.end_time || '10:00'),
          all_day: isAllDay ? 1 : 0,
          location: args.location || '',
          notes: args.notes || '',
          recurrence_type: args.recurrence_type || 'none',
          recurrence_value: args.recurrence_value || '',
          recurrence_end_date: args.recurrence_end_date || null
        })
        return `成功创建${kind === 'reminder' ? '提醒事项' : kind === 'class' ? '课程' : '日程'}: ${event.title} (ID: ${event.id})`
      }

      case 'update_calendar_event': {
        const existing = this.dbService.getCalendarEventById(args.event_id)
        if (!existing) throw new Error(`日程ID ${args.event_id} 不存在`)
        const updateData = {}
        for (const key of ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'location', 'notes', 'recurrence_type', 'recurrence_value', 'recurrence_end_date']) {
          if (args[key] !== undefined) updateData[key] = args[key]
        }
        if (args.all_day !== undefined) updateData.all_day = args.all_day ? 1 : 0
        if (args.calendar !== undefined) {
          const calendar = this.dbService.getCalendarCalendars().find(item => item.name === args.calendar)
          if (!calendar) throw new Error(`日历标签 "${args.calendar}" 不存在`)
          updateData.calendar_id = calendar.id
        }
        const options = args.scope ? { scope: args.scope, occurrenceDate: args.occurrence_date } : {}
        this.dbService.updateCalendarEvent(args.event_id, updateData, options)
        return `成功更新日程 "${existing.title}"`
      }

      case 'delete_calendar_event': {
        const existing = this.dbService.getCalendarEventById(args.event_id)
        if (!existing) throw new Error(`日程ID ${args.event_id} 不存在`)
        const options = args.scope ? { scope: args.scope, occurrenceDate: args.occurrence_date } : { scope: 'all' }
        this.dbService.deleteCalendarEvent(args.event_id, options)
        return `成功删除日程 "${existing.title}"`
      }

      case 'convert_lunar_date': {
        const { LunarDay } = await import('tyme4ts')
        const solar = LunarDay.fromYmd(args.lunar_year, args.lunar_month, args.lunar_day).getSolarDay()
        return `农历 ${args.lunar_year} 年 ${args.lunar_month} 月 ${args.lunar_day} 日 = 阳历 ${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`
      }

      default:
        throw new Error(`未知工具: ${name}`)
    }
  }

  async connect(transport) {
    await this.server.connect(transport)
  }

  async start() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('[MCP] Server started on stdio')
  }
}

module.exports = { McpServerService }
