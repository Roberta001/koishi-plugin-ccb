import { Schema } from 'koishi'

// --- 配置接口 ---
export interface CheatConfig {
    userId: string
    ywProbability: number
    critProb: number
    costMultiplier: number
}

export interface CCBConfig {
    ywProbability: number
    whiteList: string[]
    selfCcb: boolean
    critProb: number
    toggleCooldown: number
    cheatList: CheatConfig[]
    defaultOptOut: boolean
    resetAllUsers?: 'none' | 'on' | 'off' | 'clear'
    currency: string
    currencyName: string
    ccbCost: number
    repairCost: number
}

export const Config: Schema<CCBConfig> = Schema.object({
    currency: Schema.string().default('default').description('💸 **货币 ID**\n\n使用的货币内部标识名称。需确保你的经济插件（如 `monetary` 配合某个 provider）支持这个货币名。留空或填 `default` 则是默认货币。'),
    currencyName: Schema.string().default('金币').description('🎫 **货币显示名**\n\n给用户返回提示时显示的易读名字，比如“金币”、“积分”等。'),
    ccbCost: Schema.number().default(10).description('🔧 **日常保养费**\n\n每次发起 `/ccb` 时扣除的货币数量。如果用户余额不足，将禁止操作。'),
    repairCost: Schema.number().default(100).description('🧰 **炸膛大修费**\n\n如果不幸触发炸膛概率（见下方），用户将陷入损坏状态。在损坏状态下，下一次呼叫 `/ccb` 会自动扣除这笔高昂的费用来进行修理，修理完成前无法正常使用。'),
    ywProbability: Schema.number().default(0.1).min(0).max(1).description('💥 **炸膛损坏概率 (0~1)**\n\n每次操作有几率导致“炸膛”。一旦炸膛，就需要交纳上面的【炸膛大修费】。'),
    whiteList: Schema.array(String).default([]).description('🛡️ **绝对保护名单（黑名单）**\n\n填入目标用户的 ID。名单里的人将处于绝对保护状态，永远无法被别人 ccb。'),
    selfCcb: Schema.boolean().default(false).description('🎭 **是否允许对自己下手**\n\n开启后，用户可以把 `/ccb` 的目标指向自己。'),
    critProb: Schema.number().default(0.2).min(0).max(1).description('✨ **全局暴击概率 (0~1)**\n\n每次被成功 ccb 时触发暴击（效果参数翻倍）的几率。'),
    toggleCooldown: Schema.number().default(1800).description('⏱️ **个人开关冷却时间**\n\n用户使用命令 `--on` / `--off` 修改自己保护模式开关的冷却时间（单位：秒）。防止有人频繁开关玩弄机制。'),
    cheatList: Schema.array(Schema.object({
        userId: Schema.string().required().description('需要开挂的用户 ID'),
        costMultiplier: Schema.number().default(1.0).description('💰 **费用乘数**\n\n修改该用户的扣费倍率。比如 `0.5` 就是半价，0 就是永远免费。'),
        ywProbability: Schema.number().default(0).min(0).max(1).description('💥 **特权炸膛概率** (默认 0 即永不炸膛)'),
        critProb: Schema.number().default(0.8).min(0).max(1).description('✨ **特权暴击概率**')
    })).role('table').description('👑 **特权功能名单**\n\n为特定特定用户配置专门的概率与打折优惠。此配置优先级最高。'),
    defaultOptOut: Schema.boolean().default(true).description('🔏 **新用户默认保护状态**\n\n`true` = 新用户默认处于保护中，别人无法对他 ccb，需要他自己使用 `--on` 关闭保护。\n`false` = 默认大家都可以互相 ccb。'),
    resetAllUsers: Schema.union([
        Schema.const('none' as const).description('保持无操作'),
        Schema.const('on' as const).description('🚨 强制全群开放（允许所有人被 ccb）'),
        Schema.const('off' as const).description('🚨 强制全群保护（禁止任何人被 ccb）'),
        Schema.const('clear' as const).description('🔥 清空全群所有人的自定义设定')
    ]).default('none').description('🛠️ **批量状态重置管理**\n\n对所有已经产生过数据的用户执行强制的批量状态更变。**执行完成后请务必记得选回“保持无操作”并重新保存！**').role('radio')
})
