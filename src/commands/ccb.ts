import { Context } from 'koishi'
import { CCBConfig } from '../config'
import { CcbState } from '../utils'
import { updateCCBRecord } from '../core'

export function applyCcbCommand(ctx: Context, config: CCBConfig, state: CcbState) {
    ctx.command('ccb [target:user]', '给群友注入生命因子')
        .userFields(['id'])
        .option('off', '--off [user:string] 开启保护模式（禁止被ccb），可指定用户')
        .option('on', '--on [user:string] 关闭保护模式（允许被ccb），默认所有用户处于保护状态')
        .action(async ({ session, options }, target: string) => {
            const checkResult = state.checkGroupCommand(session)
            if (checkResult) return checkResult

            const senderId = session.userId

            // 冷却检查辅助函数
            const checkCooldown = (lastToggle: number): string | null => {
                const now = Date.now()
                const cooldownMs = config.toggleCooldown * 1000
                if (now - lastToggle < cooldownMs) {
                    const remain = Math.ceil((cooldownMs - (now - lastToggle)) / 1000)
                    const m = Math.floor(remain / 60)
                    const s = remain % 60
                    return `操作太频繁了，请等待 ${m}分${s}秒 后再试。`
                }
                return null
            }

            // --- 处理开关选项 ---
            const hasOff = 'off' in options
            const hasOn = 'on' in options

            if (hasOff || hasOn) {
                const isOff = hasOff
                const optionVal = isOff ? options.off : options.on

                let targetUserStr: string | null = null
                if (typeof optionVal === 'string' && optionVal.trim()) {
                    targetUserStr = await state.findTargetUser(session, optionVal.trim())
                }

                // 兜底：at 元素未被选项解析器捕获，直接从消息元素中提取
                if (!targetUserStr) {
                    const atEl = session.elements?.find(el => el.type === 'at')
                    if (atEl?.attrs?.id) {
                        targetUserStr = String(atEl.attrs.id)
                    }
                }

                // 如果用户明确输入了字符串参数但没找到人，应该报错而不是变成全局开关
                if (!targetUserStr && typeof optionVal === 'string' && optionVal.trim()) {
                    return `无法找到用户「${optionVal}」，请检查输入是否正确。`
                }

                // 优先校验目标用户存在性
                if (targetUserStr) {
                    try {
                        const memberInfo = await session.bot.getGuildMember(session.guildId, targetUserStr)
                        if (!memberInfo) return '无法找到指定用户，请检查输入是否正确。'
                    } catch (error) {
                        return '无法找到指定用户，请检查输入是否正确。'
                    }
                }

                // 共用冷却与设置检查逻辑（合并重构）
                const [userSetting] = await ctx.database.get('ccb_setting', { userId: senderId })
                const targetKey = targetUserStr || '__global__'
                const lastToggleTimes = { ...(userSetting?.lastToggleTimes || {}) }

                let lastToggle = lastToggleTimes[targetKey] || 0
                if (targetKey === '__global__' && !lastToggle) {
                    lastToggle = userSetting?.lastToggleTime || 0 // 向后兼容旧字段
                }

                const cooldownResult = checkCooldown(lastToggle)
                if (cooldownResult) return cooldownResult

                const nowMs = Date.now()
                lastToggleTimes[targetKey] = nowMs

                if (!targetUserStr) {
                    const newOptOut = !!isOff
                    await ctx.database.upsert('ccb_setting', [{
                        userId: senderId,
                        optOut: newOptOut,
                        lastToggleTime: nowMs, // 保持更新以供兼容
                        lastToggleTimes: lastToggleTimes,
                        overrides: { ...(userSetting?.overrides || {}) }
                    }])

                    return newOptOut
                        ? '已开启全局保护模式，阻止你被ccb。'
                        : '已关闭全局保护模式，允许你被ccb。'
                } else {
                    const targetId = targetUserStr
                    const overrides = { ...(userSetting?.overrides || {}) }

                    overrides[targetId] = !isOff // true 代表允许，false 代表禁止

                    await ctx.database.upsert('ccb_setting', [{
                        userId: senderId,
                        overrides: overrides,
                        optOut: userSetting?.optOut ?? false,
                        lastToggleTime: userSetting?.lastToggleTime || 0, // 不改变全局旧字段
                        lastToggleTimes: lastToggleTimes
                    }])

                    const targetNick = await state.getUserNickname(session, targetId).catch(() => targetId) || targetId
                    return isOff
                        ? `已禁止用户 ${targetNick} 对你ccb。`
                        : `已允许用户 ${targetNick} 对你ccb。`
                }
            }
            // ------------------

            // --- 检查发起者是否在保护名单 ---
            const [senderSetting] = await ctx.database.get('ccb_setting', { userId: senderId })
            const senderOptOut = senderSetting?.optOut ?? config.defaultOptOut
            const senderIsInitial = !senderSetting // 判断发起者是否为初始状态
            if (senderOptOut) {
                const message = senderIsInitial
                    ? '你还未开启ccb功能。请先使用 ccb --on 来开启。'
                    : '你已开启保护模式，无法ccb他人。请先使用 ccb --on 解除保护。'
                return message
            }
            // ---------------------------

            const actorId = senderId
            const now = Date.now() / 1000

            // 获取开挂/全局配置
            const cheatSetting = config.cheatList.find(c => c.userId === actorId)
            const currentConfig = {
                costMultiplier: cheatSetting ? cheatSetting.costMultiplier : 1.0,
                ywProbability: cheatSetting ? cheatSetting.ywProbability : config.ywProbability,
                critProb: cheatSetting ? cheatSetting.critProb : config.critProb,
            }

            const actualRepairCost = Math.ceil(config.repairCost * currentConfig.costMultiplier)
            const actualCcbCost = Math.ceil(config.ccbCost * currentConfig.costMultiplier)

            // 先检查大修状态
            if (state.banList[actorId]) {
                try {
                    await ctx.monetary.cost(session.user.id, actualRepairCost, config.currency)
                    state.banList[actorId] = false
                    return `⚠️ 检测到你处于炸膛状态，已自动花费 ${actualRepairCost} ${config.currencyName} 进行大修。保养完成，请重新尝试！`
                } catch (e: any) {
                    if (e.message?.includes('insufficient balance')) {
                        return `💔 你的鹿处于炸膛损坏状态！需要大修才能继续工作。当前你的 ${config.currencyName} 余额不足以支付大修费用（需 ${actualRepairCost}）。`
                    }
                    ctx.logger('ccb').error('货币大修出错:', e)
                    return `尝试进行大修时出错，无法访问货币系统：${e.message || e}`
                }
            }



            let targetUserId = await state.validateTargetUser(session, target)
            if (targetUserId.startsWith('无法找到')) {
                return targetUserId
            }

            // --- 检查目标是否在白名单 ---
            // 1. 检查 Config 白名单
            if (config.whiteList.includes(targetUserId)) {
                const nickname = await state.getUserNickname(session, targetUserId) || targetUserId
                return `${nickname} 已开启保护模式，拒绝了和你ccb。`
            }
            // 2. 检查发起者是否主动禁止了目标（互相禁止逻辑）
            if (senderSetting?.overrides?.[targetUserId] === false) {
                const nickname = await state.getUserNickname(session, targetUserId) || targetUserId
                return `你已禁止与 ${nickname} 进行ccb。`
            }
            // 3. 检查 数据库 目标用户自定义设置
            const [targetSetting] = await ctx.database.get('ccb_setting', { userId: targetUserId })
            const targetOptOut = targetSetting?.optOut ?? config.defaultOptOut
            const overrides = targetSetting?.overrides || {}
            const isInitialState = !targetSetting // 判断是否为初始状态

            // 优先检查特定覆盖
            if (overrides[actorId] === false) {
                const nickname = await state.getUserNickname(session, targetUserId) || targetUserId
                return `${nickname} 已开启针对你的保护，拒绝了和你ccb。`
            }

            // 如果没有特定允许，再检查全局设置
            if (overrides[actorId] !== true && targetOptOut) {
                const nickname = await state.getUserNickname(session, targetUserId) || targetUserId
                const message = isInitialState
                    ? `${nickname} 还未开启ccb功能。请让ta使用 ccb --on 来开启。`
                    : `${nickname} 已开启保护模式，拒绝了和你ccb。请让ta使用 ccb --on 来允许被ccb。`
                return message
            }
            // ------------------------

            if (targetUserId === actorId && !config.selfCcb) {
                return '怎么还能对自己下手啊（恼）'
            }

            // 执行 ccb 前扣除日常保养费用
            try {
                await ctx.monetary.cost(session.user.id, actualCcbCost, config.currency)
            } catch (e: any) {
                if (e.message?.includes('insufficient balance')) {
                    return `💧 你的鹿缺乏日常保养经费！当前你的 ${config.currencyName} 余额不足（需 ${actualCcbCost}）。`
                }
                ctx.logger('ccb').error('货币扣费出错:', e)
                return `尝试扣除日常保养费用时出错，暂无法操作：\n${e.stack || e.message || e}`
            }

            const duration = parseFloat((Math.random() * 59 + 1).toFixed(2))
            let V = parseFloat((Math.random() * 99 + 1).toFixed(2))

            const prob = currentConfig.critProb
            let crit = false
            if (Math.random() < prob) {
                V = parseFloat((V * 2).toFixed(2))
                crit = true
            }

            // updateCCBRecord 内部会自动判断记录是否存在，无需提前查询
            let message: string
            try {
                const nickname = await state.getUserNickname(session, targetUserId)
                message = await updateCCBRecord(ctx, session, session.guildId, targetUserId, duration, V, nickname, crit)
            } catch (e) {
                console.error(`报错: ${e}`)
                return '对方拒绝了和你ccb'
            }

            if (Math.random() < currentConfig.ywProbability) {
                state.banList[actorId] = true
                await session.send(message)
                return '💥你炸膛了！彻底坏掉了，下次使用需要交纳巨额大修费（悲）'
            }

            return message
        })
}
