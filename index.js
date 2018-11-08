"use strict";

var sm = new (require('sphericalmercator'))();
var mbgl = require('@mapbox/mapbox-gl-native');
var Png = require('pngjs').PNG;
var PngQuant = require('pngquant');
var stream = require('stream');
var concat = require('concat-stream');
var request = require('requestretry');
var url = require('url');
var fs = require('fs');
var concat = require('concat-stream');
var omit = require('lodash/omit');
var Pool = require('generic-pool').Pool;
var N_CPUS = require('os').cpus().length;

mbgl.on('message', function(msg) {
  console.log(msg);
});

function pool(style, options) {
    return new Pool({
        create: create,
        destroy: destroy,
        max: N_CPUS
    });

    function create(callback) {
        var map = new mbgl.Map(options);
        var loaded = map.load(style);
        return callback(null, map);
    }

    function destroy(map) {
        map.release()
    }
}

function mbglRequest(req, callback){
    var opts = {
        url: req.url,
        encoding: null,
        gzip: true
    };

    var uri = url.parse(req.url)

    if (uri.protocol === 'file:') {
        fs.readFile(decodeURI(uri.hostname + uri.pathname), function(err, data) {
            if (err) {
                callback(err);
            } else {
                var response = {};
                response.data = data
                callback(null, response)
            }
        })
    } else {
      request(opts, function (err, res, body) {
          if (err) {
              //TODO: temporary hack to fix zero-size protobufs
              if (err.code === "Z_BUF_ERROR") {
                  callback(null, {data: new Buffer(0)})
              } else {
                  console.error(err, opts)
                  callback(err);
              }
          } else if (res == undefined) {
              callback(null, {data: new Buffer(0)})
          } else if (res.statusCode == 200) {
              var response = {};

              if (res.headers.modified) { response.modified = new Date(res.headers.modified); }
              if (res.headers.expires) { response.expires = new Date(res.headers.expires); }
              if (res.headers.etag) { response.etag = res.headers.etag; }

              response.data = body;

              callback(null, response);
          } else if (res.statusCode == 404) {
              var response = {}

              if (res.headers.modified) { response.modified = new Date(res.headers.modified); }
              if (res.headers.expires) { response.expires = new Date(res.headers.expires); }
              if (res.headers.etag) { response.etag = res.headers.etag; }

              response.data = new Buffer(0);

              callback(null, response)
          } else {
              callback(new Error(body));
          }
      });
    }
}

class GL{
  constructor(options, callback) {
    if (!options || (typeof options !== 'object' && typeof options !== 'string')) return callback(new Error('options must be an object or a string'));
    if (!options.style) return callback(new Error('Missing GL style JSON'));

    this._scale = options.query.scale || 1;
    this._layerTileSize = options.query.layerTileSize || 512;

    this._pool = pool(options.style, {
      request: mbglRequest,
      ratio: this._scale
    });

    var gl = this;

    setImmediate(callback, null, gl);
  }

  getTile(z, x, y, callback) {

      var bbox = sm.bbox(+x,+y,+z, false, '900913');
      var center = sm.inverse([bbox[0] + ((bbox[2] - bbox[0]) * 0.5), bbox[1] + ((bbox[3] - bbox[1]) * 0.5)]);

      var options = {
          // pass center in lat, lng order
          center: center,
          width: this._layerTileSize,
          height: this._layerTileSize,
          zoom: z + Math.log2(this._layerTileSize) - 9,
      };

      this.getStatic(options, callback);
  };

  getStatic(options, callback) {
      var that = this;
      this._pool.acquire(function(err, map) {

          if (err) {
            return callback(err)
          };

          map.render(options, function(err, data) {

              that._pool.release(map);

              if (err) {
                return callback(err)
              };
              var width = Math.floor(options.width * that._scale);
              var height = Math.floor(options.height * that._scale);

              if (options && options.format === "raw") {
                return callback(null, data, { width: width, height: height, channels: 4 });
              } else {
                var png = new Png({ width, height, inputHasAlpha: true });
                png.data = data;

                var concatStream = concat(function(buffer) {
                    return callback(null, buffer, { 'Content-Type': 'image/png' });
                });

                png.pack().pipe(new PngQuant(['256', '--quality=90'])).pipe(concatStream);
              }

          });
      });
  };

  getInfo(callback) {
    callback(null, {})
  }
}

module.exports = GL;
module.exports.registerProtocols = function(tilelive) {
    tilelive.protocols['gl:'] = GL;
};
