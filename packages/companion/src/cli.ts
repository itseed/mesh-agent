#!/usr/bin/env node
import { Command } from 'commander'
import { CompanionClient } from './client.js'

const program = new Command()

program
  .name('mesh-companion')
  .description('MeshAgent local companion daemon')
  .version('0.1.0')

program
  .command('connect <url>')
  .description('Connect this machine to a MeshAgent server')
  .requiredOption('--token <token>', 'Companion token from MeshAgent Settings → Companion tab')
  .action((url: string, opts: { token: string }) => {
    if (!opts.token.startsWith('mesh_comp_')) {
      console.error('✕ Invalid token format. Token must start with mesh_comp_')
      process.exit(1)
    }

    console.log(`Connecting to ${url}...`)
    console.log('  Serving: fs.list, fs.stat')
    console.log('  Press Ctrl+C to disconnect.\n')

    const client = new CompanionClient({
      url,
      token: opts.token,
      onConnected: () => console.log('✓ Companion ready\n'),
      onDisconnected: () => console.log('Disconnected.'),
    })

    client.connect()

    process.on('SIGINT', () => {
      console.log('\nDisconnecting...')
      client.stop()
      process.exit(0)
    })
  })

program.parse()
