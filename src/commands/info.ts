import { Context } from 'koishi'
import { CcbState } from '../utils'

export function applyInfoCommand(ctx: Context, state: CcbState) {
    ctx.command('ccb/ccbinfo [target:user]', '查询某人ccb信息')
        .action(async ({ session }, target: string) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            // 使用通用的目标用户查找逻辑，与 ccb 命令保持一致
            let targetUserId = await state.validateTargetUser(session, target)
            if (targetUserId.startsWith('无法找到')) {
                return targetUserId
            }

            const [record] = await ctx.database.get('ccb_record', { groupId: session.guildId, userId: targetUserId })
            if (!record) return '该用户暂无ccb记录。'

            const total_num = record.num
            const total_vol = record.vol
            const max_val = record.max || (total_num > 0 ? total_vol / total_num : 0)

            // 计算主动 ccb 次数 (需要全表扫描该群数据)
            const groupData = await ctx.database.get('ccb_record', { groupId: session.guildId })
            let cb_total = 0
            for (const r of groupData) {
                const info = r.ccb_by?.[targetUserId]
                if (info) cb_total += info.count
            }

            // 找第一次 ccb 的人
            let first_actor = null
            const ccb_by = record.ccb_by || {}
            for (const actor_id in ccb_by) {
                if (ccb_by[actor_id].first) {
                    first_actor = actor_id
                    break
                }
            }
            if (!first_actor && Object.keys(ccb_by).length > 0) {
                // Fallback: max count
                let maxCount = -1
                for (const actor_id in ccb_by) {
                    if (ccb_by[actor_id].count > maxCount) {
                        maxCount = ccb_by[actor_id].count
                        first_actor = actor_id
                    }
                }
            }

            const target_nick = await state.getUserNickname(session, targetUserId)
            const first_nick = first_actor ? await state.getUserNickname(session, first_actor) : '未知'

            const msg = [
                `【${target_nick} 】`,
                `• 开拓者：${first_nick}`,
                `• 被注入次数：${total_num}`,
                `• 主动出击：${cb_total}`,
                `• 累计容量：${total_vol.toFixed(2)}ml`,
                `• 单次最高：${max_val.toFixed(2)}ml`
            ].join('\n')

            return msg
        })
}
