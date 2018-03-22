#!/usr/bin/env node

'use strict'

const serve = require('.')

serve({
  supported: 'https://skimdb.npmjs.com/registry/_design/app/_view/browseAuthors',
  maxAge: 86400000,
  max: 5000,
  limit: 10000,
  template: 'templates/error.html',
  partials: {},
  port: 3300
})
