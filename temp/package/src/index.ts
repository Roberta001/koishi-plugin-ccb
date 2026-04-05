import { $, Argv, Computed, Context, Schema, Service, Session } from 'koishi'
import {} from '@koishijs/plugin-help'
import {} from 'koishi-plugin-rate-limit'
import {} from 'koishi-plugin-profile'

declare module 'koishi' {
  interface Context {
    monetary: Monetary
  }

  namespace Command {
    interface Config {
      cost?: Computed<number>
    }
  }

  interface Tables {
    monetary: Tables.Monetary
  }

  namespace Tables {
    interface Monetary {
      uid: number
      currency: string
      value: number
    }
  }
}

class Monetary extends Service {
  static inject = ['database']

  constructor(ctx: Context, config: Monetary.Config) {
    super(ctx, 'monetary', true)

    ctx.model.extend('monetary', {
      uid: 'unsigned',
      currency: 'string',
      value: 'unsigned',
    }, {
      primary: ['uid', 'currency'],
    })

    ctx.schema.extend('command', Schema.object({
      cost: Schema.computed(Number).default(0).description('每次调用的花费。'),
    }), 900)

    ctx.before('command/execute', async (argv: Argv<'id'>) => {
      const { session, options, command } = argv
      let isUsage = true
      for (const { name, notUsage } of Object.values(command._options)) {
        if (name in options && notUsage) isUsage = false
      }
      if (!isUsage) return
      const cost = session.resolve(command.config.cost) ?? 0
      if (!cost) return
      try {
        await this.cost(session.user.id, cost)
      } catch (e) {
        return '你没有足够的点数。'
      }
    })

    // extend command help
    ctx.on('help/command', (output, command, session: Session<'id'>) => {
      const cost = session.resolve(command.config.cost) ?? 0
      if (cost > 0) output.push(`花费：${cost} 点数`)
    })

    ctx.using(['profile'], (ctx) => {
      ctx.profile.register(async (session) => {
        const [data] = await this.ctx.database.get('monetary', {
          uid: session.user.id,
          currency: 'default',
        }, ['value'])
        return `点数：${data?.value ?? 0}`
      }, ['id'])
    })
  }

  async cost(uid: number, cost: number, currency = 'default') {
    const [data] = await this.ctx.database.get('monetary', {
      uid,
      currency,
    }, ['value'])
    if (!data) throw new Error('insufficient balance.')
    if (data.value < cost) throw new Error('insufficient balance.')
    await this.ctx.database.set('monetary', {
      uid,
      currency,
    }, (row) => ({
      value: $.sub(row.value, cost),
    }))
  }

  async gain(uid: number, gain: number, currency = 'default') {
    await this.ctx.database.upsert('monetary', (row) => [{
      uid,
      currency,
      value: $.add(row.value, gain),
    }])
  }
}

namespace Monetary {
  export interface Config {}

  export const Config: Schema<Config> = Schema.object({})
}

export default Monetary
