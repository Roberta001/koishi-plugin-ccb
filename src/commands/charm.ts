import { Context } from 'koishi'
import { CcbState } from '../utils'

export function applyCharmCommand(ctx: Context, state: CcbState) {
    ctx.command('ccb/ccbcharm', '魅力榜 - 计算群中最受欢迎的群友')
        .action(async ({ session }) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            const w_num = 1.0
            const w_vol = 0.1
            const w_action = 0.5

            const groupData = await ctx.database.get('ccb_record', { groupId: session.guildId })
            if (!groupData.length) return '当前群暂无ccb记录。'

            // 预计算所有人的主动操作次数
            const actorActions: { [userId: string]: number } = {}
            for (const record of groupData) {
                const ccb_by = record.ccb_by || {}
                for (const actor_id in ccb_by) {
                    actorActions[actor_id] = (actorActions[actor_id] || 0) + ccb_by[actor_id].count
                }
            }

            const ranking = groupData.map(r => {
                const actions = actorActions[r.userId] || 0
                const val = r.num * w_num + r.vol * w_vol - actions * w_action
                return { userId: r.userId, val }
            }).sort((a, b) => b.val - a.val).slice(0, 5)

            const nicknameMap = new Map<string, string>()
            await Promise.all(ranking.map(async r => {
                nicknameMap.set(r.userId, await state.getUserNickname(session, r.userId))
            }))

            let msg = '💎 魅力榜 TOP5 💎\n'
            for (let i = 0; i < ranking.length; i++) {
                const { userId, val } = ranking[i]
                const nick = nicknameMap.get(userId) || userId
                msg += `${i + 1}. ${nick} - 魅力值：${val.toFixed(2)}\n`
            }

            return msg.trim()
        })
}
