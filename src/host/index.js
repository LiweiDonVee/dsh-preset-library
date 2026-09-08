import os from 'node:os'
import path from 'node:path'

import { API_PREFIX, createApiHandler } from './http.js'
import { MetadataStore } from './store.js'

export const name = 'dsh-preset-library'
export const inject = ['webServer', 'connection']

export function resolveMetadataPath(environment = process.env) {
  const configured = environment.DSH_HOME?.trim()
  const dshHome = configured ? path.resolve(configured) : path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'preset-library.json')
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const store = new MetadataStore(resolveMetadataPath())
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: createApiHandler(store, ctx.get('connection')),
  }), 'preset-library: metadata api')
}
