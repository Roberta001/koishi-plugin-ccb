import { Context, Session, h } from 'koishi'

export class CcbState {
    banList: Record<string, boolean> = {}
    nicknameCache = new Map<string, { name: string, timestamp: number }>()
    guildMemberCache = new Map<string, { members: any[], timestamp: number }>()

    private static MAX_CACHE_SIZE = 2000
    private static CACHE_DURATION = 5 * 60 * 1000
    private cleanupTimer: NodeJS.Timeout

    constructor(ctx: Context) {
        const CLEANUP_INTERVAL = 10 * 60 * 1000 // 10 分钟
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL)

        // 插件卸载时清理定时器
        ctx.on('dispose', () => {
            clearInterval(this.cleanupTimer)
        })
    }

    private cleanup() {
        const nowMs = Date.now()
        const nowSec = nowMs / 1000

        // 清理过期的 ban 列表和 actionTimes 的逻辑已被移除，改为通过货币修理机制解除炸膛状态

        // 清理过期的昵称缓存
        for (const [key, value] of this.nicknameCache) {
            if (nowMs - value.timestamp > CcbState.CACHE_DURATION) {
                this.nicknameCache.delete(key)
            }
        }

        // 清理过期的群成员列表缓存
        for (const [key, value] of this.guildMemberCache) {
            if (nowMs - value.timestamp > CcbState.CACHE_DURATION * 2) {
                this.guildMemberCache.delete(key)
            }
        }
    }


    async getUserNickname(session: Session, userId: string): Promise<string> {
        const cacheKey = `${session.guildId}:${userId}`
        const cached = this.nicknameCache.get(cacheKey)
        const now = Date.now()

        if (cached && (now - cached.timestamp) < CcbState.CACHE_DURATION) {
            return cached.name
        }

        const setAndReturnName = (name: string | undefined) => {
            if (name && name !== userId) {
                const actualName = name.trim()
                if (actualName) {
                    // 淘汰最旧的缓存条目（如果超过限制）
                    if (this.nicknameCache.size >= CcbState.MAX_CACHE_SIZE) {
                        const oldestKey = this.nicknameCache.keys().next().value
                        if (oldestKey) this.nicknameCache.delete(oldestKey)
                    }
                    this.nicknameCache.set(cacheKey, { name: actualName, timestamp: now })
                    return actualName
                }
            }
            return null
        }

        if (session.guildId && userId) {
            try {
                const memberInfo = await session.bot.getGuildMember(session.guildId, userId)
                const displayName = memberInfo?.nick || memberInfo?.user?.name || memberInfo?.name
                const result = setAndReturnName(displayName)
                if (result) return result
            } catch (error) { }
        }

        try {
            const userInfo = await session.bot.getUser(userId)
            const displayName = userInfo?.name || userInfo?.nick
            const result = setAndReturnName(displayName)
            if (result) return result
        } catch (e) { }

        try {
            if (session.event?.user?.id === userId) {
                const result = setAndReturnName(session.event?.user?.name)
                if (result) return result
            }
        } catch (nestedError) { }

        const friendlyName = `用户${userId}`
        this.nicknameCache.set(cacheKey, { name: friendlyName, timestamp: now })
        return friendlyName
    }

    checkGroupCommand(session: Session): string | null {
        if (!session.guildId) {
            return '此命令只能在群聊中使用。'
        }
        return null
    }

    async findTargetUser(session: Session, input: string): Promise<string | null> {
        if (!input) return null

        // 1. 尝试解析 At 元素格式 (使用内置解析应对含有特殊字符如 > 的复杂场景)
        try {
            const elements = h.parse(input)
            const atEl = elements.find(el => el.type === 'at')
            if (atEl?.attrs?.id) {
                return String(atEl.attrs.id)
            }
        } catch (e) {
            // 忽略异常，继续下面的正则匹配
        }

        // 兜底正则，支持跨越特殊字符（例如名字中带有 > 时 h.parse 可能会截断导致 attrs 里没有 id）
        const atMatch = input.match(/<at\s+[^<]*?id=(["'])(.*?)\1/i)
        if (atMatch) return atMatch[2]

        // 预防 Koishi 的 Argv 词法分析被特殊空格（如 U+2007）截断，导致 input 连 id 属性都直接丢失
        if (/<at\b/i.test(input)) {
            const atEl = session.elements?.find(el => el.type === 'at')
            if (atEl?.attrs?.id) {
                return String(atEl.attrs.id)
            }
        }

        // 2. 尝试带协议前缀的格式 (例如 onebot:123)
        const colonIndex = input.indexOf(':')
        if (colonIndex > 0 && colonIndex < input.length - 1) {
            return input.slice(colonIndex + 1)
        }

        // 3. 尝试纯数字 QQ 号
        if (/^\d+$/.test(input)) {
            return input
        }

        // 4. 尝试昵称匹配
        try {
            let members: any[] | undefined
            const now = Date.now()
            const cachedMembers = this.guildMemberCache.get(session.guildId)
            if (cachedMembers && (now - cachedMembers.timestamp) < CcbState.CACHE_DURATION * 2) {
                members = cachedMembers.members
            } else {
                const list = await session.bot.getGuildMemberList(session.guildId)
                members = list?.data
                if (members?.length) {
                    this.guildMemberCache.set(session.guildId, { members, timestamp: now })
                }
            }

            if (!members?.length) return null

            const targetName = input.replace(/\s/g, '').toLowerCase()

            let exactMatchId: string | undefined
            let partialMatchId: string | undefined

            for (const m of members) {
                const nick = m.nick || m.user?.name || m.name || ''
                if (!nick) continue

                const cleanNick = nick.replace(/\s/g, '').toLowerCase()

                // 4.1 精确匹配
                if (cleanNick === targetName) {
                    exactMatchId = m.user?.id
                    break // 精确匹配优先级最高，直接跳出寻找
                }

                // 4.2 包含匹配
                if (!partialMatchId && cleanNick.includes(targetName)) {
                    partialMatchId = m.user?.id // 记录首个包含匹配作为兜底
                }
            }

            const finalMatch = exactMatchId || partialMatchId
            if (finalMatch) return finalMatch
        } catch (e) {
            // ignore
        }

        return null
    }

    async validateTargetUser(session: Session, target: string): Promise<string> {
        // 1. 优先处理显式参数
        if (target) {
            const foundId = await this.findTargetUser(session, target)
            if (foundId) {
                try {
                    const member = await session.bot.getGuildMember(session.guildId, foundId)
                    if (!member) return '无法找到指定用户，请检查输入是否正确。'
                } catch {
                    return '无法找到指定用户，请检查输入是否正确。'
                }
                return foundId
            }
            return '无法找到指定用户，请检查输入是否正确。'
        }

        // 2. 其次处理引用
        if (session.quote?.user?.id) {
            // 引用的人肯定在 (或者曾经在)
            return session.quote.user.id
        }

        // 3. 最后返回自己
        return session.userId
    }
}
