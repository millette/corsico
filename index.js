'use strict'

// core
const { URL } = require('url')

// npm
const Koa = require('koa')
const compress = require('kompression')
const got = require('got')
const conditional = require('koa-conditional-get')
const etag = require('koa-etag')
const cors = require('@koa/cors')
const logger = require('koa-logger')
const koaError = require('koa-error')
const LRU = require('async-lru')

// setting load: true will also disable lru.get(); use peek and set instead
const setupLru = (app, config, load = true) => {
  app.context.lru = new LRU({ ...config, load })
  if (typeof app.context.lru._load !== 'function') { delete app.context.lru.get }
}

// store in cache when needed
const cacheStore = () => (ctx, next) => next().then(() => {
  if (!ctx.key) { return }
  const buffers = []
  const encoding = ctx.response.headers['content-encoding']
  ctx.body.on('data', (chunk) => buffers.push(chunk))
  ctx.body.on('end', () => ctx.lru.set(ctx.key, { full: Buffer.concat(buffers), encoding }))
})

const isBrotli = (ctx) => ctx.headers['accept-encoding'] && ctx.headers['accept-encoding']
  .split(',').map((encoding) => encoding.trim()).indexOf('br') !== -1

// prioritize brotli (br encoding)
const brotliFirst = () => (ctx, next) => {
  if (isBrotli(ctx)) { ctx.headers['accept-encoding'] = 'br' }
  return next()
}

// route handler
const router = ({ supported, limit }) => {
  const baseUrl = new URL(supported)
  return (ctx) => {
    const url = ctx.URL
    ctx.assert(url.pathname !== '/favicon.ico', 404)
    const proxiedUrl = url.pathname.slice(1)
    ctx.assert(proxiedUrl === supported, 501, 'Nope', { url: ctx.url, supported })
    const search = url.searchParams
    const queryLimit = search.get('limit')
    if (!queryLimit || (queryLimit > limit)) { search.set('limit', limit) }
    search.sort()
    baseUrl.search = search
    ctx.type = 'application/json'
    const key = baseUrl.search.slice(1)
    const peeked = ctx.lru.peek(key)
    ctx.compress = !peeked
    if (peeked && peeked.encoding) { ctx.response.set('content-encoding', peeked.encoding) }
    ctx.key = !peeked && key
    ctx.body = peeked ? peeked.full : got.stream(baseUrl.toString())
  }
}

const errorHandler = (app) => app.env === 'production'
  ? (err) => console.error(err.toString(), err.url || '')
  : (err) => console.error(err)

module.exports = (config) => {
  const app = new Koa()
  setupLru(app, config)
  app.use(cacheStore())
  if (!config.quiet) { app.use(logger()) }
  app.use(koaError(config))
  app.use(cors({ allowMethods: 'GET', credentials: false }))
  app.use(compress())
  app.use(conditional())
  app.use(etag())
  app.use(brotliFirst())
  app.use(router(config))
  app.on('error', errorHandler(app))
  if (config.port) { app.listen(config.port) }
  return app
}
