'use strict'

/* jshint node:true */

var mbgl = require('@mapbox/mapbox-gl-native')
var fs = require('fs')
var path = require('path')

var base = path.join(__dirname, '..')

var fileSource = {
  request: function(req) {
    fs.readFile(path.join(base, req.url), function(err, data) {
      req.respond(err, { data: data })
    })
  },
  cancel: function(req) {
    req.canceled = true
  }
}

var map = new mbgl.Map(fileSource)

module.exports = map
