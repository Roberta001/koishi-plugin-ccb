import { Context } from 'koishi'
import { Config, CCBConfig } from './config'
import { applyDatabase } from './model'
import { CcbState } from './utils'
import { applyCommands } from './commands'

export const name = 'ccb'

// --- 注入数据库依赖 ---
export const inject = ['database', 'monetary']

declare module 'koishi' {
    interface Context {
        monetary: any
    }
}

// 导出相关配置和模型供其他地方扩展使用
export { Config }
export * from './config'
export * from './model'

export function apply(ctx: Context, config: CCBConfig) {
  // 1. 初始化数据库及迁移逻辑
  applyDatabase(ctx)

  // 2. 初始化缓存和状态
  const state = new CcbState(ctx)

  // 3. 注册命令
  applyCommands(ctx, config, state)

  // 4. 监听配置变化，处理重置操作
  ctx.on('ready', async () => {
    if (config.resetAllUsers && config.resetAllUsers !== 'none') {
      const mode = config.resetAllUsers

      if (mode === 'clear') {
        // 清空所有用户设置
        const allSettings = await ctx.database.get('ccb_setting', {})
        if (allSettings.length > 0) {
          await ctx.database.remove('ccb_setting', {})
          ctx.logger.info(`已清空 ${allSettings.length} 个用户的所有设置`)
        }
      } else {
        // 重置为 on 或 off
        const newOptOut = mode === 'off'
        const allSettings = await ctx.database.get('ccb_setting', {})
        const updates = allSettings.map(setting => ({
          userId: setting.userId,
          optOut: newOptOut,
          overrides: setting.overrides,
          lastToggleTime: setting.lastToggleTime,
          lastToggleTimes: setting.lastToggleTimes
        }))

        if (updates.length > 0) {
          await ctx.database.upsert('ccb_setting', updates)
          ctx.logger.info(`已将 ${updates.length} 个用户的全局状态重置为${mode === 'off' ? '保护' : '开放'}模式`)
        }
      }
    }
  })
}