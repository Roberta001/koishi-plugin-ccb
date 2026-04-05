import { Context } from 'koishi'
import { CCBConfig } from '../config'
import { CcbState } from '../utils'
import { applyCcbCommand } from './ccb'
import { applyRankCommands } from './rank'
import { applyInfoCommand } from './info'
import { applyCharmCommand } from './charm'

export function applyCommands(ctx: Context, config: CCBConfig, state: CcbState) {
    applyCcbCommand(ctx, config, state)
    applyRankCommands(ctx, state)
    applyInfoCommand(ctx, state)
    applyCharmCommand(ctx, state)
}
