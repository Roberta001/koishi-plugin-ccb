import { Context } from 'koishi'
import { promises as fs } from 'fs'
import * as path from 'path'

// --- 数据库表结构定义 ---

// 记录表：对应原来的 groupData 中的每一项
export interface CCBRecord {
    groupId: string
    userId: string // 即 targetId
    num: number
    vol: number
    max: number
    ccb_by: {
        [actorId: string]: {
            count: number
            first: boolean
            max: boolean
        }
    }
}

// 用户设置表：用于存储 -off/-on 的状态
export interface CCBUserSetting {
    userId: string
    optOut: boolean // true 表示拒绝被 ccb
    lastToggleTime: number
    overrides: Record<string, boolean>
    lastToggleTimes?: Record<string, number> // 存储全局及各个指定用户的独立冷却时间
}

declare module 'koishi' {
    interface Tables {
        ccb_record: CCBRecord
        ccb_setting: CCBUserSetting
    }
}

export function applyDatabase(ctx: Context) {
    // --- 1. 定义数据库模型 ---
    ctx.model.extend('ccb_record', {
        groupId: 'string',
        userId: 'string',
        num: 'unsigned',
        vol: 'double',
        max: 'double',
        ccb_by: 'json',
    }, {
        primary: ['groupId', 'userId'], // 联合主键
    })

    ctx.model.extend('ccb_setting', {
        userId: 'string',
        optOut: 'boolean',
        lastToggleTime: 'double',
        overrides: 'json',
        lastToggleTimes: 'json',
    }, {
        primary: 'userId',
    })

    // --- 2. 数据迁移逻辑 (Old JSON -> Database) ---
    ctx.on('ready', async () => {
        const DATA_FILE = path.join(ctx.baseDir, 'data', 'ccb.json')
        try {
            await fs.access(DATA_FILE) // 检查文件是否存在
            console.log('[ccb] 检测到旧版数据文件，正在迁移至数据库...')

            const fileContent = await fs.readFile(DATA_FILE, 'utf-8')
            const jsonData = JSON.parse(fileContent)

            const ops = []
            for (const groupId in jsonData) {
                const groupRecords = jsonData[groupId]
                if (Array.isArray(groupRecords)) {
                    for (const record of groupRecords) {
                        ops.push(
                            ctx.database.upsert('ccb_record', [{
                                groupId: groupId,
                                userId: record.id,
                                num: record.num,
                                vol: record.vol,
                                max: record.max,
                                ccb_by: record.ccb_by
                            }])
                        )
                    }
                }
            }

            await Promise.all(ops)

            // 迁移完成后重命名文件，防止下次启动重复迁移
            const BACKUP_FILE = path.join(ctx.baseDir, 'data', 'ccb.json.migrated')
            await fs.rename(DATA_FILE, BACKUP_FILE)
            console.log(`[ccb] 数据迁移完成，旧文件已重命名为 ${BACKUP_FILE}`)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('[ccb] 数据迁移过程中出错:', error)
            }
            // 文件不存在则无需迁移
        }
    })
}
