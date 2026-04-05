import { Context, Session } from 'koishi'
import { CcbState } from '../utils'

export function applyRankCommands(ctx: Context, state: CcbState) {
    // 通用排行榜生成函数
    async function buildRanking<T extends { userId: string }>(
        session: Session,
        title: string,
        data: T[],
        formatLine: (item: T, nick: string, index: number) => string
    ): Promise<string> {
        const nicknameMap = new Map<string, string>()
        await Promise.all(data.map(async r => {
            nicknameMap.set(r.userId, await state.getUserNickname(session, r.userId))
        }))

        let msg = `${title}\n`
        for (let i = 0; i < data.length; i++) {
            const nick = nicknameMap.get(data[i].userId) || data[i].userId
            msg += formatLine(data[i], nick, i)
        }
        return msg.trim()
    }

    ctx.command('ccb/ccbtop', '按次数排行')
        .action(async ({ session }) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            const groupData = await ctx.database.get('ccb_record', { groupId: session.guildId })
            if (!groupData.length) return '当前群暂无ccb记录。'

            const top5 = groupData.sort((a, b) => b.num - a.num).slice(0, 5)
            return buildRanking(session, '被ccb排行榜 TOP5：', top5,
                (r, nick, i) => `${i + 1}. ${nick} - 次数：${r.num}\n`
            )
        })

    ctx.command('ccb/ccbvol', '按注入量排行')
        .action(async ({ session }) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            const groupData = await ctx.database.get('ccb_record', { groupId: session.guildId })
            if (!groupData.length) return '当前群暂无ccb记录。'

            const top5 = groupData.sort((a, b) => b.vol - a.vol).slice(0, 5)
            return buildRanking(session, '被注入量排行榜 TOP5：', top5,
                (r, nick, i) => `${i + 1}. ${nick} - 累计注入：${r.vol.toFixed(2)}ml\n`
            )
        })

    ctx.command('ccb/ccbmax', '按max值排行并输出产生者')
        .action(async ({ session }) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            const groupData = await ctx.database.get('ccb_record', { groupId: session.guildId })
            if (!groupData.length) return '当前群暂无ccb记录。'

            // 计算并排序
            const entries = groupData.map(r => {
                let max_val = r.max
                if (!max_val) {
                    if (r.num > 0) max_val = parseFloat((r.vol / r.num).toFixed(2))
                    else max_val = 0.0
                }
                return { record: r, max: max_val }
            }).sort((a, b) => b.max - a.max).slice(0, 5)

            const userIds: string[] = []
            const producerIds: (string | null)[] = []

            for (const item of entries) {
                const r = item.record
                userIds.push(r.userId)

                let producer_id = null
                const ccb_by = r.ccb_by || {}

                // 优先找 max 标记
                for (const actor_id in ccb_by) {
                    if (ccb_by[actor_id].max) {
                        producer_id = actor_id
                        break
                    }
                }

                // 没找到标记则找次数最多的
                if (!producer_id && Object.keys(ccb_by).length > 0) {
                    let maxCount = -1
                    for (const actor_id in ccb_by) {
                        if (ccb_by[actor_id].count > maxCount) {
                            maxCount = ccb_by[actor_id].count
                            producer_id = actor_id
                        }
                    }
                }

                producerIds.push(producer_id)
                if (producer_id) userIds.push(producer_id)
            }

            // 批量获取昵称
            const uniqueUserIds = [...new Set(userIds)]
            const nicknameMap = new Map<string, string>()
            await Promise.all(uniqueUserIds.map(async uid => {
                nicknameMap.set(uid, await state.getUserNickname(session, uid))
            }))

            let msg = '单次最大注入排行榜 TOP5：\n'
            for (let i = 0; i < entries.length; i++) {
                const { record, max } = entries[i]
                const nick = nicknameMap.get(record.userId) || record.userId
                const pid = producerIds[i]
                const producer_nick = pid ? (nicknameMap.get(pid) || '未知') : '未知'
                msg += `${i + 1}. ${nick} - 单次最大：${max.toFixed(2)}ml（${producer_nick}）\n`
            }

            return msg.trim()
        })
}
